#!/usr/bin/env bash
# Render an Asciinema v2 .cast to MP4 (via official agg → GIF → ffmpeg x264).
#
# Prereqs: curl, ffmpeg; downloads agg v1.7.0 (musl) to /tmp/agg on first run.
#
# Usage:
#   bash scripts/render-asciicast-to-mp4.sh [input.cast] [output.mp4]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${1:-$ROOT/recordings/nuauth-preview-replay.cast}"
OUT="${2:-$ROOT/recordings/nuauth-preview-replay.mp4}"
AGG_BIN="${AGG_BIN:-/tmp/agg}"
AGG_URL="${AGG_URL:-https://github.com/asciinema/agg/releases/download/v1.7.0/agg-x86_64-unknown-linux-musl}"

if [[ ! -f "$IN" ]]; then
  echo "Input not found: $IN" >&2
  exit 1
fi

if [[ ! -x "$AGG_BIN" ]]; then
  echo "Downloading agg → $AGG_BIN" >&2
  curl -fsSL -o "$AGG_BIN" "$AGG_URL"
  chmod +x "$AGG_BIN"
fi

TMP_GIF="$(mktemp --suffix=.gif)"
trap 'rm -f "$TMP_GIF"' EXIT

echo "Rendering GIF (agg)…" >&2
"$AGG_BIN" --quiet "$IN" "$TMP_GIF"

echo "Encoding MP4 (ffmpeg)…" >&2
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error -i "$TMP_GIF" \
  -movflags +faststart \
  -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  "$OUT"

echo "Wrote $OUT" >&2
ls -la "$OUT"
