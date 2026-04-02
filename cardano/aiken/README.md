# Cardano on-chain (Aiken)

## `nuauth_license_listing` (Plutus v3)

Spend validator: **`validators/nuauth_license_listing.ak`**

- **Datum** `LicenseListingDatum`: `seller_vkh` (payment key hash, 28-byte credential), `dataset_id` (bytes, for off-chain indexing), `price` (lovelace, must be &gt; 0).
- **Redeemer** `Purchase`: unit variant.
- **Rule:** the transaction must send **at least** `price` lovelace in outputs whose **payment** credential is `seller_vkh`.

Unit tests: `aiken check` (includes on-chain predicate tests).

Build blueprint: `aiken build` → `plutus.json`.

## Smoke tests (not wired to REST API yet)

| Environment | Command |
|-------------|---------|
| **Deno emulator, full Plutus V3 (lock + spend)** | Repo root: `deno task cardano:license-smoke:emulator` (runs `deps:patch` + needs `aiken build`) |
| **Deno Preprod** | `CARDANO_BACKEND=blockfrost` + `.env` Blockfrost + funded wallets, then `deno run --allow-net --allow-env --allow-read backend/cardano/license_listing_smoke.ts` |
| **Node (optional duplicate)** | `cd scripts/license-smoke-node && npm install && npm run smoke:emulator` |

Optional env: `LICENSE_LISTING_PRICE_LOVELACE`, `LICENSE_LISTING_LOCK_LOVELACE`, `LICENSE_LISTING_DATASET_ID`.

Integration with `backend/licensing/license_tx.ts` and the marketplace API is a **separate** step.
