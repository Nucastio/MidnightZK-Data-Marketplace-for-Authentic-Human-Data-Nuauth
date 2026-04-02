# Backend — NuAuth marketplace prototypes

Deno + **Lucid Evolution** (`@lucid-evolution/lucid`, **Plutus V3** capable) + Blockfrost **Preprod** (or in-process emulator) + local **encrypted IP repository** + **registry** JSON.

## What is implemented

- **IP repository** — AES-GCM ciphertext on disk (`data/blobs/`).
- **ZK stamping logic** — SHA-256 **content commitment** + Cardano **CIP-20** metadata (`674`) + **Midnight** `proveCreatorStamp` / `bindL1Stamp` (Compact + `midnight-local-cli`); **`POST /api/creator/midnight/attest`** records ZK completion. With **`NUAUTH_REQUIRE_MIDNIGHT_STRICT`** (default on), **license** and **decrypt** require attestation.
- **Plutus licensing (V3)** — creator **`POST /api/creator/list-license`** locks a **`nuauth_license_listing`** UTxO (inline datum: seller vkey hash, dataset id, price). Buyer **`POST /api/developer/license`** spends that UTxO with the **Purchase** redeemer and pays the seller; registry stores **`kind: "plutus_v3_listing"`**. CIP-20 metadata on the purchase tx is for indexing only.
- **ABE-based access control (prototype)** — policy-bound DEK wrapping (see [docs/BACKEND_ARCHITECTURE.md](../docs/BACKEND_ARCHITECTURE.md)); **`POST /api/developer/decrypt`** requires a **Plutus** license row (metadata-only / legacy rows do not unlock decrypt).

## Prerequisites

- [Deno](https://deno.land/) **2.x** recommended (npm dependencies + lockfile v5)
- After first `deno install` / `deno run` that pulls `@lucid-evolution/lucid`, run **`deno task deps:patch`** once (fixes `libsodium-wrappers-sumo` layout under `node_modules/.deno/`). `serve` / `serve:emulator` / emulator smoke tasks run this automatically.
- Either **Blockfrost Preprod** credentials **or** **emulator mode** (no network)
- In Blockfrost mode: Preprod ADA in **creator** and **buyer** wallets (can be the same mnemonic for a smoke test)
- In emulator mode: genesis-funded wallets (see `EMULATOR_SEED_LOVELACE`); **no** `BLOCKFROST_PROJECT_ID` required

## Emulator mode (fast local testing)

Set in `.env`:

```bash
CARDANO_BACKEND=emulator
```

Optionally tune `EMULATOR_SEED_LOVELACE` (default `50000000000` lovelace ≈ 50k ADA per unique seed) and `EMULATOR_ACCOUNT_INDEX`.

Run API:

```bash
deno task serve:emulator
```

Smoke test:

```bash
deno task cardano:smoke:emulator
```

The Lucid Evolution **`Emulator`** keeps a **singleton** chain in memory. After each stamp/license submit, the backend calls **`awaitBlock(1)`** so the next transaction sees change outputs.

## Aiken validators (on-chain)

Validators live in **[`../cardano/aiken/`](../cardano/aiken/README.md)**. Build **`plutus.json`** before listing/licensing:

```bash
cd cardano/aiken && aiken build
```

The API loads **`nuauth_license_listing`** from `cardano/aiken/plutus.json` (path resolved relative to the repo root).

## ZK stamping + Midnight (required for marketplace gate)

- **Binding metadata:** [`zk/stamp_bundle.ts`](zk/stamp_bundle.ts) — `bindingDigest` and `l1AnchorDigestHex` (pass as `NUAUTH_L1_ANCHOR_HEX` in `midnight-local-cli`).
- **Compact + undeployed CLI:** [`../contract/`](../contract/README.md), [`../midnight-local-cli/`](../midnight-local-cli/README.md), [`../docs/ZK_AND_MIDNIGHT.md`](../docs/ZK_AND_MIDNIGHT.md).
- **Attestation:** after Midnight txs, call **`POST /api/creator/midnight/attest`** (or use env vars in `scripts/demo-backend-flow.sh`). Policy: [`lib/zk_policy.ts`](lib/zk_policy.ts).

## Configure

From repo root:

```bash
cp .env.example .env
# Set BLOCKFROST_PROJECT_ID, WALLET_MNEMONIC, ABE_MASTER_KEY_HEX (openssl rand -hex 32)
```

Wallet envs:

- **`WALLET_MNEMONIC`** — default for every role if overrides are omitted.
- **`CREATOR_WALLET_MNEMONIC`** / **`SELLER_WALLET_MNEMONIC`** — seller (register, stamp, receives license payment); creator falls back to seller if set.
- **`BUYER_WALLET_MNEMONIC`** — buyer (license tx, decrypt).

Blockfrost:

- **`BLOCKFROST_PROJECT_ID`** — required (this is the Blockfrost “project id” / API key string).
- **`BLOCKFROST_API_KEY`** — optional alias for the same value if your docs call it an API key.

For a **single shared Preprod wallet**, set `WALLET_MNEMONIC` and optionally duplicate it into creator/seller/buyer vars (see `.env.example`).

## Run API

```bash
deno task serve
```

Default: `http://127.0.0.1:8788` (`API_PORT`).

## Cardano connectivity smoke test

```bash
deno task cardano:smoke
```

## Scripted demo (Creator + AI Developer)

Terminal 1: `deno task serve`  
Terminal 2:

```bash
chmod +x scripts/demo-backend-flow.sh
./scripts/demo-backend-flow.sh
```

## Full E2E — Cardano Preprod + Midnight local (pretty CLI)

Requires [midnight-local-network](https://github.com/bricktowers/midnight-local-network) (indexer on `:8088`), `.env` with Blockfrost + wallets + `BIP39_MNEMONIC`, and `midnight-local-cli` deps (`npm install --no-workspaces` there). The script **forces** `MIDNIGHT_DEPLOY_NETWORK=undeployed`, starts the API, runs register → stamp → `npm run midnight:run-all` → attest → list-license → license → decrypt, then prints a **colorized summary** and writes JSON (default `/tmp/nuauth-e2e-local-midnight-summary.json`).

```bash
deno task e2e:cardano-preprod-midnight-local
# optional: NUAUTH_E2E_CLEAR=1 to clear the terminal first; NUAUTH_E2E_OUT=./my-run.json
```

## HTTP reference

| Method | Path | Role |
|--------|------|------|
| `GET` | `/health` | Liveness |
| `GET` | `/api/datasets` | List datasets (no wrapped keys) |
| `GET` | `/api/datasets/:id` | Dataset detail |
| `POST` | `/api/creator/register` | Body: `{ filename?, contentBase64 }` |
| `POST` | `/api/creator/stamp` | Body: `{ datasetId }` |
| `POST` | `/api/creator/midnight/attest` | Body: `{ datasetId, contractAddress, proveCreatorStampTxHash, bindL1StampTxHash }` — required for list-license/license/decrypt when strict ZK policy is on |
| `POST` | `/api/creator/list-license` | Body: `{ datasetId, priceLovelace?, lockLovelace? }` — creator locks Plutus listing UTxO (**409** if already listed) |
| `POST` | `/api/developer/license` | Body: `{ datasetId, lovelace }` — must match listing price; spends listing validator (**400** if no listing) |
| `POST` | `/api/developer/decrypt` | Body: `{ datasetId }` — buyer must have **`plutus_v3_listing`** license; **403** if not ZK-complete (strict) |

## Layout

| Path | Purpose |
|------|---------|
| `api/main.ts` | HTTP server |
| `cardano/lucid_client.ts` | Lucid + Blockfrost |
| `ip-repository/blob_store.ts` | Blob IO |
| `stamping/` | Commitment + stamp tx |
| `licensing/` | Plutus listing + purchase txs; legacy CIP-20 helper in `license_tx.ts` |
| `cardano/license_listing.ts` | Load validator, datum/redeemer encoding |
| `abe/crypto.ts` | Encrypt / decrypt |
| `lib/state.ts` | `data/registry.json` |
