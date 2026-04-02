#!/usr/bin/env bash
#
# NuAuth sandbox walkthrough — Cardano Preprod + Midnight Preview (offline playback).
# Replays outputs from fixtures/nuauth-preview-e2e-replay.json (same tx hashes as the captured run).
# No network calls; no .env required.
#
# Pacing mimics a real session (wallet sync, DUST, ZK proving). Override with NUAUTH_DEMO_FAST=1.
#
# Record:
#   bash scripts/record-nuauth-preview-asciinema.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="${NUAUTH_REPLAY_FIXTURE:-$ROOT/fixtures/nuauth-preview-e2e-replay.json}"

if [[ ! -f "$FIXTURE" ]]; then
  echo "Missing fixture: $FIXTURE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "This script requires jq." >&2
  exit 1
fi

# Colors: NUAUTH_DEMO_FORCE_COLOR=1 wins (asciinema often sets NO_COLOR + TERM=dumb)
USE_COLOR=0
if [[ "${NUAUTH_DEMO_FORCE_COLOR:-}" == "1" ]]; then
  USE_COLOR=1
elif [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 ]]; then
  USE_COLOR=1
fi
if [[ "$USE_COLOR" == "1" ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  R=$'\033[31m'
  G=$'\033[32m'
  Y=$'\033[33m'
  B=$'\033[34m'
  M=$'\033[35m'
  C=$'\033[36m'
  W=$'\033[97m'
  NC=$'\033[0m'
else
  BOLD='' DIM='' R='' G='' Y='' B='' M='' C='' W='' NC=''
fi

_jq() {
  if [[ "$USE_COLOR" == "1" ]]; then
    jq -C "$@" 2>/dev/null || jq "$@"
  else
    jq "$@"
  fi
}

if [[ "${NUAUTH_DEMO_FAST:-}" == "1" ]]; then
  P_SHORT=0.2
  P_MED=0.4
  P_LONG=0.6
  P_XL=1
  P_SYNC=2
  P_DUST=2
  P_ZK_DEPLOY=3
  P_ZK_PROVE=4
  P_ZK_BIND=3
else
  # Realistic-feel pauses (seconds) — mirrors wallet sync / proving waits on Preview
  P_SHORT=2
  P_MED=4
  P_LONG=7
  P_XL=10
  P_SYNC=14
  P_DUST=10
  P_ZK_DEPLOY=22
  P_ZK_PROVE=48
  P_ZK_BIND=36
fi

pause() { sleep "$1"; }

hr() {
  printf '%b%s%b\n' "$DIM" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$NC"
}

banner() {
  hr
  printf '%b %s%b\n' "$BOLD$M" "$1" "$NC"
  hr
  pause "$P_SHORT"
}

step_title() {
  printf '\n%b▶ %s%b\n' "$BOLD$C" "$1" "$NC"
  pause "$P_MED"
}

prompt() {
  printf '%b%s@%s%b:%b\$%b %b%s%b\n' "$DIM" "$USER" "nuauth" "$NC" "$G" "$NC" "$W" "$*" "$NC"
  pause "$P_SHORT"
}

note() {
  printf '%b%s%b\n' "$DIM$Y" "$1" "$NC"
}

highlight_hash() {
  printf '  %b%-18s%b %b%s%b\n' "$Y" "$1" "$NC" "$BOLD$G" "$2" "$NC"
}

read_fixture() {
  jq -r "$1" "$FIXTURE"
}

DATASET_ID="$(read_fixture '.datasetId')"
COMMIT="$(read_fixture '.contentCommitmentHex')"
STAMP_TX="$(read_fixture '.cardanoPreprod.stampTxHash')"
L1="$(read_fixture '.cardanoPreprod.l1AnchorDigestHex')"
LIST_TX="$(read_fixture '.cardanoPreprod.licenseListingLockTxHash')"
LIC_TX="$(read_fixture '.cardanoPreprod.licensePurchaseTxHash')"
DUST_TX="$(read_fixture '.midnightPreview.dustRegistrationTxId')"
DEPLOY_TX="$(read_fixture '.midnightPreview.deployTxHash')"
CONTRACT="$(read_fixture '.midnightPreview.contractAddress')"
PROVE_TX="$(read_fixture '.midnightPreview.proveCreatorStampTxHash')"
BIND_TX="$(read_fixture '.midnightPreview.bindL1StampTxHash')"
DEPLOY_BH="$(read_fixture '.midnightPreview.deployBlockHeight')"
PROVE_BH="$(read_fixture '.midnightPreview.proveBlockHeight')"
BIND_BH="$(read_fixture '.midnightPreview.bindBlockHeight')"
FNAME="$(read_fixture '.demoFilename')"
PB64="$(read_fixture '.plaintextBase64')"

CREATOR_ADDR="addr_test1qqe7et9t7fyuwsvkxtsvauhdanmekqgj3nzuhhva7c3aqryfwv32hch4m0mfkshdul73fstpx89l7h0z73t328p06g4snrcxhg"
BUYER_ADDR="$CREATOR_ADDR"
API="http://127.0.0.1:8788"
LIST_SCRIPT="addr_test1wpds7mz39fvs9ae3u9raktpw8txk77pxlhy70uph49h9stqshqrmf"

clear 2>/dev/null || true

banner "NuAuth — Sandbox walkthrough (Cardano Preprod · Midnight Preview)"
printf '%bReference data:%b %s\n' "$DIM" "$NC" "$FIXTURE"
printf '%bNetworks:%b       %sPreprod%s (ADA metadata + Plutus)  ·  %sPreview%s (tNIGHT / DUST / ZK)\n' \
  "$DIM" "$NC" "$BOLD$C" "$NC" "$BOLD$C" "$NC"
note "Playback from fixture — identical tx hashes to the captured successful run."
pause "$P_LONG"

# ── API health ──────────────────────────────────────────────────────────────
step_title "1 · API health check"
prompt "curl -fsS ${API}/health | jq ."
echo '{"service":"nuauth-marketplace-backend","network":"Preprod","ok":true}' | _jq .
pause "$P_MED"

# ── Register ─────────────────────────────────────────────────────────────────
step_title "2 · Creator register (content → commitment)"
prompt "curl -fsS -X POST \"${API}/api/creator/register\" -H 'Content-Type: application/json' \\"
printf '%b%s%b\n' "$DIM" "  -d '{\"filename\":\"${FNAME}\",\"contentBase64\":\"…\"}' | jq ." "$NC"
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg commitment "$COMMIT" \
  --arg creatorAddress "$CREATOR_ADDR" \
  '{datasetId:$datasetId, commitment:$commitment, creatorAddress:$creatorAddress}' | _jq .
highlight_hash "datasetId" "$DATASET_ID"
highlight_hash "commitment" "$COMMIT"
pause "$P_LONG"

# ── Stamp ───────────────────────────────────────────────────────────────────
step_title "3 · Creator stamp (Cardano Preprod on-chain metadata)"
note "Typical wait: Blockfrost submit + block inclusion…"
pause "$P_MED"
prompt "curl -fsS -X POST \"${API}/api/creator/stamp\" -H 'Content-Type: application/json' \\"
printf '%b%s%b\n' "$DIM" "  -d '{\"datasetId\":\"${DATASET_ID}\"}' | jq ." "$NC"
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg txHash "$STAMP_TX" \
  --arg l1 "$L1" \
  '{datasetId:$datasetId, txHash:$txHash, midnight:{l1AnchorDigestHex:$l1}}' | _jq .
highlight_hash "stampTx (Preprod)" "$STAMP_TX"
highlight_hash "l1AnchorDigestHex" "$L1"
pause "$P_XL"

# ── Midnight CLI ────────────────────────────────────────────────────────────
step_title "4 · Midnight Preview — wallet, DUST, deploy + ZK circuits"
prompt "export MIDNIGHT_DEPLOY_NETWORK=preview"
prompt "export NUAUTH_CONTENT_COMMITMENT_HEX=${COMMIT:0:16}…"
prompt "export NUAUTH_L1_ANCHOR_HEX=${L1:0:16}…"
prompt "cd midnight-local-cli && npm run run-all"
printf '\n%b%s%b\n' "$C" "> @nuauth/midnight-local-cli@0.1.0 run-all" "$NC"
printf '%b%s%b\n' "$C" "> tsx src/run-nuauth-all.ts" "$NC"
printf '\n'
note "Waiting for wallet sync (indexer + relay)…"
pause "$P_SYNC"
printf '%b%s%b\n' "$G" "Synced." "$NC"
printf '\n'
note "Ensuring DUST for fee balancing (register unshielded UTXOs)…"
pause "$P_DUST"
printf '%b%s%b\n' "$Y" "[dust] registering UTXO(s) for dust generation…" "$NC"
printf '%b%s%b\n' "$G" "[dust] submitted dust registration txId: ${DUST_TX}" "$NC"
printf '%b%s%b\n' "$G" "DUST ready." "$NC"
printf '\n'
note "Deploying contract (ZK proving + balance — can take a while on Preview)…"
pause "$P_ZK_DEPLOY"
printf '%b%s%b\n' "$W" "deploy: txId=002c1a04… txHash=${DEPLOY_TX} blockHeight=${DEPLOY_BH}" "$NC"
highlight_hash "deploy txHash" "$DEPLOY_TX"
printf '%b%s%b\n' "$M" "Contract address: ${CONTRACT}" "$NC"
printf '\n'
note "proveCreatorStamp — prover + indexer round-trip…"
pause "$P_ZK_PROVE"
printf '%b%s%b\n' "$W" "proveCreatorStamp (ZK): txHash=${PROVE_TX} blockHeight=${PROVE_BH}" "$NC"
highlight_hash "proveCreatorStamp" "$PROVE_TX"
printf '\n'
note "bindL1Stamp — bind Midnight state to Cardano L1 digest…"
pause "$P_ZK_BIND"
printf '%b%s%b\n' "$W" "bindL1Stamp (ZK + L1 anchor): txHash=${BIND_TX} blockHeight=${BIND_BH}" "$NC"
highlight_hash "bindL1Stamp" "$BIND_TX"
printf '\n%b%s%b\n' "$G" "Done. All NuAuth ZK stamp circuits submitted." "$NC"
pause "$P_LONG"

# ── Attest ──────────────────────────────────────────────────────────────────
step_title "5 · Registry — POST /api/creator/midnight/attest"
prompt "curl -fsS -X POST \"${API}/api/creator/midnight/attest\" … | jq ."
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg contractAddress "$CONTRACT" \
  --arg prove "$PROVE_TX" \
  --arg bind "$BIND_TX" \
  '{
    datasetId:$datasetId,
    zkComplete:true,
    midnightAttestation:{
      contractAddress:$contractAddress,
      proveCreatorStampTxHash:$prove,
      bindL1StampTxHash:$bind,
      attestedAt:"2026-04-02T08:29:03.543Z"
    }
  }' | _jq .
printf '%b%s%b\n' "$G" "zkComplete: true" "$NC"
pause "$P_MED"

# ── List license ─────────────────────────────────────────────────────────────
step_title "6 · Creator — Plutus listing (lock UTxO)"
note "Building + submitting listing transaction…"
pause "$P_MED"
prompt "curl -fsS -X POST \"${API}/api/creator/list-license\" … | jq ."
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg lockTxHash "$LIST_TX" \
  --arg scriptAddress "$LIST_SCRIPT" \
  '{
    datasetId:$datasetId,
    licenseListing:{
      lockTxHash:$lockTxHash,
      outputIndex:0,
      priceLovelace:"2000000",
      lockLovelace:"5000000",
      scriptAddress:$scriptAddress,
      listedAt:"2026-04-02T08:29:14.359Z"
    }
  }' | _jq .
highlight_hash "listing lockTx" "$LIST_TX"
pause "$P_LONG"

# ── License purchase ───────────────────────────────────────────────────────────
step_title "7 · Developer — purchase license (spend listing)"
note "Buyer wallet signs purchase + seller receives payment…"
pause "$P_LONG"
prompt "curl -fsS -X POST \"${API}/api/developer/license\" … | jq ."
jq -n \
  --arg txHash "$LIC_TX" \
  --arg datasetId "$DATASET_ID" \
  --arg buyer "$BUYER_ADDR" \
  '{
    txHash:$txHash,
    datasetId:$datasetId,
    buyerAddress:$buyer,
    lovelace:"2000000",
    kind:"plutus_v3_listing"
  }' | _jq .
highlight_hash "license purchase tx" "$LIC_TX"
pause "$P_LONG"

# ── Decrypt ─────────────────────────────────────────────────────────────────
step_title "8 · Developer — decrypt (ABE gate after license)"
prompt "curl -fsS -X POST \"${API}/api/developer/decrypt\" … | jq ."
jq -n \
  --arg datasetId "$DATASET_ID" \
  --arg filename "$FNAME" \
  --arg plaintextBase64 "$PB64" \
  '{datasetId:$datasetId, filename:$filename, plaintextBase64:$plaintextBase64}' | _jq .
printf '%b%s%b\n' "$G" "Plaintext recovered (ABE + policy satisfied)." "$NC"
pause "$P_MED"

# ── Summary ─────────────────────────────────────────────────────────────────
step_title "9 · Summary — fixture JSON"
prompt "jq . fixtures/nuauth-preview-e2e-replay.json"
_jq . <"$FIXTURE"
pause "$P_MED"

banner "Explorers & links"
printf '%b%s%b\n' "$C" "Cardano Preprod (stamp):" "$NC"
printf '%s\n' "https://preprod.cardanoscan.io/transaction/${STAMP_TX}"
printf '\n%b%s%b\n' "$C" "Midnight Preview — contract:" "$NC"
printf '%b%s%b\n' "$G" "$CONTRACT" "$NC"
hr
printf '%b%s%b\n' "$DIM" "Walkthrough complete. (Offline playback — no new transactions submitted.)" "$NC"
