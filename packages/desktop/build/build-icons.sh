#!/usr/bin/env bash
# Rebuild platform icons from icon.svg.
# Requires: rsvg-convert (brew install librsvg), iconutil (macOS), npx (for png-to-ico).

set -euo pipefail
cd "$(dirname "$0")"

[[ -f icon.svg ]] || { echo "icon.svg missing"; exit 1; }

rm -rf icon.iconset icons
mkdir -p icon.iconset icons

for spec in 16:icon_16x16.png 32:icon_16x16@2x.png \
            32:icon_32x32.png 64:icon_32x32@2x.png \
            128:icon_128x128.png 256:icon_128x128@2x.png \
            256:icon_256x256.png 512:icon_256x256@2x.png \
            512:icon_512x512.png 1024:icon_512x512@2x.png; do
  size=${spec%:*}; name=${spec#*:}
  rsvg-convert -w "$size" -h "$size" icon.svg -o "icon.iconset/$name"
done

iconutil -c icns -o icon.icns icon.iconset

for size in 16 32 48 64 128 256 512; do
  rsvg-convert -w "$size" -h "$size" icon.svg -o "icons/icon-$size.png"
done

cp icons/icon-512.png icon.png

npx --yes png-to-ico \
  icons/icon-256.png icons/icon-128.png icons/icon-64.png \
  icons/icon-48.png icons/icon-32.png icons/icon-16.png > icon.ico

echo "built: icon.icns icon.ico icon.png"
