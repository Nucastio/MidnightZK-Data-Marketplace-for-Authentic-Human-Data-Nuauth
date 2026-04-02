# MidnightZK Data Marketplace — Authentic Human Data (NuAuth)

Privacy-first human intelligence data marketplace (Cardano + Midnight ZK) per the in-repository SRS PDF.

## Backend prototypes (implemented)

This repository includes **backend-only** prototypes aligned with milestone scope:

| Module | Description |
|--------|-------------|
| **IP repository** | Local encrypted blobs under `data/blobs/` |
| **ZK stamping** | SHA-256 commitment + Cardano **CIP-20** (`674`) + **Midnight** `nuauth-stamp` circuits (`proveCreatorStamp`, `bindL1Stamp`); API **attestation** makes a dataset **ZK-complete** |
| **Licensing** | Plutus **`nuauth_license_listing`**: list UTxO, buyer purchase, registry + decrypt gate |
| **ABE access control** | Prototype **policy-bound** AES-GCM (see [docs/TDD.md](docs/TDD.md)); **decrypt** requires a recorded license for the buyer address |

Details: **[backend/README.md](backend/README.md)** · Design: **[docs/TDD.md](docs/TDD.md)**

## Quick start

```bash
cp .env.example .env
# Edit: BLOCKFROST_PROJECT_ID, WALLET_MNEMONIC, ABE_MASTER_KEY_HEX (openssl rand -hex 32)

deno task deps:patch   # once after npm deps are fetched (libsodium layout); serve/smoke tasks also run it
deno task serve
# other terminal:
./scripts/demo-backend-flow.sh
```

**Local emulator (no Blockfrost):** set `CARDANO_BACKEND=emulator` in `.env`, then `deno task serve:emulator` (see [backend/README.md](backend/README.md)).

**Aiken / Plutus V3:** [cardano/aiken/README.md](cardano/aiken/README.md) — `nuauth_license_listing` + `deno task cardano:license-smoke:emulator`. REST uses **`POST /api/creator/list-license`** + **`POST /api/developer/license`** for on-chain purchases.

**Midnight Preprod:** set `MIDNIGHT_DEPLOY_NETWORK=preprod` when running `npm run midnight:run-all` (see [docs/TDD.md](docs/TDD.md), [Midnight install](https://docs.midnight.network/getting-started/installation)).

**Midnight ZK (Compact + undeployed):** [contract/README.md](contract/README.md), [midnight-local-cli/README.md](midnight-local-cli/README.md), [docs/TDD.md](docs/TDD.md).

**Sandbox test:** `./scripts/test-sandbox.sh` (Cardano emulator smoke). **Full ZK path:** Compact build + [midnight-local-network](https://github.com/bricktowers/midnight-local-network) + `POST /api/creator/midnight/attest` (see [docs/TDD.md](docs/TDD.md)).

## Technical design

- **[docs/TDD.md](docs/TDD.md)** — unified TDD (architecture, flows, interfaces, integrations)

## Security

- Never commit `.env`.  
- Use dedicated **Preprod** wallets; rotate any key or mnemonic that was exposed.

## License

See [LICENSE](LICENSE).
