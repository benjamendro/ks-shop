#!/bin/bash
# Local preview of the PWA (also used for tests).
cd "$(dirname "$0")/../web"
port="${1:-8765}"
echo "Serving https? no — http://127.0.0.1:${port}/"
exec python3 -m http.server "$port" --bind 127.0.0.1
