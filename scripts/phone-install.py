#!/usr/bin/env python3
"""Build West2Romaji with Xcode in /Applications and install it on the USB iPhone.

This script does not install Python packages.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SEARCH_DIRS = (Path("/Applications"),)


def run(command, capture=False, env=None):
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        check=False,
        text=True,
        capture_output=capture,
    )


def die(message):
    sys.exit(message)


def xcode_apps(directory):
    if not directory.is_dir():
        return []
    apps = []
    for app in directory.glob("Xcode*.app"):
        if (app / "Contents/Developer/usr/bin/xcodebuild").is_file():
            apps.append(app)
    return sorted(apps, key=lambda path: path.name)


def find_xcode():
    chosen = os.environ.get("XCODE_APP", "").strip()
    if chosen:
        app = Path(chosen)
        if not (app / "Contents/Developer/usr/bin/xcodebuild").is_file():
            die(f"XCODE_APP is not an Xcode.app: {app}")
        return app
    for directory in SEARCH_DIRS:
        apps = xcode_apps(directory)
        if apps:
            return apps[-1]
    die("Xcode is not in /Applications. Install it with: xcodes install --latest")


def developer_env(app):
    env = os.environ.copy()
    env["DEVELOPER_DIR"] = str(app / "Contents/Developer")
    return env


def ensure_first_launch(env):
    xcodebuild = "/usr/bin/xcodebuild"
    if run([xcodebuild, "-checkFirstLaunchStatus"], env=env).returncode == 0:
        return
    developer = env["DEVELOPER_DIR"]
    print("Finishing the Xcode first launch. macOS will ask for your password.")
    if run(["sudo", "env", f"DEVELOPER_DIR={developer}", xcodebuild, "-license", "accept"]).returncode != 0:
        die("Could not accept the Xcode license.")
    if run(["sudo", "env", f"DEVELOPER_DIR={developer}", xcodebuild, "-runFirstLaunch"]).returncode != 0:
        die("Xcode first launch did not finish.")


def team_from_certificates():
    listed = run(["security", "find-certificate", "-a", "-c", "Apple Development", "-p"], capture=True)
    if listed.returncode != 0 or "BEGIN CERTIFICATE" not in listed.stdout:
        return ""
    for block in re.findall(
        r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        listed.stdout,
        flags=re.DOTALL,
    ):
        subject = subprocess.run(
            ["openssl", "x509", "-noout", "-subject"],
            input=block,
            check=False,
            text=True,
            capture_output=True,
        )
        found = re.search(r"\bOU\s*=\s*([A-Z0-9]{10})\b", subject.stdout)
        if found:
            return found.group(1)
    return ""


def team_id(app):
    explicit = os.environ.get("IOS_TEAM_ID", "").strip()
    if explicit:
        return explicit
    found = team_from_certificates()
    if found:
        return found
    die(
        "No Apple Development certificate on this Mac. Open this Xcode, sign in "
        "with your Apple ID (Settings → Accounts), copy the Team ID, then run:\n"
        f"  open {json.dumps(str(app))}\n"
        "  IOS_TEAM_ID=YOURTEAMID make phoneinstall"
    )


def ensure_project(env):
    if not (ROOT / "node_modules" / "cordova").exists():
        print("Installing npm packages.")
        if run(["npm", "install"], env=env).returncode != 0:
            die("npm install failed.")
    ios = ROOT / "platforms" / "ios"
    if not list(ios.glob("*.xcodeproj")):
        print("Adding the iOS platform.")
        if run(["npx", "cordova", "platform", "add", "ios", "--no-interactive"], env=env).returncode != 0:
            die("Could not add the iOS platform.")


def raise_deployment_target():
    """Xcode 27 rejects a deployment target below 15. CordovaLib still says 11."""
    minimum = (15, 0)
    ios = ROOT / "platforms" / "ios"
    for project in ios.glob("**/*.pbxproj"):
        text = project.read_text()

        def bump(match):
            parts = tuple(int(piece) for piece in match.group(1).split("."))
            if parts < minimum:
                return "IPHONEOS_DEPLOYMENT_TARGET = 15.0;"
            return match.group(0)

        updated = re.sub(r"IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);", bump, text)
        if updated != text:
            project.write_text(updated)
            print(f"Raised the deployment target in {project.relative_to(ROOT)}.")


def env_value(name):
    path = ROOT / ".env"
    if not path.is_file():
        return ""
    value = ""
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw = stripped.split("=", 1)
        if key.strip() != name:
            continue
        value = raw.strip().strip("\"'").strip()
    return value


def require_function_url(name):
    value = env_value(name)
    if not value.startswith("https://") or any(mark in value for mark in ('"', "'", "\n", "\\")):
        die(
            f"Set {name} in .env. Leave www/js/config.js empty."
        )
    return value


def bake_function_url():
    urls = {
        "FUNCTION_URL": require_function_url("FUNCTION_URL"),
        "FUNCTION_URL_TOKYO": require_function_url("FUNCTION_URL_TOKYO"),
    }
    target = ROOT / "platforms" / "ios" / "www" / "js" / "config.js"
    if not target.is_file():
        die("The iOS copy of config.js is missing.")
    lines = []
    found = set()
    for line in target.read_text().splitlines(keepends=True):
        written = False
        for name, url in urls.items():
            prefix = f"export const {name} = "
            if line.startswith(prefix):
                lines.append(f'{prefix}"{url}";\n')
                found.add(name)
                written = True
                break
        if not written:
            lines.append(line)
    missing = [name for name in urls if name not in found]
    if missing:
        die(f"Could not find {', '.join(missing)} in the iOS copy of config.js.")
    target.write_text("".join(lines))
    print("Wrote the Paris and Tokyo function URLs into the iOS build.")


def prepare(env):
    if run(["npx", "cordova", "prepare", "ios", "--no-interactive"], env=env).returncode != 0:
        die("Could not prepare the iOS project.")
    bake_function_url()


def build(env, team, udid):
    prepare(env)
    raise_deployment_target()
    workspace = next((ROOT / "platforms" / "ios").glob("*.xcworkspace"))
    print(f"Building for the phone with team {team}.")
    built = run(
        [
            "xcodebuild",
            "-workspace", str(workspace),
            "-scheme", workspace.stem,
            "-configuration", "Debug",
            "-destination", f"platform=iOS,id={udid}",
            "-allowProvisioningUpdates",
            "-allowProvisioningDeviceRegistration",
            "build",
            f"SYMROOT={ROOT / 'platforms' / 'ios' / 'build'}",
            f"DEVELOPMENT_TEAM={team}",
            "CODE_SIGN_STYLE=Automatic",
            "CODE_SIGN_IDENTITY=Apple Development",
        ],
        env=env,
    )
    if built.returncode != 0:
        die("The Xcode build failed.")


def built_app():
    root = ROOT / "platforms" / "ios" / "build"
    apps = [path for path in root.rglob("*.app") if path.is_dir()]
    device = [path for path in apps if "iphoneos" in str(path)]
    chosen = sorted(device or apps, key=lambda path: path.stat().st_mtime)
    if not chosen:
        die("The build finished without an iPhone app.")
    return chosen[-1]


def device_rows(env):
    with tempfile.TemporaryDirectory() as directory:
        listing = Path(directory) / "devices.json"
        listed = run(
            ["xcrun", "devicectl", "list", "devices", "--json-output", str(listing)],
            capture=True,
            env=env,
        )
        if listed.returncode != 0 or not listing.is_file():
            detail = (listed.stderr or listed.stdout).strip()
            die(detail or "Could not list devices with devicectl.")
        payload = json.loads(listing.read_text())
    return payload.get("result", {}).get("devices", [])


def choose_device(env):
    wanted = os.environ.get("DEVICE_UDID", "").strip()
    rows = device_rows(env)
    phones = []
    for row in rows:
        hardware = row.get("hardwareProperties") or {}
        if hardware.get("platform") != "iOS" or hardware.get("reality") not in (None, "physical"):
            continue
        connection = row.get("connectionProperties") or {}
        if connection.get("transportType") not in (None, "wired", "localNetwork"):
            continue
        identifier = hardware.get("udid") or row.get("identifier") or ""
        name = (row.get("deviceProperties") or {}).get("name") or "iPhone"
        phones.append((identifier, name, connection.get("transportType") or ""))
    if wanted:
        for identifier, name, _transport in phones:
            if identifier == wanted:
                return identifier, name
        die(f"No connected iPhone matches DEVICE_UDID={wanted}.")
    wired = [phone for phone in phones if phone[2] == "wired"]
    pool = wired or phones
    if len(pool) == 1:
        return pool[0][0], pool[0][1]
    if not pool:
        die("No iPhone is connected. Unlock it, tap Trust, and turn on Developer Mode.")
    names = ", ".join(f"{name} ({identifier})" for identifier, name, _transport in pool)
    die(f"More than one iPhone is connected. Set DEVICE_UDID. Found: {names}")


def install(env, app, identifier, name):
    print(f"Installing {app.name} on {name} ({identifier}).")
    if run(
        ["xcrun", "devicectl", "device", "install", "app", "--device", identifier, str(app)],
        env=env,
    ).returncode != 0:
        die("The phone refused the app. Trust this Mac, then trust the developer certificate in Settings → General → VPN & Device Management.")
    print("Installed. Open West2Romaji on the phone.")


def main():
    if shutil.which("npm") is None or shutil.which("npx") is None:
        die("Node.js is not installed.")
    app = find_xcode()
    print(f"Using {app}.")
    env = developer_env(app)
    ensure_first_launch(env)
    ensure_project(env)
    identifier, name = choose_device(env)
    build(env, team_id(app), identifier)
    install(env, built_app(), identifier, name)


if __name__ == "__main__":
    main()
