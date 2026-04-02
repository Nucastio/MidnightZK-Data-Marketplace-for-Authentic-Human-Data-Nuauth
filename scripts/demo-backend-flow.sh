#!/usr/bin/env bash
# End-to-end backend demo: Creator + Midnight ZK attestation + AI developer (license + decrypt).
# Requires a running API (`deno task serve` or `deno task serve:emulator`).
#
# After Cardano stamp you MUST run Midnight ZK (`npm run midnight:run-all` with commitment + l1 anchor),
# then provide attestation env vars so this script can call POST /api/creator/midnight/attest.
#
# Usage: ./scripts/demo-backend-flow.sh [API_BASE_URL]
#
# Optional env (after running midnight-local-cli):
#   NUAUTH_MIDNIGHT_CONTRACT      - deployed contract address (string)
#   NUAUTH_MIDNIGHT_PROVE_TX      - proveCreatorStamp tx / segment id (hex)
#   NUAUTH_MIDNIGHT_BIND_TX       - bindL1Stamp tx / segment id (hex)
#
# Dev only — relax ZK gate (NOT for SRS demos):
#   NUAUTH_REQUIRE_MIDNIGHT_STRICT=false
set -euo pipefail
API="${1:-http://127.0.0.1:8788}"
PAYLOAD="$(printf '%s' "human-labeled dataset row 1" | base64 | tr -d '\n')"

echo "== Register (creator) =="
REG_JSON="$(curl -fsS -X POST "${API}/api/creator/register" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"demo.txt\",\"contentBase64\":\"${PAYLOAD}\"}")"
echo "$REG_JSON" | (command -v jq >/dev/null && jq . || cat)
if command -v jq >/dev/null; then
  ID="$(echo "$REG_JSON" | jq -r .datasetId)"
  COMMITMENT="$(echo "$REG_JSON" | jq -r .commitment)"
else
  ID="$(echo "$REG_JSON" | sed -n 's/.*"datasetId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  COMMITMENT=""
fi
if [[ -z "$ID" || "$ID" == "null" ]]; then
  echo "Could not parse datasetId (install jq for reliable JSON parsing)." >&2
  exit 1
fi

echo "== Stamp (Cardano metadata tx) =="
STAMP_JSON="$(curl -fsS -X POST "${API}/api/creator/stamp" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${ID}\"}")"
echo "$STAMP_JSON" | (command -v jq >/dev/null && jq . || cat)

STRICT="${NUAUTH_REQUIRE_MIDNIGHT_STRICT:-true}"
SL="$(printf '%s' "$STRICT" | tr '[:upper:]' '[:lower:]')"
if [[ "$STRICT" == "0" || "$SL" == "false" ]]; then
  echo "== (Skipping Midnight — NUAUTH_REQUIRE_MIDNIGHT_STRICT is off) =="
else
  if command -v jq >/dev/null; then
    L1="$(echo "$STAMP_JSON" | jq -r '.midnight.l1AnchorDigestHex // empty')"
  else
    L1=""
  fi
  echo ""
  echo "== Midnight ZK (required) =="
  echo "Use dataset commitment (64 hex) for NUAUTH_CONTENT_COMMITMENT_HEX:"
  echo "  ${COMMITMENT:-<from GET /api/datasets/${ID}>}"
  echo "Use l1 anchor digest from stamp response for NUAUTH_L1_ANCHOR_HEX:"
  echo "  ${L1:-<from stamp JSON .midnight.l1AnchorDigestHex>}"
  echo "Then: npm run midnight:run-all (see midnight-local-cli/README.md)"
  echo ""

  if [[ -n "${NUAUTH_MIDNIGHT_CONTRACT:-}" && -n "${NUAUTH_MIDNIGHT_PROVE_TX:-}" && -n "${NUAUTH_MIDNIGHT_BIND_TX:-}" ]]; then
    echo "== Midnight attestation (API) =="
    curl -fsS -X POST "${API}/api/creator/midnight/attest" \
      -H 'Content-Type: application/json' \
      -d "{\"datasetId\":\"${ID}\",\"contractAddress\":\"${NUAUTH_MIDNIGHT_CONTRACT}\",\"proveCreatorStampTxHash\":\"${NUAUTH_MIDNIGHT_PROVE_TX}\",\"bindL1StampTxHash\":\"${NUAUTH_MIDNIGHT_BIND_TX}\"}" \
      | (command -v jq >/dev/null && jq . || cat)
  else
    echo "Set NUAUTH_MIDNIGHT_CONTRACT, NUAUTH_MIDNIGHT_PROVE_TX, NUAUTH_MIDNIGHT_BIND_TX and re-run this script," >&2
    echo "or run curl POST .../midnight/attest manually. License/decrypt will 403 until attestation is recorded." >&2
    exit 1
  fi
fi

echo "== List license for sale (creator → Plutus script UTxO) =="
curl -fsS -X POST "${API}/api/creator/list-license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${ID}\",\"priceLovelace\":2000000,\"lockLovelace\":5000000}" \
  | (command -v jq >/dev/null && jq . || cat)

echo "== License (buyer spends listing + pays creator) =="
curl -fsS -X POST "${API}/api/developer/license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${ID}\",\"lovelace\":2000000}" | (command -v jq >/dev/null && jq . || cat)

echo "== Decrypt (buyer, ABE gate) =="
curl -fsS -X POST "${API}/api/developer/decrypt" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${ID}\"}" | (command -v jq >/dev/null && jq . || cat)

echo "Done. Decode plaintextBase64: echo '<value>' | base64 -d"
