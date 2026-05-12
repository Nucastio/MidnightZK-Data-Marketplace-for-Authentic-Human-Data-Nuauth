# Setup Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Deno](https://deno.land) | 2.x | Backend runtime |
| [Node.js](https://nodejs.org) | 18+ | Midnight CLI, contract build |
| [npm](https://npmjs.com) | 9+ | Workspace package management |
| [Docker](https://docker.com) | 24+ | Midnight local network (node, indexer, proof servers) |
| [Aiken](https://aiken-lang.org) | 1.x | Plutus V3 validator compilation (optional — pre-compiled included) |

## 1. Clone and install

```bash
git clone <repo-url>
cd MidnightZK-Data-Marketplace-for-Authentic-Human-Data-Nuauth

# Install npm workspace dependencies (contract + midnight-local-cli)
npm install

# Patch libsodium for Deno compatibility
bash scripts/patch-libsodium-deno.sh
```

## 2. Environment configuration

Copy the example and fill in values:

```bash
cp .env.example .env
```

### Required variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CARDANO_BACKEND` | `blockfrost` or `emulator` | `blockfrost` |
| `BLOCKFROST_URL` | Blockfrost API endpoint | `https://cardano-preprod.blockfrost.io/api/v0` |
| `BLOCKFROST_PROJECT_ID` | Blockfrost API key | `preprodXXXXXXXX` |
| `CARDANO_NETWORK` | `Preprod`, `Preview`, or `Mainnet` | `Preprod` |
| `WALLET_MNEMONIC` | BIP-39 mnemonic (shared default for all roles) | 15-word phrase |
| `ABE_MASTER_KEY_HEX` | 32-byte hex key for ABE encryption | 64 hex characters |
| `BIP39_MNEMONIC` | Midnight wallet mnemonic | 24-word phrase |
| `MIDNIGHT_DEPLOY_NETWORK` | `undeployed`, `preview`, or `preprod` | `undeployed` |

### Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CREATOR_WALLET_MNEMONIC` | `WALLET_MNEMONIC` | Override creator wallet |
| `SELLER_WALLET_MNEMONIC` | `WALLET_MNEMONIC` | Override seller wallet |
| `BUYER_WALLET_MNEMONIC` | `WALLET_MNEMONIC` | Override buyer wallet |
| `API_PORT` | `8788` | Backend listen port |
| `STAMP_MIN_LOVELACE` | `2000000` | Minimum ADA for stamp tx |
| `DEFAULT_LICENSE_LOVELACE` | `2000000` | Default license price |
| `NUAUTH_DATA_DIR` | `data` | Data directory path |
| `NUAUTH_SERVER_MIDNIGHT_CLI` | `0` | Enable server-side ZK pipeline (`1` = on) |
| `NUAUTH_REQUIRE_MIDNIGHT_STRICT` | `true` | Require ZK attestation for marketplace |
| `NUAUTH_CREATOR_SK_HEX` | Random | Creator secret key for ZK circuits |

## 3. Cardano setup

### Option A: Blockfrost (Preprod testnet)

1. Get a free API key at [blockfrost.io](https://blockfrost.io)
2. Set `CARDANO_BACKEND=blockfrost` in `.env`
3. Fund your wallet with test ADA from the [Cardano faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)

### Option B: Emulator (no external dependencies)

```bash
# No Blockfrost key needed
CARDANO_BACKEND=emulator deno task serve
```

The emulator runs an in-process Cardano chain with pre-funded wallets.

## 4. Midnight local network (Docker)

Required for ZK attestation when `MIDNIGHT_DEPLOY_NETWORK=undeployed`.

### Start the network

```bash
cd /path/to/midnight-local-network
docker compose up -d node indexer
```

Wait for containers to become healthy:

```bash
docker inspect node --format '{{.State.Health.Status}}'
docker inspect indexer --format '{{.State.Health.Status}}'
```

### Proof servers

The ZK proof servers must be running for contract deployment and circuit execution:

```bash
# These run alongside the node/indexer
# Default ports: 6300 (proof-server), 6301 (zk-stables)
docker ps | grep proof
```

### Network ports

| Service | Port | Protocol |
|---------|------|----------|
| Midnight node | 9944 | WebSocket (RPC) |
| Indexer | 8088 | HTTP (GraphQL) |
| Proof server | 6300 | HTTP |
| Proof server (zk-stables) | 6301 | HTTP |

## 5. Start the backend

```bash
deno task serve
```

This runs `scripts/patch-libsodium-deno.sh` then starts the Hono server on `http://127.0.0.1:8788`.

Verify:

```bash
curl http://127.0.0.1:8788/health
```

## 6. Start the frontend

```bash
cd ui
python3 -m http.server 5175
# or: npx serve -l 5175
```

Open `http://127.0.0.1:5175` in a browser.

## 7. Build the Aiken validator (optional)

Pre-compiled output is included at `cardano/aiken/plutus.json`. To rebuild:

```bash
cd cardano/aiken
aiken build
```

## 8. Build the Midnight contract (optional)

Pre-compiled artifacts are in `contract/src/managed/`. To rebuild:

```bash
npm run contract:compact
npm run contract:build
```

## 9. Verify the setup

### Quick smoke test (emulator)

```bash
npm run test:sandbox
```

### Full E2E (Preprod + Midnight local)

```bash
npm run e2e:cardano-preprod-midnight-local
```

### Backend demo script

```bash
bash scripts/demo-backend-flow.sh
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `libsodium` import error | Run `bash scripts/patch-libsodium-deno.sh` |
| Port 8788 in use | `fuser -k 8788/tcp` or change `API_PORT` |
| Midnight node not healthy | Wait ~30s after `docker compose up`; check `docker logs node` |
| Proof server crash (S3 download) | Use pre-cached proof server containers or retry |
| Wallet has no tADA | Fund from [Cardano faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| Genesis wallet spent (local Midnight) | `docker compose down -v && docker compose up -d` for fresh chain |
| DUST not available | Fund Midnight wallet with tNIGHT; DUST is auto-registered |
