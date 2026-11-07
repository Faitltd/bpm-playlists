#!/bin/bash
# Builds "BPM Playlists.app" into ./dist. Requires Xcode command line tools and Node.js.
set -euo pipefail
cd "$(dirname "$0")"

APP="dist/BPM Playlists.app"
rm -rf dist build
mkdir -p build "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "Building UI..."
(cd ui && npm install --silent && npm run build --silent)

echo "Compiling app (arm64 + x86_64)..."
swiftc -O -target arm64-apple-macos12 -o build/BPMPlaylists-arm64 app/main.swift -framework Cocoa -framework WebKit
swiftc -O -target x86_64-apple-macos12 -o build/BPMPlaylists-x86_64 app/main.swift -framework Cocoa -framework WebKit
lipo -create build/BPMPlaylists-arm64 build/BPMPlaylists-x86_64 -output "$APP/Contents/MacOS/BPMPlaylists"

cp app/Info.plist "$APP/Contents/Info.plist"
cp app/backend.js "$APP/Contents/Resources/backend.js"
cp ui/dist/index.html "$APP/Contents/Resources/index.html"
if [ -f app/AppIcon.icns ]; then cp app/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"; fi

codesign --force --deep --sign - "$APP"

(cd dist && ditto -c -k --keepParent "BPM Playlists.app" "BPM-Playlists-mac.zip")
echo "Done: $APP"
echo "Zip:  dist/BPM-Playlists-mac.zip"
