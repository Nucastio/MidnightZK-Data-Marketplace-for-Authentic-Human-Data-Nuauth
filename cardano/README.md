# Cardano (NuAuth)

- **Off-chain (this repo, active):** `../backend/cardano/` — Lucid + Blockfrost **or** Lucid **Emulator** (`CARDANO_BACKEND=emulator`).
- **On-chain (Aiken, scaffold):** `./aiken/` — Plutus v3 validators; see [aiken/README.md](aiken/README.md).

The marketplace **v1 backend** does not yet lock funds at `validators/nuauth_placeholder.ak`; stamping and licensing use **transaction metadata** on Preprod or the local emulator.
