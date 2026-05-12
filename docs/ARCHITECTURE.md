# Architecture

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / CLI                            │
│                     (UI or curl/scripts)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (JSON)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NuAuth Backend (Deno + Hono)                 │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Stamping  │  │ ABE /    │  │ Licensing│  │ ZK Policy     │  │
│  │ Module    │  │ Crypto   │  │ Module   │  │ Enforcement   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────────────┘  │
│       │              │             │                             │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌───────────────┐  │
│  │ Cardano  │  │ IP Repo  │  │ Plutus   │  │ Midnight CLI  │  │
│  │ (Lucid)  │  │ (Blobs)  │  │ (Aiken)  │  │ Runner        │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
└───────┼──────────────┼─────────────┼────────────────┼──────────┘
        │              │             │                │
        ▼              ▼             ▼                ▼
   ┌─────────┐   ┌──────────┐  ┌─────────┐    ┌──────────────┐
   │ Cardano │   │  Local   │  │ Cardano │    │   Midnight   │
   │ Preprod │   │  Files   │  │ Preprod │    │   Network    │
   │(Blockfr)│   │data/blobs│  │(Plutus) │    │(node+indexer │
   └─────────┘   └──────────┘  └─────────┘    │+proof-server)│
                                               └──────────────┘
```

## Components

### Backend modules (`backend/`)

| Module | Directory | Responsibility |
|--------|-----------|---------------|
| **API** | `api/` | REST server (Hono), OpenAPI/Swagger docs, route handlers |
| **Stamping** | `stamping/` | SHA-256 commitment computation, CIP-20 metadata tx submission |
| **ABE / Crypto** | `abe/` | AES-GCM encryption/decryption, policy-bound DEK wrapping |
| **Licensing** | `licensing/` | Plutus V3 listing lock + purchase transactions |
| **ZK** | `zk/` | ZK binding digest computation, L1 anchor derivation |
| **Cardano** | `cardano/` | Lucid Evolution client, Blockfrost/emulator provider, Aiken validator loading |
| **IP Repository** | `ip-repository/` | Encrypted blob read/write to `data/blobs/` |
| **Lib** | `lib/` | Config, state management, environment, hex utils, CIP-20, ZK policy |

### Smart contracts

| Contract | Language | Location | Purpose |
|----------|----------|----------|---------|
| `nuauth_license_listing` | Aiken (Plutus V3) | `cardano/aiken/` | On-chain listing/purchase validator |
| `nuauth-stamp` | Compact (Midnight) | `contract/src/` | ZK creator authentication + L1 binding |

### Midnight CLI (`midnight-local-cli/`)

Node.js/TypeScript tooling for deploying and executing Midnight contracts. Handles wallet initialization, funding (on local networks), contract deployment, and circuit execution.

### Frontend (`ui/`)

Vanilla HTML/CSS/JS. No build step. Communicates with the backend via `fetch()`. Implements a 6-step guided pipeline with status tracking and activity logging.

## Data flow

### Registration + encryption

```
Plaintext → SHA-256 → commitment (stored in registry)
         → AES-GCM(random DEK) → ciphertext (stored in data/blobs/)
         → DEK wrapped with policy-bound key → wrappedDek (stored in registry)
```

### Cardano stamping

```
commitment + metadata → CIP-20 tx (label 674) → Cardano Preprod
                     → txHash stored in registry
                     → l1AnchorDigestHex = SHA-256(stamp metadata) for Midnight binding
```

### Midnight ZK attestation

```
Deploy nuauth-stamp(commitment, creatorPk)
  → proveCreatorStamp(): prove knowledge of creatorSecret
  → bindL1Stamp(l1Anchor): bind to Cardano stamp
  → contractAddress + txHashes stored in registry
  → dataset marked zkComplete = true
```

### Licensing (Plutus V3)

```
Creator: lock UTxO at script address with datum(sellerVkh, datasetId, price)
Buyer:   spend UTxO + pay seller → validator checks payment amount & recipient
```

### Decryption gate

```
Request → check Plutus license exists for buyer wallet
       → check zkComplete (Midnight attestation present + valid)
       → unwrap DEK with policy-bound key
       → AES-GCM decrypt ciphertext
       → return plaintext
```

## State management

All state is stored in `data/registry.json` — a flat JSON file with two arrays:

- `datasets[]` — all registered datasets with metadata, stamps, attestations, listings
- `licenses[]` — all purchased licenses with buyer address, tx hash, price

This is a prototype storage layer. Production would use a database.

## Trust boundaries

| Zone | What lives here | Trust level |
|------|----------------|-------------|
| **Public ledger (Cardano)** | Stamp metadata, listing UTxOs, license payments | Public, immutable |
| **Private ledger (Midnight)** | Creator proof, L1 binding | ZK-verified, private |
| **Backend API** | Wallet keys, encryption keys, plaintext access | Trusted server |
| **Client browser** | UI state, API calls | Untrusted |
| **Encrypted storage** | Ciphertext blobs | Confidential at rest |

## Technology stack

| Layer | Technology |
|-------|-----------|
| Runtime | Deno 2.x |
| HTTP framework | Hono 4.x |
| Cardano SDK | Lucid Evolution 0.4.29 |
| Cardano provider | Blockfrost API / in-process emulator |
| Plutus validators | Aiken (Plutus V3, Conway era) |
| ZK language | Midnight Compact |
| ZK SDK | @midnight-ntwrk/* v4.x |
| Encryption | Web Crypto API (AES-256-GCM) |
| Wallet derivation | BIP-39 mnemonics |
| Frontend | Vanilla HTML/CSS/JS |
| Package management | npm workspaces + Deno imports |
