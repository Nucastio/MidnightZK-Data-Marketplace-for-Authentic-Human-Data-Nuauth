# NuAuth Midnight Compact contract (`nuauth-stamp`)

Privacy-preserving **dataset stamping** on Midnight: creator-secret ZK proofs and an optional **L1 anchor** binding (Cardano metadata / tx id digest).

## Build

1. Install [Compact](https://github.com/midnightntwrk/compact) CLI.
2. From this directory:

```bash
npm install
npm run compact
npm run build
```

Outputs land in `src/managed/nuauth-stamp/` (ZK artifacts, generated TS/JS).

## Circuits

| Circuit | Role |
|---------|------|
| `proveCreatorStamp` | Proves knowledge of `creatorSecret` matching ledger `creatorPk`. |
| `bindL1Stamp` | Same proof gate + stores `l1Anchor` (use digest derived from Cardano stamp tx — see `backend/zk/stamp_bundle.ts`). |

## Package

Published only as a workspace package `@nuauth/midnight-contract` for `midnight-local-cli`.
