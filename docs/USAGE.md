# Usage Guide

NuAuth implements a 6-step pipeline for registering, verifying, listing, and trading human data.

## Overview

```
Creator                          Marketplace                Developer
───────                          ───────────                ─────────
1. Register Dataset        →
2. Stamp on Cardano (L1)   →
3. ZK Attestation (Midnight)→
                                 4. List for Sale      →
                                                            5. Buy License
                                                            6. Decrypt Data
```

## Step 1: Register Dataset

Upload your content. The backend encrypts it with AES-GCM, computes a SHA-256 commitment, and stores the ciphertext.

**UI:** Paste text into the content area (or click "Load sample"), then click "Register dataset".

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/creator/register \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "my-data.txt",
    "contentBase64": "'$(echo -n "Your data content here" | base64)'"
  }'
```

**Returns:** `datasetId`, `commitment` (SHA-256 hex), `creatorAddress` (Cardano Bech32).

The `datasetId` is used in all subsequent steps.

## Step 2: Stamp on Cardano

Anchor the content commitment to Cardano L1 via a CIP-20 metadata transaction (label 674). This creates a public, timestamped record that the commitment existed at a specific block height.

**UI:** Click "Stamp on Cardano" (Step 2 unlocks after registration).

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/creator/stamp \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "YOUR_DATASET_ID"}'
```

**Returns:** `txHash` (Cardano transaction), `midnight.l1AnchorDigestHex` (used in Step 3).

View the transaction on [Cardanoscan (Preprod)](https://preprod.cardanoscan.io).

## Step 3: ZK Attestation (Midnight)

Prove creator authenticity using zero-knowledge circuits on the Midnight network. Two circuits execute:

1. **proveCreatorStamp** — proves knowledge of the creator secret key matching the on-ledger public key (authenticates the creator without revealing the secret)
2. **bindL1Stamp** — binds the Midnight contract to the Cardano L1 anchor (cross-chain verification)

### Server-side (automatic)

If `NUAUTH_SERVER_MIDNIGHT_CLI=1` is set, the UI's "Run Midnight ZK & Attest" button runs the full pipeline on the server. This takes 3-5 minutes.

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/creator/midnight/run-all-and-attest \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "YOUR_DATASET_ID"}'
```

### Manual (CLI)

Run the Midnight CLI directly:

```bash
export NUAUTH_CONTENT_COMMITMENT_HEX="<commitment from step 1>"
export NUAUTH_L1_ANCHOR_HEX="<l1AnchorDigestHex from step 2>"
npm run midnight:run-all
```

Then submit the attestation:

```bash
curl -X POST http://127.0.0.1:8788/api/creator/midnight/attest \
  -H 'Content-Type: application/json' \
  -d '{
    "datasetId": "YOUR_DATASET_ID",
    "contractAddress": "<from CLI output>",
    "proveCreatorStampTxHash": "<from CLI output>",
    "bindL1StampTxHash": "<from CLI output>"
  }'
```

## Step 4: List for Sale

Lock a Plutus V3 listing UTxO on Cardano with your asking price. The UTxO contains an inline datum with the seller's payment key hash, dataset ID, and price.

**UI:** Set the price in lovelace (1 ADA = 1,000,000 lovelace) and click "Create listing".

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/creator/list-license \
  -H 'Content-Type: application/json' \
  -d '{
    "datasetId": "YOUR_DATASET_ID",
    "priceLovelace": "2000000"
  }'
```

**Returns:** `licenseListing.lockTxHash`, `licenseListing.scriptAddress`.

## Step 5: Buy License

Spend the listing UTxO via the Plutus V3 validator. The buyer pays the exact asking price to the creator's address. The validator verifies the payment amount and recipient.

**UI:** Confirm the price matches and click "Purchase license".

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/developer/license \
  -H 'Content-Type: application/json' \
  -d '{
    "datasetId": "YOUR_DATASET_ID",
    "lovelace": "2000000"
  }'
```

The `lovelace` must exactly match the listing `priceLovelace`.

## Step 6: Decrypt Data

Recover the original plaintext. This is gated by two requirements:

1. **Active Plutus license** — the buyer must have purchased a license (Step 5)
2. **ZK attestation** — the dataset must be ZK-verified on Midnight (Step 3)

Both conditions must be met or the request is rejected with 403.

**UI:** Click "Recover plaintext".

**API:**

```bash
curl -X POST http://127.0.0.1:8788/api/developer/decrypt \
  -H 'Content-Type: application/json' \
  -d '{"datasetId": "YOUR_DATASET_ID"}'
```

**Returns:** `plaintextBase64` — decode with `echo "<base64>" | base64 -d`.

## Browsing the registry

View all registered datasets:

```bash
curl http://127.0.0.1:8788/api/datasets | python3 -m json.tool
```

View a single dataset:

```bash
curl http://127.0.0.1:8788/api/datasets/YOUR_DATASET_ID
```

Public fields include: ID, filename, creator, commitment, stamp tx, ZK status, and active listing info. Sensitive fields (encryption keys, blob paths) are excluded.

## Activity log

The UI includes a split activity log (Cardano L1 / Midnight ZK) that shows all operations with timestamps, transaction hashes, and Cardanoscan links. Open the "Activity Log" section at the bottom of the page.

## Complete scripted demo

Run all 6 steps via the shell:

```bash
bash scripts/demo-backend-flow.sh
```
