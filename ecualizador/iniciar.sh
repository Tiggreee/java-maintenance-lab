#!/usr/bin/env sh
# Ecualizador Libre - lanzador para Linux y macOS.
cd "$(dirname "$0")" || exit 1

URL="file://$(pwd)/index.html"
SERVER=""
if command -v python3 >/dev/null 2>&1; then
  PORT=$(python3 -c 'import socket
for p in range(8765, 8796):
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p)); print(p); break
    except OSError:
        pass
    finally:
        s.close()')
  if [ -n "$PORT" ]; then
    python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
    SERVER=$!
    trap 'kill "$SERVER" 2>/dev/null' EXIT INT TERM
    URL="http://127.0.0.1:$PORT/"
    sleep 1
  fi
fi

OPENED=""
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then
    "$b" --app="$URL" >/dev/null 2>&1 &
    OPENED=1
    break
  fi
done
if [ -z "$OPENED" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    open -na "Google Chrome" --args --app="$URL" 2>/dev/null || open "$URL"
  else
    xdg-open "$URL" >/dev/null 2>&1 &
  fi
fi

echo "Ecualizador Libre en $URL"
if [ -n "$SERVER" ]; then
  echo "Deja esta terminal abierta. Ctrl+C para cerrar."
  wait "$SERVER"
fi
