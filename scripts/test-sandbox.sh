#!/usr/bin/env bash
# Cardano sandbox: Lucid Emulator + REST smoke. Full ZK-complete path also needs Midnight + attest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CARDANO_BACKEND="${CARDANO_BACKEND:-emulator}"

echo "== Cardano smoke (emulator) =="
deno task cardano:smoke:emulator

echo ""
echo "== Start API in another terminal: deno task serve:emulator"
echo "   Demo script (default strict Midnight): ./scripts/demo-backend-flow.sh"
echo "   Without Midnight: set NUAUTH_REQUIRE_MIDNIGHT_STRICT=false for Cardano-only license/decrypt."
echo ""
echo "Full milestone ZK path (Midnight + Cardano):"
echo "  1. contract: npm run contract:compact && npm run contract:build (from repo root per package.json)"
echo "  2. midnight-local-network Docker + npm run midnight:run-all (see midnight-local-cli/README.md)"
echo "  3. POST /api/creator/midnight/attest with CLI tx ids (or NUAUTH_MIDNIGHT_* env + demo script)"
echo "  TDD: docs/TDD.md"
