# ABE & Encryption

## Overview

NuAuth encrypts all dataset content at rest using AES-256-GCM with policy-bound key derivation. The scheme is designed as a prototype stand-in for full Ciphertext-Policy Attribute-Based Encryption (CP-ABE), using the Web Crypto API for portability.

## Encryption scheme

### Key hierarchy

```
ABE_MASTER_KEY_HEX (32 bytes, from .env)
        │
        ▼
  HKDF(masterKey, salt=policy)  →  policyKey (32 bytes)
        │
        ▼
  AES-GCM-WRAP(policyKey, DEK)  →  wrappedDek (stored in registry)

Random DEK (32 bytes, per dataset)
        │
        ▼
  AES-256-GCM(DEK, plaintext)  →  ciphertext (stored in data/blobs/)
```

### Encryption flow (`encryptDataset`)

1. Generate a random 32-byte Data Encryption Key (DEK)
2. Generate a random 12-byte IV
3. Encrypt plaintext with AES-256-GCM using the DEK → ciphertext
4. Derive a policy-bound key from the master key using HKDF with the dataset policy as salt
5. Wrap (encrypt) the DEK with the policy-bound key using AES-GCM
6. Store: ciphertext blob to `data/blobs/{id}.bin`, wrapped DEK to registry

### Decryption flow (`decryptDataset`)

1. Derive the same policy-bound key from master key + policy
2. Unwrap the DEK using the policy-bound key
3. Decrypt the ciphertext blob with the DEK
4. Return plaintext

### Policy structure

```typescript
type PolicyV1 = {
  datasetId: string;    // UUID
  kind: "nuauth-v1";   // Policy version tag
};
```

The policy is serialized to JSON and used as the HKDF salt, making each dataset's key derivation unique.

## Access control gates

Decryption is gated by two independent checks (enforced in `POST /api/developer/decrypt`):

| Gate | Mechanism | Check |
|------|-----------|-------|
| **Plutus license** | Cardano on-chain | `hasActivePlutusLicense(registry, datasetId, buyerAddress)` |
| **ZK attestation** | Midnight off-chain record | `isMidnightZkComplete(dataset)` |

Both must pass before the backend will decrypt and return plaintext. Either gate can be bypassed for testing:

- **Skip ZK gate:** Set `NUAUTH_REQUIRE_MIDNIGHT_STRICT=false` in `.env`
- **Skip license gate:** Not configurable (always enforced)

## Stored artifacts

### Registry (`data/registry.json`)

Each dataset record contains:

```json
{
  "wrappedDek": {
    "iv": "hex-encoded 12-byte IV",
    "combined": "hex-encoded AES-GCM ciphertext + auth tag"
  }
}
```

The `wrappedDek` is **not** included in public API responses (`GET /api/datasets`).

### Blob storage (`data/blobs/`)

Encrypted files are stored as `{datasetId}.bin` — raw AES-GCM ciphertext (IV prepended).

## Security considerations

### Prototype limitations

- **Single master key:** All datasets derive keys from the same `ABE_MASTER_KEY_HEX`. Compromise of this key compromises all data. Production should use per-authority keys or a proper CP-ABE scheme.
- **Server-side decryption:** The backend holds the master key and performs decryption. A production system should support client-side decryption with delegated keys.
- **No key rotation:** There is no mechanism to re-encrypt data under new keys. Adding rotation would require re-wrapping all DEKs.
- **Policy is soft:** The policy binding (HKDF salt) prevents cross-dataset key reuse but does not enforce attribute-based access rules. A full CP-ABE library (e.g., OpenABE) would support conditions like "role=researcher AND institution=approved".

### What is secure

- **AES-256-GCM:** Industry-standard authenticated encryption. Ciphertext cannot be tampered with undetected.
- **Random DEKs:** Each dataset gets a unique random key. Compromising one dataset doesn't help with others (assuming unique IVs, which are random per encryption).
- **Policy-bound derivation:** HKDF with unique salt means derived keys are independent per dataset.
- **Plaintext never stored:** Only ciphertext is written to disk. Plaintext exists only in memory during encrypt/decrypt operations.

## Implementation details

**Source:** `backend/abe/crypto.ts`

Key functions:

| Function | Description |
|----------|-------------|
| `encryptDataset(plaintext, policy)` | Encrypt + wrap DEK → returns `{ ciphertextFileBytes, wrappedDek }` |
| `decryptDataset(fileBytes, wrappedDek, policy)` | Unwrap DEK + decrypt → returns plaintext bytes |

Both functions use the Web Crypto API (`crypto.subtle`) available in Deno and browsers. No native dependencies.

## Replacing with CP-ABE

To upgrade to full attribute-based encryption:

1. Replace `encryptDataset` / `decryptDataset` with a CP-ABE library (e.g., OpenABE, FAME)
2. Replace the HKDF-derived policy key with CP-ABE key generation using attribute sets
3. Store CP-ABE ciphertext (which embeds the access policy) instead of AES-GCM ciphertext
4. Issue attribute keys to authorized users based on their on-chain license status and ZK attestation
5. Decryption becomes client-side: users decrypt with their attribute key without the server seeing plaintext

The current architecture (commitment → stamp → ZK attest → license → decrypt) would remain the same; only the encryption layer changes.
