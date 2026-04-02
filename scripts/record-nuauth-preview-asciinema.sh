#!/usr/bin/env bash
#
# Record the sandbox walkthrough as an Asciinema .cast file (CLI “movie”).
#
# Usage (from repo root):
#   bash scripts/record-nuauth-preview-asciinema.sh [output.cast]
#
# Requires: pip package asciinema (`pip install --user asciinema`) or OS package.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/recordings/nuauth-preview-replay.cast}"
mkdir -p "$(dirname "$OUT")"

if ! command -v asciinema >/dev/null 2>&1; then
  echo "asciinema not found. Install with: pip install --user asciinema" >&2
  exit 1
fi

exec asciinema rec \
  -t "NuAuth — Cardano Preprod + Midnight Preview (sandbox walkthrough)" \
  "$OUT" \
  --overwrite \
  --command "env NUAUTH_DEMO_FAST=${NUAUTH_DEMO_FAST:-0} NUAUTH_DEMO_FORCE_COLOR=1 bash ${ROOT}/scripts/demo-nuauth-preview-sandbox-walkthrough.sh"
