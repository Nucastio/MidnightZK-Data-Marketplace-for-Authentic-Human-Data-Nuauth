#!/usr/bin/env bash
# @nuauth/midnight-contract is linked as file:../contract. A separate `npm install` under
# contract/ nests @midnight-ntwrk/* with its own onchain-runtime-v3 WASM bindings; that
# second copy breaks instanceof checks in compact-js deploy (ContractMaintenanceAuthority).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "${ROOT}/contract/node_modules/@midnight-ntwrk" 2>/dev/null || true
