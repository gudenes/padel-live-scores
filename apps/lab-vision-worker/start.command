#!/bin/zsh
set -eu
cd "$(dirname "$0")"
PYTHON="${LAB_VISION_PYTHON:-/Volumes/Crucial/dev/padelgod/video/.venv/bin/python}"
CONFIG="${1:-$HOME/Library/Application Support/Padel Labs/lab-vision-worker.json}"
if [[ ! -f "$CONFIG" ]]; then
  echo 'Download Mac connection from the app, then run this command with the connection file path.'
  exit 1
fi
exec "$PYTHON" worker.py --config "$CONFIG"
