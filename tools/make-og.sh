#!/bin/sh
# Render social preview cards into assets/og/. Needs the local server: python3 -m http.server 4321
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p assets/og
for ch in home sandpile flock patterns ant slime; do
  "$CHROME" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=20000 \
    --screenshot="assets/og/$ch.png" "http://localhost:4321/tools/og.html?ch=$ch" 2>/dev/null
  echo "assets/og/$ch.png"
done
