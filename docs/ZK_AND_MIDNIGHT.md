# ZK & Midnight

## Overview

NuAuth uses the Midnight network for zero-knowledge proofs that authenticate data creators without revealing their identity. The ZK layer ensures that:

1. The creator knows a secret key corresponding to the on-ledger public key
2. The Midnight proof is cryptographically bound to a specific Cardano L1 stamp transaction

This creates a cross-chain verification: Cardano provides the public timestamp and payment layer, Midnight provides private creator authentication.

## Compact contract: nuauth-stamp

**Source:** `contract/src/nuauth-stamp.compact`

### Ledger state (public, on Midnight)

```
contentCommitment : Bytes<32>   — SHA-256 of the dataset plaintext
creatorPk         : Bytes<32>   — public key derived from creator's secret
l1Anchor          : Bytes<32>   — binding digest linking to Cardano stamp tx
```

### Constructor

```
constructor(commitment: Bytes<32>, ownerPk: Bytes<32>)
```

Initializes the ledger with the content commitment and creator public key. `l1Anchor` starts as zeros and is set by `bindL1Stamp`.

### Circuits

#### proveCreatorStamp

```
export circuit proveCreatorStamp(): Void
```

- Reads `creatorSecret` from the private witness
- Derives the public key from the secret
- Asserts it matches `creatorPk` on the ledger
- Proves the caller knows the creator's secret without revealing it

#### bindL1Stamp

```
export circuit bindL1Stamp(anchor: Bytes<32>): Void
```

- Same creator authentication as `proveCreatorStamp`
- Additionally writes the `anchor` value to the ledger's `l1Anchor` field
- The anchor is the SHA-256 digest of the Cardano stamp transaction metadata, binding the Midnight proof to a specific Cardano L1 event

### Private witness

```typescript
// contract/src/witnesses-nuauth-stamp.ts
creatorSecret(): Maybe<Bytes<32>>
```

The witness provider supplies the creator's 32-byte secret key from private state. This key never leaves the prover — only the derived public key appears on the ledger.

## ZK binding protocol

The binding between Cardano and Midnight uses a digest chain:

```
Step 1: Register dataset → commitment = SHA-256(plaintext)
Step 2: Stamp on Cardano → stampTxHash (CIP-20 metadata tx)
        → l1AnchorDigestHex = SHA-256(bindingDigest || stampTxHash || ...)
Step 3: Deploy nuauth-stamp(commitment, creatorPk)
        → proveCreatorStamp() — authenticates creator
        → bindL1Stamp(l1Anchor) — writes Cardano binding to Midnight ledger
```

The `l1AnchorDigestHex` is computed by `backend/zk/stamp_bundle.ts`:

```
bindingDigest = SHA-256(datasetId + commitment + filename + cardanoBackend)
l1AnchorDigestHex = SHA-256(bindingDigest + stampTxHash)
```

This ensures the Midnight proof references a specific dataset registration and Cardano stamp — the ZK attestation cannot be reused across datasets.

## Deployment modes

### Undeployed (local Docker)

```
MIDNIGHT_DEPLOY_NETWORK=undeployed
```

Runs against a local Midnight network in Docker containers. Uses a genesis wallet for funding. Best for development and testing.

**Required services:**
- `node` (port 9944) — Midnight substrate node
- `indexer` (port 8088) — GraphQL indexer
- `proof-server` (port 6300) — ZK prover

**Fresh start:** `docker compose down -v && docker compose up -d node indexer`

### Preview network

```
MIDNIGHT_DEPLOY_NETWORK=preview
```

Connects to Midnight's Preview testnet. Requires tNIGHT tokens (request from Midnight faucet or community).

### Preprod network

```
MIDNIGHT_DEPLOY_NETWORK=preprod
```

Connects to Midnight's Preprod testnet. Fund your wallet at the Midnight faucet.

## CLI usage

### Deploy + run all circuits

```bash
cd midnight-local-cli

export BIP39_MNEMONIC="your 24-word mnemonic"
export NUAUTH_CONTENT_COMMITMENT_HEX="<64-char hex from registration>"
export NUAUTH_L1_ANCHOR_HEX="<64-char hex from stamp>"
export MIDNIGHT_DEPLOY_NETWORK="undeployed"

npm run fund-and-run    # local: fund from genesis + deploy + prove + bind
# or
npm run run-all         # preprod/preview: deploy + prove + bind (wallet must be pre-funded)
```

### Deploy only

```bash
npm run deploy
```

### Print wallet address (for funding)

```bash
npm run print-midnight-address
```

### Fund local wallet (standalone)

```bash
npm run fund-local-undeployed
```

## CLI modules

| Module | Purpose |
|--------|---------|
| `config.ts` | Network endpoints (node RPC, indexer, proof server URLs) |
| `wallet.ts` | BIP-39 seed → Midnight WalletFacade + balance helpers |
| `creator-key.ts` | Creator secret key derivation + public key computation |
| `providers.ts` | Network provider initialization (indexer, node, proof server) |
| `fund-and-run-nuauth.ts` | Combined: genesis funding + deploy + prove + bind |
| `run-nuauth-all.ts` | Deploy + proveCreatorStamp + bindL1Stamp |
| `deploy-nuauth.ts` | Contract deployment only |
| `dust.ts` | DUST token operations |

## Server-side execution

When `NUAUTH_SERVER_MIDNIGHT_CLI=1`, the backend can run the full ZK pipeline via `POST /api/creator/midnight/run-all-and-attest`. This:

1. Spawns `npm run fund-and-run` (undeployed) or `npm run run-all` (preprod/preview)
2. Passes `NUAUTH_CONTENT_COMMITMENT_HEX` and `NUAUTH_L1_ANCHOR_HEX` as environment variables
3. Parses the CLI output for contract address and tx hashes
4. Records the attestation in the dataset registry

This is intended for controlled/demo environments. In production, creators would run circuits locally or via a trusted prover service.

## ZK policy enforcement

Controlled by `backend/lib/zk_policy.ts`:

- **`requireMidnightAttestation()`** — returns `true` by default; set `NUAUTH_REQUIRE_MIDNIGHT_STRICT=false` to disable
- **`isMidnightZkComplete(ds)`** — checks that `midnightAttestation` exists with valid contract address and tx hashes

When enabled, the ZK gate blocks:
- `POST /api/creator/list-license` (cannot list without ZK)
- `POST /api/developer/license` (cannot buy without ZK)
- `POST /api/developer/decrypt` (cannot decrypt without ZK)
