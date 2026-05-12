# Licensing & Plutus V3

## Overview

Dataset licensing uses a Plutus V3 smart contract on Cardano. The flow is:

1. **Creator locks** a listing UTxO at a script address with an inline datum
2. **Buyer spends** the listing UTxO, paying the creator the asking price
3. The Plutus validator enforces the payment amount and recipient

## Aiken validator: nuauth_license_listing

**Source:** `cardano/aiken/validators/nuauth_license_listing.ak`
**Compiled output:** `cardano/aiken/plutus.json`

### Datum (inline)

The listing UTxO carries an inline datum with three fields:

| Field | Type | Description |
|-------|------|-------------|
| `seller_vkh` | ByteArray (28 bytes) | Payment key hash of the creator/seller |
| `dataset_id` | ByteArray | Dataset UUID encoded as UTF-8 hex |
| `price_lovelace` | Int | Asking price in lovelace |

### Redeemer

```
Purchase    — empty constructor (tag 0)
```

### Validation logic

The `Purchase` redeemer triggers validation that:

1. The transaction includes an output paying at least `price_lovelace` to an address containing `seller_vkh`
2. The seller's payment key hash matches the datum

### Script address

Derived from the compiled validator hash on the target network. Example (Preprod):

```
addr_test1wpds7mz39fvs9ae3u9raktpw8txk77pxlhy70uph49h9stqshqrmf
```

## Backend integration

### Datum encoding (`backend/cardano/license_listing.ts`)

```typescript
listingDatumHex(sellerVkh, datasetId, priceLovelace)
```

Produces a CBOR-encoded Plutus datum:

```
Constructor 0 [
  ByteArray(sellerVkh),        // 28-byte payment key hash
  ByteArray(hex(datasetId)),   // UUID as hex bytes
  Integer(priceLovelace)       // price in lovelace
]
```

### Redeemer encoding

```typescript
purchaseRedeemerHex()
```

Produces `Constructor 0 []` — the empty Purchase redeemer.

### Listing flow (`backend/licensing/plutus_listing_tx.ts`)

#### submitLicenseListingLock

1. Initialize Lucid with creator mnemonic
2. Build tx: `pay.ToContract(scriptAddr, { kind: "inline", value: datumHex }, { lovelace: lockLovelace })`
3. Sign and submit
4. Look up the script UTxO to confirm and record `outputIndex`

#### submitPlutusLicensePurchase

1. Initialize Lucid with buyer mnemonic
2. Look up the listing UTxO by `(lockTxHash, outputIndex)`
3. Verify the inline datum matches expected values
4. Build tx:
   - `attach.SpendingValidator(script)`
   - `collectFrom([listingUtxo], redeemerHex)`
   - `pay.ToAddress(sellerAddress, { lovelace: price })`
   - `attachMetadata(674, { msg })` — CIP-20 license receipt
5. Coin selection uses ADA-only UTxOs for collateral (`presetWalletInputs`)
6. Sign and submit

## CIP-20 metadata

Both stamp and license transactions include CIP-20 metadata (label 674) with JSON-encoded details:

**Stamp metadata:**
```json
{
  "t": "nuauth-stamp-v1",
  "datasetId": "uuid",
  "commitment": "sha256hex",
  "filename": "data.txt"
}
```

**License metadata:**
```json
{
  "t": "nuauth-license-plutus",
  "listingLockTxHash": "...",
  "listingOutputIndex": 0,
  "datasetId": "uuid",
  "buyerAddress": "addr_test1q...",
  "filename": "data.txt",
  "commitment": "sha256hex"
}
```

Messages exceeding 64 bytes are chunked per CIP-20 spec (`backend/lib/cip20.ts`).

## Building the validator

### Prerequisites

- [Aiken](https://aiken-lang.org) v1.x installed

### Build

```bash
cd cardano/aiken
aiken build
```

Output: `plutus.json` containing the compiled validator and its hash.

### Testing

Emulator smoke test (no Blockfrost needed):

```bash
deno task cardano:license-smoke:emulator
```

This creates a listing, purchases it, and verifies the flow end-to-end in the in-process emulator.

## Registry tracking

After a listing is created, the registry stores:

```json
{
  "licenseListing": {
    "lockTxHash": "...",
    "outputIndex": 0,
    "priceLovelace": "2000000",
    "lockLovelace": "5000000",
    "scriptAddress": "addr_test1w...",
    "listedAt": "ISO timestamp"
  }
}
```

After purchase, `licenseListing` is deleted from the dataset, and a `LicenseRecord` is added to the registry's `licenses[]` array:

```json
{
  "datasetId": "uuid",
  "buyerAddress": "addr_test1q...",
  "txHash": "...",
  "lovelace": "2000000",
  "createdAt": "ISO timestamp",
  "kind": "plutus_v3_listing",
  "listingLockTxHash": "...",
  "listingOutputIndex": 0
}
```
