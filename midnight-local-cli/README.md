# NuAuth Midnight CLI (`nuauth-stamp`)

Deploys and exercises the **`nuauth-stamp`** Compact contract on either:

| Target | `MIDNIGHT_DEPLOY_NETWORK` | Stack |
|--------|---------------------------|--------|
| **Local (Brick Towers)** | `undeployed` (default) | [midnight-local-network](https://github.com/bricktowers/midnight-local-network) — indexer `8088`, node `9944`, proof server `6300` |
| **Midnight Preview** | `preview` | Public Preview RPC / indexer / proof server ([release overview](https://docs.midnight.network/relnotes/overview)) — use if Preprod `wss://rpc…` returns **1006** repeatedly |
| **Midnight Preprod** | `preprod` | Public Preprod RPC / indexer / proof server |

Same flow as [ZK-Stables local-cli](https://github.com/Nucastio/ZK-Stables-USDC-USDT-Non-Custodial-Bridge); this package adds **Preprod** wiring aligned with [Deploy to Preprod](https://docs.midnight.network/guides/deploy-mn-app).

**Prerequisites:** [Install the Midnight toolchain](https://docs.midnight.network/getting-started/installation) (Compact, Docker for local proof server when not using the hosted one).

## Prerequisites

1. **Contract artifacts:** from repo root  
   `cd contract && npm run compact && npm run build`  
   (requires [Compact CLI](https://github.com/midnightntwrk/compact)).
2. **Network choice**
   - **Undeployed:** Docker stack running; fund `BIP39_MNEMONIC` on local Midnight. Prefer `npm run fund-local-undeployed -w @nuauth/midnight-local-cli` (same wallet stack as `run-all`) or Brick Towers `yarn fund` / `yarn fund-and-register-dust` with indexer **v4** URLs if their stock script never syncs.
   - **Preprod:** Fund the wallet with **tNIGHT** from [Preprod faucet](https://faucet.preprod.midnight.network/); complete **DUST** registration per official tutorials before deploying (fees on Midnight Preprod).
3. **Node.js ≥ 20** and `npm install` at repo root (workspaces + `patches/`).

## Install

```bash
npm install
```

`postinstall` applies `patches/` for wallet-sdk + `Map` iterator compatibility.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run deploy -w @nuauth/midnight-local-cli` | Deploy `nuauth-stamp` only |
| `npm run run-all -w @nuauth/midnight-local-cli` | Deploy + `proveCreatorStamp` + `bindL1Stamp` (ZK) |
| `npm run fund-local-undeployed -w @nuauth/midnight-local-cli` | Genesis → fund shielded + unshielded + register **DUST** on **undeployed** (uses patched wallet SDKs; needs a working local genesis wallet) |

## Environment

| Variable | Description |
|----------|-------------|
| **`MIDNIGHT_DEPLOY_NETWORK`** | `undeployed` (default) or `preprod`. |
| `BIP39_MNEMONIC` | Required. Wallet phrase (**must be funded** on the selected Midnight network). |
| `NUAUTH_CREATOR_SK_HEX` | 64 hex chars; 32-byte creator secret for ZK witness (default `03…`). |
| `NUAUTH_CONTENT_COMMITMENT_HEX` | 64 hex; constructor `contentCommitment` (default `00…`). |
| `NUAUTH_L1_ANCHOR_HEX` | 64 hex; `bindL1Stamp` anchor (default `aa…` for `run-all`). |
| **`MIDNIGHT_PROOF_SERVER`** | Override proof-server URL. Preprod default: `https://lace-proof-pub.preprod.midnight.network`. Undeployed default: `http://127.0.0.1:6300`. |
| `MIDNIGHT_INDEXER_HTTP` / `MIDNIGHT_INDEXER_WS` / `MIDNIGHT_NODE_RPC` | Optional overrides for Preprod endpoints (defaults match official docs). |
| `INDEXER_PORT` / `NODE_PORT` / `PROOF_SERVER_PORT` | Undeployed localhost ports only. |
| `MIDNIGHT_LDB_PASSWORD` | Optional LevelDB password (≥16 chars). |
| `MIDNIGHT_NUAUTH_ARTIFACTS_DIR` | Override path to `contract/src/managed/nuauth-stamp`. |

## ZK circuits

- **`proveCreatorStamp`** — proves knowledge of `creatorSecret` matching on-ledger `creatorPk`.
- **`bindL1Stamp`** — same gate + writes `l1Anchor` (bind Midnight state to an L1 digest, e.g. derived from **Cardano** stamp metadata).

Pair with **Cardano** emulator or **Cardano Preprod** (`CARDANO_BACKEND=blockfrost`) in `backend/` for end-to-end demos. **Cardano Preprod** and **Midnight Preprod** use different assets (ADA vs tNIGHT/DUST).

## After `run-all`: attest to the NuAuth API

So licensing/decrypt succeed under the default **`NUAUTH_REQUIRE_MIDNIGHT_STRICT`** policy, record the deploy address and the two Midnight transaction identifiers from the CLI output, then:

```bash
curl -sS -X POST "http://127.0.0.1:8788/api/creator/midnight/attest" \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"<id>","contractAddress":"<deploy>","proveCreatorStampTxHash":"<hex>","bindL1StampTxHash":"<hex>"}'
```

Or set `NUAUTH_MIDNIGHT_CONTRACT`, `NUAUTH_MIDNIGHT_PROVE_TX`, `NUAUTH_MIDNIGHT_BIND_TX` in `.env` and run `./scripts/demo-backend-flow.sh` after stamping (the script posts attest when strict mode is on).

## Troubleshooting

- **`expected instance of ContractMaintenanceAuthority` on deploy** — Two copies of `@midnight-ntwrk/onchain-runtime-v3` (or `compact-runtime`) are loaded (e.g. `contract/node_modules/@midnight-ntwrk` **and** `midnight-local-cli/node_modules/@midnight-ntwrk`). `postinstall` runs `scripts/prune-contract-midnight-nested.sh` to remove the nested tree under `contract/`. Prefer `npm install` from the **repo root** so the contract package resolves Midnight deps from the workspace `node_modules`. If you use Deno/npm mixed installs and still see this, point `node_modules/@midnight-ntwrk/{onchain-runtime-v3,compact-runtime,compact-js}` at the same physical packages as `midnight-local-cli/node_modules`.
- **`Insufficient Funds: could not balance dust`** — The Midnight wallet needs **DUST** on the chosen network (register unshielded UTXOs for dust generation on undeployed, or follow Preprod faucet + DUST docs).
