#!/usr/bin/env node
// Xcode 27 treats netinet6/in6.h as a private header. sockaddr_in6 comes from
// netinet/in.h. cordova prepare copies the plugin sources back, so this runs after.
const fs = require("fs");
const path = require("path");

const root = path.join(process.cwd(), "platforms", "ios");
if (!fs.existsSync(root)) process.exit(0);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".m") && !entry.name.endsWith(".h")) continue;
    const text = fs.readFileSync(full, "utf8");
    let updated = text.replace(/^#import <netinet6\/in6\.h>\r?\n/gm, "");
    updated = updated.replace(/\s*\[\[UIApplication sharedApplication\] setNetworkActivityIndicatorVisible:(?:YES|NO)\];\r?\n/g, "\n");
    if (updated === text) continue;
    fs.writeFileSync(full, updated);
    console.log("Removed the private netinet6 header from " + path.relative(process.cwd(), full));
  }
}

walk(root);
