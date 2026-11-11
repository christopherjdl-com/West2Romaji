# West2Romaji

A Cordova app for iPhone. Type a phrase in any written language. Grok translates it into Japanese, shows modified Hepburn romaji large enough to read aloud, and shows the Japanese script underneath. Recent phrases stay on the phone.

There is no language switch. The model decides what language you wrote. There is no microphone.

## What you need

- Node.js 22 or newer
- An [xAI API key](https://console.x.ai/)
- For the phone: Xcode in /Applications, a free Apple ID, and the iPhone 13. A free Apple ID signs the app for seven days at a time. A paid developer account lasts a year. There is no way around signing.

Checked against the xAI docs on 31 October 2026. The chat model to use is `grok-4.7`. Chat completions at `https://api.x.ai/v1/chat/completions` is the legacy endpoint this app calls, which is what the product asked for. New xAI features land on the Responses API first.

`grok-4.7` reasons by default at `high`, and reasoning cannot be turned off. A short phrase does not need that, and it would miss a couple of seconds. The app sends `reasoning_effort: "low"`. When `XAI_API_KEY` is empty, the app calls `gemini-3.5-flash-lite` with thinking set to `minimal`. The gear only changes appearance.

## API key

The key is not in the repo and not baked into the app. On this Mac it is read from `.env`. On the phone the Lambda function reads it from Secrets Manager. The gear does not ask for a key.

## AWS

`infra/` is the path where the phone does not hold a model key. A Lambda function URL receives the signed phrase. There is no API Gateway and no API key on that URL. The same stack exists twice: Paris stays `eu-west-3`, and Tokyo is a second copy in `ap-northeast-1`. The function flips a coin between Amazon Bedrock and a direct call. Bedrock then flips between Claude Haiku 4.5 and Nova Lite. A direct call flips between Gemini and xAI. Each flip is even. When xAI wins and its key is empty, the call uses Gemini. If that Gemini call fails, the request moves to Bedrock and flips between Claude and Nova. A missing Gemini key is an error. The function does not flip again after that. In Tokyo those Bedrock models are `jp.anthropic.claude-haiku-4-5-20251001-v1:0` and `amazon.nova-lite-v1:0`. In Paris they are `eu.anthropic.claude-haiku-4-5-20251001-v1:0` and `eu.amazon.nova-lite-v1:0`. `make phoneinstall` reads `FUNCTION_URL` (Paris) and `FUNCTION_URL_TOKYO` from `.env` and writes them into the iOS build only. Leave `www/js/config.js` empty so the addresses are not committed. Enroll the phone before either address leaves the machine. The phone calls Tokyo when the iPhone timezone is `Asia/Tokyo`, and Paris otherwise. Set Automatically on the phone is what updates that timezone. Each region has its own enrollment. Debug on this Mac (`?debug=1`) still calls xAI when `XAI_API_KEY` is set, and Gemini when that key is empty. Details are in [infra/README.md](infra/README.md).

## Try the interface on a Mac

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173`. You can check layout, history, and settings.

Add `?debug=1` when you want a real translation from this Mac. The page reads `.env` in the repo root. That file is gitignored. `XAI_API_KEY` calls xAI. When it is empty, `null`, or `undefined`, `GEMINI_API_KEY` calls Gemini. The server listens on `127.0.0.1` only. The iPhone build ignores `debug` and calls the Lambda function URL, which uses the raffle above instead of this rule.

```bash
# Leave XAI_API_KEY empty to use the Gemini credits.
GEMINI_API_KEY=your-gemini-key
```

A real translation on the phone still belongs on the phone build.

## Install on the iPhone

One-time install. This puts Xcode in `/Applications`. It does not download the iOS Simulator. Apple asks for the Apple ID that will sign the app. A free Apple ID is enough. The download is about 2 GB, and the app is about 10 GB.

```bash
curl -fsSL -o /tmp/xcodes.zip https://github.com/XcodesOrg/xcodes/releases/download/2.1.0/xcodes.zip
unzip -o /tmp/xcodes.zip -d /tmp/xcodes-bin
install -m 755 /tmp/xcodes-bin/xcodes /opt/homebrew/bin/xcodes
xcodes install --latest
```

In the Xcode window, open Settings → Accounts and sign in with the same Apple ID. Copy the Team ID.

On the phone, turn on Developer Mode: Settings → Privacy & Security → Developer Mode, then restart. Unlock the phone, plug it in, and tap Trust.

```bash
IOS_TEAM_ID=YOURTEAMID make phoneinstall
```

`make phoneinstall` builds a development app and installs it with `devicectl`. Later builds can omit `IOS_TEAM_ID` once this Mac has an Apple Development certificate. `DEVICE_UDID` picks the phone when more than one is connected.

If the bundle id `app.west2romaji` is taken, change it to something unique and keep the same id in `config.xml`. If the phone says the developer is not trusted: Settings → General → VPN & Device Management, trust your certificate.

The app is portrait, draws behind the status bar, and uses the safe area so the title sits below the Dynamic Island.

`platforms/` and `plugins/` are generated. They are gitignored. `npm install` plus `cordova platform add ios` rebuilds them.

## How a translation works

The request asks for JSON:

```json
{ "japanese": "...", "romaji": "...", "source_lang": "Korean" }
```

`source_lang` is the English name of whatever language you typed. It is not limited to English or French. The app shows that name under the result, then the region that answered (`eu-west-3` or `ap-northeast-1`). You cannot override the language.

Romaji is modified Hepburn: macrons for long vowels, and the particles は / を / へ as wa / o / e. The model’s romaji is what you see when it comes back as Latin and agrees with the kana. If the Japanese is kana only and the model’s romaji is missing or unrelated, the app rebuilds Hepburn in `www/js/romaji.js`. Kanji readings are left to the model. A kana converter cannot invent them, and shipping a morphological dictionary would not be more reliable than Grok for this.

History is the last 40 phrases in `localStorage`. It is not the API key. It loads with no network. Delete a row to get an Undo toast. Clear asks you to tap again.

Errors you should see in plain language: no key, no network, a rejected key, rate limiting, a timeout (25 seconds), an xAI outage, and a response that is not the JSON above.

## Tests

```bash
npm test
```

The tests cover Hepburn, the open language field, history, Keychain vs the browser preview, HTTP errors, and the request body. The API key is asserted to be an `Authorization` header and not part of the JSON body.

`package.json` is not `"type": "module"`. Cordova loads plugin code as CommonJS, and that setting makes `cordova platform add` fail with `module is not defined`. The tests and the app are still ES modules. Node detects the test syntax on its own.

## Layout

```
config.xml          Cordova config, Keychain accessibility, icons
www/                The app. HTML, CSS, and JS. No native UI code.
www/js/translate.js Request, model id, reasoning effort
www/js/romaji.js    Hepburn fallback
www/js/keychain.js  Keychain on device, .env when debugging, session preview otherwise
docs/local-model-spike.md
res/icon/ios/       App icons
```

The glass look starts from [@dpawlikowski/liquid-glass](https://github.com/dpawlikowski/liquid-glass) 0.3.0 (MIT) and the SVG displacement recipe in [Sachin Kizhakkepurath’s iOS Liquid Glass CodePen](https://codepen.io/Sachin-Kizhakkepurath/pen/VYPpWvB). `www/css/liquid-glass.css` keeps the refraction on a copied scene layer. WebKit drops `backdrop-filter: url(#filter)`, and combining that with the blur would wipe the frost out. The live frost is `backdrop-filter: blur() saturate()`. Type is the system font, which is SF Pro on iOS. The displacement filter does not animate, so the A15 can spend its frame budget on the blurs and the spring motion instead.

## On-device models

Not in this version. The research is in [docs/local-model-spike.md](docs/local-model-spike.md). Short version: a local model inside this Cordova WebView is not a workable replacement on an iPhone 13, especially once the input can be any language.
