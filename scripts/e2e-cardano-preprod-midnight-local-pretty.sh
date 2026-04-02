#!/usr/bin/env bash
#
# NuAuth E2E — Cardano Preprod (Blockfrost) + Midnight local (undeployed / Brick Towers Docker)
#
#   ./scripts/e2e-cardano-preprod-midnight-local-pretty.sh
#
# Prereqs:
#   • .env: BLOCKFROST_*, WALLET_* / CREATOR_*, BUYER_*, ABE_MASTER_KEY_HEX, BIP39_MNEMONIC
#   • Preprod ADA for stamp + list + license
#   • https://github.com/bricktowers/midnight-local-network running (indexer :8088, node :9944, proof :6300)
#   • midnight-local-cli: npm install --no-workspaces; contract: npm run compact && npm run build; aiken build
#
# This script forces MIDNIGHT_DEPLOY_NETWORK=undeployed (ignores .env preprod for Midnight).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_JSON="${NUAUTH_E2E_OUT:-/tmp/nuauth-e2e-local-midnight-summary.json}"
PARTIAL_JSON="${OUT_JSON%.json}-cardano-partial.json"
API="${API_BASE:-http://127.0.0.1:${API_PORT:-8788}}"
INDEXER_PORT="${INDEXER_PORT:-8088}"
export NUAUTH_DATA_DIR="${NUAUTH_E2E_DATA_DIR:-/tmp/nuauth-e2e-local-$$}"
mkdir -p "$NUAUTH_DATA_DIR"

# ── styling (respect NO_COLOR) ─────────────────────────────────────────────
if [[ -n "${NO_COLOR:-}" ]]; then
  BOLD='' GREEN='' CYAN='' YELLOW='' RED='' DIM='' MAGENTA='' NC=''
  BOX_T='-' BOX_V='|'
else
  BOLD=$'\033[1m' GREEN=$'\033[32m' CYAN=$'\033[36m' YELLOW=$'\033[33m'
  RED=$'\033[31m' DIM=$'\033[2m' MAGENTA=$'\033[35m' NC=$'\033[0m'
fi

W=72
rule() { printf "%b%s%b\n" "$DIM" "$(printf '─%.0s' $(seq 1 "$W"))" "$NC"; }
hr() { printf "%b%s%b\n" "$CYAN" "$(printf '━%.0s' $(seq 1 "$W"))" "$NC"; }
# NUAUTH_E2E_CLEAR=1 — clear terminal before the banner

banner() {
  hr
  printf "%b %s%b\n" "$BOLD$MAGENTA" "$1" "$NC"
  hr
}

step_ok() { printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"; }
step_do() { printf "%b▶%b %s\n" "$CYAN" "$NC" "$1"; }
warn() { printf "%b!%b %s\n" "$YELLOW" "$NC" "$1"; }
die() { printf "%b✗%b %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

kv() {
  local k="$1" v="$2"
  printf "  %b%-26s%b %s\n" "$DIM" "$k" "$NC" "$v"
}

mono_line() {
  printf "      %b%s%b\n" "$DIM" "$1" "$NC"
}

check_midnight_indexer() {
  local url="http://127.0.0.1:${INDEXER_PORT}/api/v4/graphql"
  local code
  code="$(curl -sS -m 5 -o /tmp/nuauth-gq.json -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}' \
    "$url" 2>/dev/null || echo "000")"
  [[ "$code" == "200" ]]
}

# ── env ─────────────────────────────────────────────────────────────────────
set -a
# shellcheck disable=SC1091
source "${ROOT}/.env"
set +a

export CARDANO_BACKEND="${CARDANO_BACKEND:-blockfrost}"
export MIDNIGHT_DEPLOY_NETWORK=undeployed

if [[ "${NUAUTH_E2E_CLEAR:-}" == "1" ]]; then clear 2>/dev/null || true; fi
banner "NuAuth E2E — Cardano Preprod + Midnight local (undeployed)"
kv "Midnight" "MIDNIGHT_DEPLOY_NETWORK=${MIDNIGHT_DEPLOY_NETWORK} (Brick Towers Docker)"
kv "Cardano" "${CARDANO_BACKEND} / ${CARDANO_NETWORK:-Preprod}"
kv "API" "$API"
kv "Data dir" "$NUAUTH_DATA_DIR"
rule

step_do "Preflight: Midnight indexer (127.0.0.1:${INDEXER_PORT}/api/v4/graphql)"
if check_midnight_indexer; then
  step_ok "Indexer reachable"
else
  die "Indexer not reachable. Start midnight-local-network (see https://github.com/bricktowers/midnight-local-network) then retry."
fi

if [[ ! -d "${ROOT}/midnight-local-cli/node_modules" ]]; then
  die "Run: cd midnight-local-cli && npm install --no-workspaces"
fi
step_ok "midnight-local-cli dependencies present"

bash "${ROOT}/scripts/patch-libsodium-deno.sh" >/dev/null
step_ok "libsodium patch (Deno)"

step_do "Starting NuAuth API…"
deno run --allow-net --allow-env --allow-read --allow-write "${ROOT}/backend/api/main.ts" &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  if curl -fsS "$API/health" >/dev/null 2>&1; then break; fi
  sleep 0.4
done
curl -fsS "$API/health" >/dev/null || die "API did not start on $API"

HEALTH_JSON="$(curl -fsS "$API/health")"
step_ok "API healthy — $(echo "$HEALTH_JSON" | jq -r '"\(.service) · \(.network)"' 2>/dev/null || echo ok)"
rule

PAYLOAD="$(printf '%s' "nuauth-e2e-local $(date -Iseconds)" | base64 | tr -d '\n')"

step_do "POST /api/creator/register"
REG_JSON="$(curl -fsS -X POST "${API}/api/creator/register" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"e2e-local.txt\",\"contentBase64\":\"${PAYLOAD}\"}")"
DATASET_ID="$(echo "$REG_JSON" | jq -r .datasetId)"
COMMITMENT="$(echo "$REG_JSON" | jq -r .commitment)"
CREATOR_ADDR="$(echo "$REG_JSON" | jq -r .creatorAddress)"
[[ -n "$DATASET_ID" && "$DATASET_ID" != "null" ]] || die "register failed"
step_ok "Dataset registered"
kv "datasetId" "$DATASET_ID"
mono_line "commitment $COMMITMENT"
mono_line "creator   $CREATOR_ADDR"
rule

step_do "POST /api/creator/stamp (Cardano Preprod metadata tx)"
STAMP_JSON="$(curl -fsS -X POST "${API}/api/creator/stamp" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\"}")"
STAMP_TX="$(echo "$STAMP_JSON" | jq -r .txHash)"
L1_ANCHOR="$(echo "$STAMP_JSON" | jq -r '.midnight.l1AnchorDigestHex // empty')"
[[ -n "$STAMP_TX" && "$STAMP_TX" != "null" ]] || die "stamp failed"
[[ -n "$L1_ANCHOR" && "$L1_ANCHOR" != "null" ]] || die "stamp missing l1AnchorDigestHex"
step_ok "Cardano stamp submitted"
mono_line "$STAMP_TX"
kv "l1AnchorDigestHex" "$L1_ANCHOR"

jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg commitment "$COMMITMENT" \
  --arg cardanoStampTx "$STAMP_TX" \
  --arg l1Anchor "$L1_ANCHOR" \
  --arg dataDir "$NUAUTH_DATA_DIR" \
  '{
    phase: "cardano_stamp_done",
    midnightDeployNetwork: "undeployed",
    nuauthDataDir: $dataDir,
    datasetId: $datasetId,
    contentCommitmentHex: $commitment,
    cardano: { stampTxHash: $cardanoStampTx, l1AnchorDigestHex: $l1Anchor }
  }' > "$PARTIAL_JSON"
warn "Checkpoint: $PARTIAL_JSON (if Midnight fails, re-run CLI with exports from this file)"
rule

export NUAUTH_CONTENT_COMMITMENT_HEX="$COMMITMENT"
export NUAUTH_L1_ANCHOR_HEX="$L1_ANCHOR"
export NUAUTH_CREATOR_SK_HEX="${NUAUTH_CREATOR_SK_HEX:-$(openssl rand -hex 32)}"

step_do "npm run midnight:run-all (local Midnight — deploy + ZK circuits)"
echo ""
MID_LOG="$(mktemp)"
if ( cd "${ROOT}/midnight-local-cli" && npm run run-all 2>&1 | tee "$MID_LOG" ); then
  :
else
  echo ""
  die "Midnight CLI failed — log: $MID_LOG (Cardano data in $PARTIAL_JSON)"
fi
echo ""

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

[[ -n "$CONTRACT_ADDR" && -n "$PROVE_TX" && -n "$BIND_TX" ]] || die "Could not parse Midnight CLI log: $MID_LOG"
step_ok "Midnight contract + circuits"
kv "contractAddress" "$CONTRACT_ADDR"
mono_line "deploy  $DEPLOY_TX"
mono_line "prove   $PROVE_TX"
mono_line "bindL1  $BIND_TX"
rule

step_do "POST /api/creator/midnight/attest"
ATT_JSON="$(curl -fsS -X POST "${API}/api/creator/midnight/attest" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"contractAddress\":\"${CONTRACT_ADDR}\",\"proveCreatorStampTxHash\":\"${PROVE_TX}\",\"bindL1StampTxHash\":\"${BIND_TX}\"}")"
if echo "$ATT_JSON" | jq -e '.zkComplete == true' >/dev/null 2>&1; then
  step_ok "Registry: ZK-complete"
else
  warn "Unexpected attest payload (expected zkComplete: true):"
  echo "$ATT_JSON" | jq . 2>/dev/null || echo "$ATT_JSON"
fi
rule

step_do "POST /api/creator/list-license (Plutus listing UTxO)"
LIST_JSON="$(curl -fsS -X POST "${API}/api/creator/list-license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"priceLovelace\":2000000,\"lockLovelace\":5000000}")"
LIST_LOCK_TX="$(echo "$LIST_JSON" | jq -r '.licenseListing.lockTxHash // empty')"
[[ -n "$LIST_LOCK_TX" ]] || die "list-license failed"
step_ok "Listing locked on-chain"
mono_line "$LIST_LOCK_TX"
rule

step_do "POST /api/developer/license (spend listing + pay seller)"
LIC_JSON="$(curl -fsS -X POST "${API}/api/developer/license" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\",\"lovelace\":2000000}")"
LICENSE_TX="$(echo "$LIC_JSON" | jq -r .txHash)"
[[ -n "$LICENSE_TX" && "$LICENSE_TX" != "null" ]] || die "license failed"
step_ok "License purchase confirmed"
mono_line "$LICENSE_TX"
rule

step_do "POST /api/developer/decrypt (ABE gate)"
DEC_JSON="$(curl -fsS -X POST "${API}/api/developer/decrypt" \
  -H 'Content-Type: application/json' \
  -d "{\"datasetId\":\"${DATASET_ID}\"}")"
echo "$DEC_JSON" | jq -e '.plaintextBase64 != null' >/dev/null || die "decrypt failed"
step_ok "Plaintext recovered (base64 in response)"
rule

# ── machine-readable summary ────────────────────────────────────────────────
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg commitment "$COMMITMENT" \
  --arg cardanoStampTx "$STAMP_TX" \
  --arg l1Anchor "$L1_ANCHOR" \
  --arg midnightDeployTx "$DEPLOY_TX" \
  --arg midnightContract "$CONTRACT_ADDR" \
  --arg midnightProveTx "$PROVE_TX" \
  --arg midnightBindTx "$BIND_TX" \
  --arg plutusListLockTx "$LIST_LOCK_TX" \
  --arg cardanoLicensePurchaseTx "$LICENSE_TX" \
  --arg dataDir "$NUAUTH_DATA_DIR" \
  --arg midLog "$MID_LOG" \
  '{
    ok: true,
    midnightDeployNetwork: "undeployed",
    nuauthDataDir: $dataDir,
    midnightCliLog: $midLog,
    datasetId: $datasetId,
    contentCommitmentHex: $commitment,
    cardanoPreprod: {
      stampTxHash: $cardanoStampTx,
      licenseListingLockTxHash: $plutusListLockTx,
      licensePurchaseTxHash: $cardanoLicensePurchaseTx,
      l1AnchorDigestHex: $l1Anchor
    },
    midnightLocal: {
      contractAddress: $midnightContract,
      deployTxHash: $midnightDeployTx,
      proveCreatorStampTxHash: $midnightProveTx,
      bindL1StampTxHash: $midnightBindTx
    },
    explorers: {
      cardanoPreprod: "https://preprod.cardanoscan.io/",
      midnightLocalNote: "Use Brick Towers explorer or indexer GraphQL for undeployed chain"
    }
  }' > "$OUT_JSON"

# ── final visual report (full-width hashes) ───────────────────────────────────
banner "Transaction & reference summary"

echo -e "\n${BOLD}${GREEN}Cardano — Preprod (Blockfrost)${NC}"
rule
printf "  %b%-22s%b\n" "$DIM" "stampTxHash" "$NC"
mono_line "$STAMP_TX"
printf "  %b%-22s%b\n" "$DIM" "listingLockTxHash" "$NC"
mono_line "$LIST_LOCK_TX"
printf "  %b%-22s%b\n" "$DIM" "licensePurchaseTxHash" "$NC"
mono_line "$LICENSE_TX"
printf "  %b%-22s%b\n" "$DIM" "l1AnchorDigestHex" "$NC"
mono_line "$L1_ANCHOR"

echo -e "\n${BOLD}${GREEN}Midnight — local (undeployed)${NC}"
rule
printf "  %b%-22s%b\n" "$DIM" "deployTxHash" "$NC"
mono_line "$DEPLOY_TX"
printf "  %b%-22s%b\n" "$DIM" "proveCreatorStampTxHash" "$NC"
mono_line "$PROVE_TX"
printf "  %b%-22s%b\n" "$DIM" "bindL1StampTxHash" "$NC"
mono_line "$BIND_TX"
printf "  %b%-22s%b\n" "$DIM" "contractAddress" "$NC"
mono_line "$CONTRACT_ADDR"

echo -e "\n${BOLD}${GREEN}Registry${NC}"
rule
mono_line "datasetId  $DATASET_ID"
mono_line "explorer   https://preprod.cardanoscan.io/transaction/$STAMP_TX"

rule
kv "JSON summary" "$OUT_JSON"
kv "Midnight CLI log" "$MID_LOG"
step_ok "E2E complete"
hr
