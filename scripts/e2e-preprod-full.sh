#!/usr/bin/env bash
# Cardano Preprod (Blockfrost) + Midnight (preview | preprod | undeployed) full NuAuth flow.
#
# If you see repeated "1006:: Abnormal Closure" on wss://rpc.*.midnight.network, the public relay
# is dropping WebSockets — try MIDNIGHT_DEPLOY_NETWORK=preview (different RPC) or local Docker
# (MIDNIGHT_DEPLOY_NETWORK=undeployed + midnight-local-network).
#
# Prereqs: .env (BLOCKFROST_*, WALLET_*, ABE_MASTER_KEY_HEX, BIP39_MNEMONIC),
#          funded Cardano Preprod ADA + Midnight wallet on the chosen MIDNIGHT_DEPLOY_NETWORK,
#          contract compact+build, aiken build, midnight-local-cli npm install.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_JSON="${NUAUTH_E2E_OUT:-/tmp/nuauth-e2e-preprod-summary.json}"
PARTIAL_JSON="${OUT_JSON%.json}-cardano-partial.json"
API="${API_BASE:-http://127.0.0.1:${API_PORT:-8788}}"
export NUAUTH_DATA_DIR="${NUAUTH_E2E_DATA_DIR:-/tmp/nuauth-e2e-preprod-$$}"
mkdir -p "$NUAUTH_DATA_DIR"

set -a
# shellcheck disable=SC1091
source "${ROOT}/.env"
set +a

export CARDANO_BACKEND="${CARDANO_BACKEND:-blockfrost}"
export MIDNIGHT_DEPLOY_NETWORK="${MIDNIGHT_DEPLOY_NETWORK:-preprod}"

bash "${ROOT}/scripts/patch-libsodium-deno.sh" >/dev/null

echo "== Starting API (data: $NUAUTH_DATA_DIR) ==" >&2
deno run --allow-net --allow-env --allow-read --allow-write "${ROOT}/backend/api/main.ts" &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$API/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS "$API/health" | jq . >&2 || { echo "API failed to start" >&2; exit 1; }

PAYLOAD="$(printf '%s' "nuauth-e2e-preprod $(date -Iseconds)" | base64 | tr -d '\n')"

echo "== POST /api/creator/register ==" >&2
REG_JSON="$(curl -fsS -X POST "${API}/api/creator/register" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"e2e-preprod.txt\",\"contentBase64\":\"${PAYLOAD}\"}")"
echo "$REG_JSON" | jq . >&2
DATASET_ID="$(echo "$REG_JSON" | jq -r .datasetId)"
COMMITMENT="$(echo "$REG_JSON" | jq -r .commitment)"

echo "== POST /api/creator/stamp ==" >&2
STAMP_JSON="$(curl -fsS -X POST "${API}/api/creator/stamp" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\"}")"
echo "$STAMP_JSON" | jq . >&2
STAMP_TX="$(echo "$STAMP_JSON" | jq -r .txHash)"
L1_ANCHOR="$(echo "$STAMP_JSON" | jq -r '.midnight.l1AnchorDigestHex // empty')"

if [[ -z "$L1_ANCHOR" || "$L1_ANCHOR" == "null" ]]; then
  echo "Stamp response missing midnight.l1AnchorDigestHex" >&2
  exit 1
fi

jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg commitment "$COMMITMENT" \
  --arg cardanoStampTx "$STAMP_TX" \
  --arg l1Anchor "$L1_ANCHOR" \
  --arg midNet "$MIDNIGHT_DEPLOY_NETWORK" \
  --arg dataDir "$NUAUTH_DATA_DIR" \
  '{
    ok: false,
    phase: "cardano_stamp_complete_midnight_pending",
    note: "Cardano steps succeeded. Run midnight-local-cli next; if sync hangs on wss 1006, try MIDNIGHT_DEPLOY_NETWORK=preview or local undeployed.",
    nuauthDataDir: $dataDir,
    midnightDeployNetwork: $midNet,
    datasetId: $datasetId,
    contentCommitmentHex: $commitment,
    exportForMidnightCLI: {
      NUAUTH_CONTENT_COMMITMENT_HEX: $commitment,
      NUAUTH_L1_ANCHOR_HEX: $l1Anchor
    },
    cardano: {
      network: "Preprod (Blockfrost)",
      stampTxHash: $cardanoStampTx,
      l1AnchorDigestHex: $l1Anchor
    }
  }' | tee "$PARTIAL_JSON" >/dev/null

echo "== Cardano partial summary (safe if Midnight fails): $PARTIAL_JSON ==" >&2

export NUAUTH_CONTENT_COMMITMENT_HEX="$COMMITMENT"
export NUAUTH_L1_ANCHOR_HEX="$L1_ANCHOR"
export NUAUTH_CREATOR_SK_HEX="${NUAUTH_CREATOR_SK_HEX:-$(openssl rand -hex 32)}"

echo "== npm run midnight:run-all (MIDNIGHT_DEPLOY_NETWORK=$MIDNIGHT_DEPLOY_NETWORK) ==" >&2
MID_LOG="$(mktemp)"
set +e
( cd "${ROOT}/midnight-local-cli" && npm run run-all 2>&1 | tee "$MID_LOG" )
MID_EXIT=$?
set -e

if [[ "$MID_EXIT" -ne 0 ]]; then
  echo "" >&2
  echo "━━━━━━━━ Midnight CLI failed (exit $MID_EXIT) ━━━━━━━━" >&2
  echo "Cardano tx ids are saved in: $PARTIAL_JSON" >&2
  echo "Full CLI log: $MID_LOG" >&2
  echo "" >&2
  echo "Repeated '1006:: Abnormal Closure' on wss://rpc.preprod.midnight.network means the Preprod" >&2
  echo "relay closed the WebSocket — sync cannot finish. Try:" >&2
  echo "  1) MIDNIGHT_DEPLOY_NETWORK=preview  + fund https://faucet.preview.midnight.network/ (new address: npm run midnight:print-address)" >&2
  echo "  2) Different network / disable VPN / retry later" >&2
  echo "  3) MIDNIGHT_DEPLOY_NETWORK=undeployed + https://github.com/bricktowers/midnight-local-network" >&2
  tail -40 "$MID_LOG" >&2
  exit "$MID_EXIT"
fi

CONTRACT_ADDR="$(grep -oP 'Contract address:\s*\K\S+' "$MID_LOG" | tail -1 || true)"
DEPLOY_LINE="$(grep '^deploy:' "$MID_LOG" | head -1 || true)"
PROVE_LINE="$(grep 'proveCreatorStamp' "$MID_LOG" | head -1 || true)"
BIND_LINE="$(grep 'bindL1Stamp' "$MID_LOG" | head -1 || true)"

extract_hash() {
  local line="$1"
  if [[ "$line" =~ txHash=([0-9a-fA-F]+) ]]; then echo "${BASH_REMATCH[1]}"; else echo ""; fi
}

DEPLOY_TX="$(extract_hash "$DEPLOY_LINE")"
PROVE_TX="$(extract_hash "$PROVE_LINE")"
BIND_TX="$(extract_hash "$BIND_LINE")"

if [[ -z "$CONTRACT_ADDR" || -z "$PROVE_TX" || -z "$BIND_TX" ]]; then
  echo "Failed to parse Midnight CLI output; raw log: $MID_LOG" >&2
  tail -100 "$MID_LOG" >&2
  exit 1
fi

echo "== POST /api/creator/midnight/attest ==" >&2
ATT_JSON="$(curl -fsS -X POST "${API}/api/creator/midnight/attest" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"contractAddress\":\"${CONTRACT_ADDR}\",\"proveCreatorStampTxHash\":\"${PROVE_TX}\",\"bindL1StampTxHash\":\"${BIND_TX}\"}")"
echo "$ATT_JSON" | jq . >&2

echo "== POST /api/creator/list-license ==" >&2
LIST_JSON="$(curl -fsS -X POST "${API}/api/creator/list-license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"priceLovelace\":2000000,\"lockLovelace\":5000000}")"
echo "$LIST_JSON" | jq . >&2
LIST_LOCK_TX="$(echo "$LIST_JSON" | jq -r '.licenseListing.lockTxHash // empty')"

echo "== POST /api/developer/license ==" >&2
LIC_JSON="$(curl -fsS -X POST "${API}/api/developer/license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"lovelace\":2000000}")"
echo "$LIC_JSON" | jq . >&2
LICENSE_TX="$(echo "$LIC_JSON" | jq -r .txHash)"

echo "== POST /api/developer/decrypt ==" >&2
DEC_JSON="$(curl -fsS -X POST "${API}/api/developer/decrypt" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\"}")"
echo "$DEC_JSON" | jq '{datasetId, filename, plaintextOk: (.plaintextBase64 != null)}' >&2

MID_EXPLORER="https://explorer.preprod.midnight.network/"
if [[ "${MIDNIGHT_DEPLOY_NETWORK}" == "preview" ]]; then
  MID_EXPLORER="https://explorer.preview.midnight.network/"
fi

jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg commitment "$COMMITMENT" \
  --arg cardanoStampTx "$STAMP_TX" \
  --arg l1Anchor "$L1_ANCHOR" \
  --arg midNet "$MIDNIGHT_DEPLOY_NETWORK" \
  --arg midnightDeployTx "$DEPLOY_TX" \
  --arg midnightContract "$CONTRACT_ADDR" \
  --arg midnightProveTx "$PROVE_TX" \
  --arg midnightBindTx "$BIND_TX" \
  --arg plutusListLockTx "$LIST_LOCK_TX" \
  --arg cardanoLicensePurchaseTx "$LICENSE_TX" \
  --arg dataDir "$NUAUTH_DATA_DIR" \
  --arg midLog "$MID_LOG" \
  --arg midExplorer "$MID_EXPLORER" \
  '{
    ok: true,
    nuauthDataDir: $dataDir,
    midnightCliLog: $midLog,
    datasetId: $datasetId,
    contentCommitmentHex: $commitment,
    cardano: {
      network: "Preprod (Blockfrost)",
      stampTxHash: $cardanoStampTx,
      licenseListingLockTxHash: $plutusListLockTx,
      licensePurchaseTxHash: $cardanoLicensePurchaseTx
    },
    midnight: {
      deployNetwork: $midNet,
      contractAddress: $midnightContract,
      deployTxHash: $midnightDeployTx,
      proveCreatorStampTxHash: $midnightProveTx,
      bindL1StampTxHash: $midnightBindTx,
      l1AnchorFromCardanoStamp: $l1Anchor
    },
    explorers: {
      cardanoPreprod: "https://preprod.cardanoscan.io/",
      midnight: $midExplorer
    }
  }' | tee "$OUT_JSON"

echo "== Summary written to $OUT_JSON ==" >&2
