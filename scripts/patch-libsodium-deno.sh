#!/usr/bin/env bash
# Deno/npm layout: libsodium-wrappers-sumo imports ./libsodium-sumo.mjs next to wrappers;
# libsodium-sumo lives as a sibling package under .deno/*/node_modules/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
shopt -s nullglob
for nm in node_modules/.deno/libsodium-wrappers-sumo@*/node_modules; do
  SRC="$nm/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs"
  DST="$nm/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs"
  if [[ -f "$SRC" ]]; then
    mkdir -p "$(dirname "$DST")"
    cp -f "$SRC" "$DST"
    echo "patched libsodium: $DST"
  fi
done
