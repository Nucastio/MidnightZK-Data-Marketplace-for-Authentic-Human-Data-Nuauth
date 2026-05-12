# API Reference

Base URL: `http://127.0.0.1:8788` (configurable via `API_PORT`)

Interactive Swagger UI: `GET /docs`
OpenAPI 3.0 spec: `GET /api/openapi.json`

All endpoints accept and return JSON. Errors return `{ "error": "message" }` with appropriate HTTP status codes.

---

## System

### GET /health

Returns service status, Cardano backend type, network, ZK policy, and feature flags.

**Response 200:**

```json
{
  "ok": true,
  "service": "nuauth-marketplace-backend",
  "cardanoBackend": "blockfrost",
  "network": "Preprod",
  "zkPolicy": {
    "midnightRequiredForMarketplace": true
  },
  "features": {
    "serverMidnightCli": true
  }
}
```

---

## Datasets

### GET /api/datasets

List all registered datasets with public metadata. Sensitive fields (DEK, blob path) are excluded.

**Response 200:**

```json
{
  "datasets": [
    {
      "id": "uuid",
      "filename": "data.txt",
      "creatorAddress": "addr_test1q...",
      "commitment": "sha256hex",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "stampTxHash": "64-char hex or null",
      "zkComplete": true,
      "midnightAttestation": {
        "contractAddress": "...",
        "proveCreatorStampTxHash": "...",
        "bindL1StampTxHash": "...",
        "attestedAt": "..."
      },
      "listingForSale": {
        "priceLovelace": "2000000",
        "scriptAddress": "addr_test1w..."
      }
    }
  ]
}
```

### GET /api/datasets/:id

Single dataset by UUID.

**Response 200:** `{ "dataset": { ... } }`
**Response 404:** `{ "error": "Dataset not found" }`

---

## Creator

### POST /api/creator/register

Register a new dataset. Encrypts content with AES-GCM, computes SHA-256 commitment, stores ciphertext blob.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contentBase64` | string | Yes | UTF-8 content encoded as base64 |
| `filename` | string | No | Display name (default: `dataset.bin`) |

```json
{
  "filename": "my-data.txt",
  "contentBase64": "SGVsbG8gV29ybGQ="
}
```

**Response 200:**

```json
{
  "datasetId": "uuid",
  "commitment": "sha256hex",
  "creatorAddress": "addr_test1q...",
  "filename": "my-data.txt",
  "policy": { "datasetId": "uuid", "kind": "nuauth-v1" }
}
```

**Response 400:** Missing or invalid `contentBase64`.

---

### POST /api/creator/stamp

Submit a CIP-20 metadata transaction on Cardano anchoring the content commitment.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `datasetId` | string (UUID) | Yes |

**Response 200:**

```json
{
  "txHash": "64-char hex",
  "datasetId": "uuid",
  "commitment": "sha256hex",
  "cardanoStampComplete": true,
  "zkComplete": false,
  "midnight": {
    "required": true,
    "l1AnchorDigestHex": "64-char hex",
    "circuits": ["proveCreatorStamp", "bindL1Stamp"],
    "nextStep": "Run contract + midnight-local-cli..."
  }
}
```

**Response 404:** Dataset not found.
**Response 409:** Already stamped.

---

### POST /api/creator/midnight/attest

Record Midnight ZK attestation after running circuits externally.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `datasetId` | string (UUID) | Yes |
| `contractAddress` | string | Yes |
| `proveCreatorStampTxHash` | string | Yes |
| `bindL1StampTxHash` | string | Yes |

**Response 200:**

```json
{
  "datasetId": "uuid",
  "zkComplete": true,
  "midnightAttestation": {
    "contractAddress": "...",
    "proveCreatorStampTxHash": "...",
    "bindL1StampTxHash": "...",
    "attestedAt": "ISO timestamp"
  }
}
```

**Response 400:** Missing fields or Cardano stamp not yet completed.
**Response 409:** Already attested.

---

### POST /api/creator/midnight/run-all-and-attest

Run the full Midnight ZK pipeline on the server (deploy contract, execute circuits, record attestation). Requires `NUAUTH_SERVER_MIDNIGHT_CLI=1`. Takes 3-5 minutes.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `datasetId` | string (UUID) | Yes |

**Response 200:**

```json
{
  "datasetId": "uuid",
  "zkComplete": true,
  "midnightAttestation": { "..." },
  "midnightDeployTxHash": "...",
  "midnightCliLogTail": "last 4000 chars of CLI output"
}
```

**Response 403:** Server-side CLI disabled.
**Response 502:** Midnight CLI execution failed.

---

### POST /api/creator/list-license

Lock a Plutus V3 listing UTxO on Cardano with an inline datum.

**Request body:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `datasetId` | string (UUID) | Yes | |
| `priceLovelace` | string | No | `2000000` |
| `lockLovelace` | string | No | `5000000` |

**Response 200:**

```json
{
  "datasetId": "uuid",
  "licenseListing": {
    "lockTxHash": "64-char hex",
    "outputIndex": 0,
    "priceLovelace": "2000000",
    "lockLovelace": "5000000",
    "scriptAddress": "addr_test1w...",
    "listedAt": "ISO timestamp"
  }
}
```

**Response 403:** ZK attestation required but not complete.
**Response 409:** Already has an active listing.

---

## Developer

### POST /api/developer/license

Purchase a license by spending the Plutus listing UTxO. The payment amount must exactly match the listing price.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `datasetId` | string (UUID) | Yes |
| `lovelace` | string | Yes (must match listing `priceLovelace`) |

**Response 200:**

```json
{
  "txHash": "64-char hex",
  "datasetId": "uuid",
  "buyerAddress": "addr_test1q...",
  "lovelace": "2000000",
  "kind": "plutus_v3_listing"
}
```

**Response 400:** No active listing or price mismatch.
**Response 403:** ZK attestation required but not complete.

---

### POST /api/developer/decrypt

Recover the original plaintext. Requires both an active Plutus license and completed ZK attestation.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `datasetId` | string (UUID) | Yes |

**Response 200:**

```json
{
  "datasetId": "uuid",
  "filename": "my-data.txt",
  "plaintextBase64": "base64-encoded original content"
}
```

**Response 403:** No license or ZK attestation incomplete.
**Response 404:** Dataset not found.

---

## Error format

All errors follow this structure:

```json
{
  "error": "Human-readable error message",
  "field": "optional additional context"
}
```

Common HTTP status codes:
- `400` — Bad request (missing/invalid fields)
- `403` — Forbidden (policy gate: no license or no ZK attestation)
- `404` — Not found
- `409` — Conflict (already stamped, already attested, already listed)
- `502` — Upstream failure (Cardano tx submission or Midnight CLI error)
