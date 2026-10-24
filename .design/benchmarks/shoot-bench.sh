#!/usr/bin/env bash
set -u
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
OUT="C:/Users/32485/Desktop/_项目/案屿/.design/benchmarks"
shot() {
  local name="$1" url="$2"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1000 \
    --virtual-time-budget=9000 --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1
  echo "$name $(stat -c%s "$OUT/$name.png" 2>/dev/null || echo fail)"
}
shot vibe "https://vibekanban.com/"
shot crystal "https://github.com/cicero-im/crystal"
shot linear-refresh "https://linear.app/now/behind-the-latest-design-refresh"
shot height "https://height.app/"
shot raycast "https://www.raycast.com/"
shot basecamp "https://basecamp.com/"
