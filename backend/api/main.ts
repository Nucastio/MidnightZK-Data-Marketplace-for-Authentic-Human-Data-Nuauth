import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
await load({ export: true });

import { Hono } from "npm:hono@4";
import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { cors } from "npm:hono@4/cors";

import { encryptDataset, decryptDataset } from "../abe/crypto.ts";
import { readBlob, writeBlob } from "../ip-repository/blob_store.ts";
import { contentCommitment } from "../stamping/commitment.ts";
import { submitStampTransaction } from "../stamping/stamp_tx.ts";
import { buildStampZkBundle } from "../zk/stamp_bundle.ts";
import {
  submitLicenseListingLock,
  submitPlutusLicensePurchase,
} from "../licensing/plutus_listing_tx.ts";
import { lucidFromMnemonic } from "../cardano/lucid_client.ts";
import {
  addLicense,
  findDataset,
  hasActivePlutusLicense,
  loadRegistry,
  saveRegistry,
  upsertDataset,
  type DatasetRecord,
} from "../lib/state.ts";
import {
  assertMidnightAttestationPayload,
  isMidnightZkComplete,
  requireMidnightAttestation,
} from "../lib/zk_policy.ts";
import {
  buyerMnemonic,
  cardanoBackend,
  creatorMnemonic,
  optionalEnv,
} from "../lib/config.ts";
import {
  runMidnightRunAll,
  serverMidnightCliEnabled,
} from "./midnight_cli_runner.ts";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

/* ── OpenAPI spec + Swagger UI ─────────────────────────────────── */
const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "NuAuth — Human Data Marketplace API",
    version: "0.1.0",
    description:
      "Privacy-first data marketplace on Cardano + Midnight ZK. Register authentic human data, anchor it with zero-knowledge proofs, and trade licenses on-chain.\n\n## Pipeline\n1. **Register** — encrypt content, generate SHA-256 commitment\n2. **Stamp** — anchor commitment to Cardano L1 (CIP-20 metadata tx)\n3. **ZK Attest** — prove creator authenticity via Midnight Compact circuits\n4. **List** — lock a Plutus V3 listing UTxO with asking price\n5. **License** — buyer spends the listing UTxO, pays creator on-chain\n6. **Decrypt** — recover plaintext (requires active license + ZK attestation)",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "System", description: "Health and status" },
    { name: "Datasets", description: "Browse registered datasets" },
    { name: "Creator", description: "Register, stamp, attest, and list datasets" },
    { name: "Developer", description: "Purchase licenses and decrypt data" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        description: "Returns service status, Cardano backend type, network, ZK policy, and feature flags.",
        responses: {
          "200": {
            description: "Service healthy",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Health" } } },
          },
        },
      },
    },
    "/api/datasets": {
      get: {
        tags: ["Datasets"],
        summary: "List all datasets",
        description: "Returns every registered dataset with public metadata (commitment, creator, ZK status, listing info). Sensitive fields (DEK, ciphertext path) are excluded.",
        responses: {
          "200": {
            description: "Dataset list",
            content: { "application/json": { schema: { type: "object", properties: { datasets: { type: "array", items: { "$ref": "#/components/schemas/DatasetPublic" } } } } } },
          },
        },
      },
    },
    "/api/datasets/{id}": {
      get: {
        tags: ["Datasets"],
        summary: "Get single dataset",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Dataset UUID" }],
        responses: {
          "200": { description: "Dataset found", content: { "application/json": { schema: { type: "object", properties: { dataset: { "$ref": "#/components/schemas/DatasetPublic" } } } } } },
          "404": { description: "Dataset not found" },
        },
      },
    },
    "/api/creator/register": {
      post: {
        tags: ["Creator"],
        summary: "Register a new dataset",
        description: "Upload content as base64. The backend encrypts it with ABE (AES-GCM), computes a SHA-256 commitment, and stores the ciphertext. Returns the dataset ID and commitment for subsequent steps.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["contentBase64"],
                properties: {
                  filename: { type: "string", default: "dataset.txt", description: "Display name for the dataset" },
                  contentBase64: { type: "string", description: "UTF-8 content encoded as base64" },
                },
              },
              example: { filename: "my-data.txt", contentBase64: "SGVsbG8gV29ybGQ=" },
            },
          },
        },
        responses: {
          "200": {
            description: "Dataset registered",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    datasetId: { type: "string", format: "uuid" },
                    commitment: { type: "string", description: "SHA-256 hex digest of plaintext" },
                    creatorAddress: { type: "string", description: "Cardano Bech32 address" },
                    filename: { type: "string" },
                    policy: { type: "object" },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid contentBase64" },
        },
      },
    },
    "/api/creator/stamp": {
      post: {
        tags: ["Creator"],
        summary: "Stamp dataset on Cardano",
        description: "Submits a CIP-20 metadata transaction on Cardano anchoring the content commitment. Returns the tx hash and the l1AnchorDigestHex needed for the Midnight ZK step.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["datasetId"], properties: { datasetId: { type: "string", format: "uuid" } } },
              example: { datasetId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
            },
          },
        },
        responses: {
          "200": {
            description: "Stamp transaction submitted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    txHash: { type: "string", description: "Cardano transaction hash (64 hex chars)" },
                    datasetId: { type: "string" },
                    commitment: { type: "string" },
                    cardanoStampComplete: { type: "boolean" },
                    zkComplete: { type: "boolean" },
                    midnight: {
                      type: "object",
                      properties: {
                        l1AnchorDigestHex: { type: "string", description: "32-byte hex digest binding L1 stamp to Midnight circuit" },
                        circuits: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "404": { description: "Dataset not found" },
          "409": { description: "Already stamped" },
        },
      },
    },
    "/api/creator/midnight/attest": {
      post: {
        tags: ["Creator"],
        summary: "Submit Midnight ZK attestation (manual)",
        description: "After running the Midnight Compact circuits externally (proveCreatorStamp + bindL1Stamp), submit the contract address and tx hashes to complete the ZK attestation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["datasetId", "contractAddress", "proveCreatorStampTxHash", "bindL1StampTxHash"],
                properties: {
                  datasetId: { type: "string", format: "uuid" },
                  contractAddress: { type: "string", description: "Midnight contract address" },
                  proveCreatorStampTxHash: { type: "string", description: "Midnight tx hash from proveCreatorStamp circuit" },
                  bindL1StampTxHash: { type: "string", description: "Midnight tx hash from bindL1Stamp circuit" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Attestation recorded", content: { "application/json": { schema: { type: "object", properties: { datasetId: { type: "string" }, zkComplete: { type: "boolean" }, midnightAttestation: { type: "object" } } } } } },
          "400": { description: "Missing fields or Cardano stamp not yet completed" },
          "409": { description: "Already attested" },
        },
      },
    },
    "/api/creator/midnight/run-all-and-attest": {
      post: {
        tags: ["Creator"],
        summary: "Run Midnight ZK pipeline + attest (server-side)",
        description: "Runs the full Midnight Compact pipeline on the server: deploy contract, proveCreatorStamp, bindL1Stamp. Requires NUAUTH_SERVER_MIDNIGHT_CLI=1. Takes 3-5 minutes.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["datasetId"], properties: { datasetId: { type: "string", format: "uuid" } } },
            },
          },
        },
        responses: {
          "200": { description: "ZK pipeline completed and attestation saved" },
          "400": { description: "Cardano stamp not yet completed" },
          "403": { description: "Server-side Midnight CLI is disabled" },
          "409": { description: "Already attested" },
          "502": { description: "Midnight CLI execution failed" },
        },
      },
    },
    "/api/creator/list-license": {
      post: {
        tags: ["Creator"],
        summary: "List dataset for sale",
        description: "Locks a Plutus V3 listing UTxO on Cardano with an inline datum containing the seller, dataset ID, and price. Requires ZK attestation if midnight policy is enabled.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["datasetId"],
                properties: {
                  datasetId: { type: "string", format: "uuid" },
                  priceLovelace: { type: "string", default: "2000000", description: "Asking price in lovelace (1 ADA = 1,000,000 lovelace)" },
                  lockLovelace: { type: "string", default: "5000000", description: "ADA locked in the script UTxO" },
                },
              },
              example: { datasetId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", priceLovelace: "2000000" },
            },
          },
        },
        responses: {
          "200": {
            description: "Listing created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    datasetId: { type: "string" },
                    licenseListing: {
                      type: "object",
                      properties: {
                        lockTxHash: { type: "string" },
                        outputIndex: { type: "integer" },
                        priceLovelace: { type: "string" },
                        scriptAddress: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "ZK attestation required but not complete" },
          "409": { description: "Already has an active listing" },
        },
      },
    },
    "/api/developer/license": {
      post: {
        tags: ["Developer"],
        summary: "Purchase a license",
        description: "Spends the Plutus listing UTxO and pays the creator the asking price. The lovelace amount must exactly match the listing price. Requires ZK attestation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["datasetId", "lovelace"],
                properties: {
                  datasetId: { type: "string", format: "uuid" },
                  lovelace: { type: "string", description: "Must match listing priceLovelace exactly" },
                },
              },
              example: { datasetId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", lovelace: "2000000" },
            },
          },
        },
        responses: {
          "200": {
            description: "License purchased",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    txHash: { type: "string", description: "Cardano purchase transaction hash" },
                    datasetId: { type: "string" },
                    buyerAddress: { type: "string" },
                    lovelace: { type: "string" },
                    kind: { type: "string", enum: ["plutus_v3_listing"] },
                  },
                },
              },
            },
          },
          "400": { description: "No active listing or price mismatch" },
          "403": { description: "ZK attestation required but not complete" },
        },
      },
    },
    "/api/developer/decrypt": {
      post: {
        tags: ["Developer"],
        summary: "Decrypt dataset content",
        description: "Returns the original plaintext (base64-encoded) if the caller has an active Plutus license and the dataset has completed ZK attestation. This is the ABE access gate.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["datasetId"], properties: { datasetId: { type: "string", format: "uuid" } } },
            },
          },
        },
        responses: {
          "200": {
            description: "Decrypted content",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    datasetId: { type: "string" },
                    filename: { type: "string" },
                    plaintextBase64: { type: "string", description: "Original content, base64-encoded" },
                  },
                },
              },
            },
          },
          "403": { description: "No license or ZK attestation incomplete" },
          "404": { description: "Dataset not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      Health: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          service: { type: "string" },
          cardanoBackend: { type: "string", enum: ["blockfrost", "emulator"] },
          network: { type: "string" },
          zkPolicy: { type: "object", properties: { midnightRequiredForMarketplace: { type: "boolean" } } },
          features: { type: "object", properties: { serverMidnightCli: { type: "boolean" } } },
        },
      },
      DatasetPublic: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          filename: { type: "string" },
          creatorAddress: { type: "string", description: "Cardano Bech32 address" },
          commitment: { type: "string", description: "SHA-256 hex digest" },
          createdAt: { type: "string", format: "date-time" },
          stampTxHash: { type: "string", description: "Cardano stamp tx (null if not stamped)" },
          zkComplete: { type: "boolean", description: "True if Midnight ZK attestation is complete" },
          midnightAttestation: {
            type: "object",
            nullable: true,
            properties: {
              contractAddress: { type: "string" },
              proveCreatorStampTxHash: { type: "string" },
              bindL1StampTxHash: { type: "string" },
              attestedAt: { type: "string", format: "date-time" },
            },
          },
          listingForSale: {
            type: "object",
            nullable: true,
            properties: {
              priceLovelace: { type: "string" },
              scriptAddress: { type: "string" },
            },
          },
        },
      },
    },
  },
};

app.get("/api/openapi.json", (c) => c.json(openApiSpec));

app.get("/docs", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NuAuth API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0d0d12; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info hgroup.main a { color: #8213e5; }
    .swagger-ui { max-width: 1100px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
    });
  </script>
</body>
</html>`);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "nuauth-marketplace-backend",
    cardanoBackend: cardanoBackend(),
    network: cardanoBackend() === "emulator"
      ? "Custom (Lucid Evolution emulator)"
      : (optionalEnv("CARDANO_NETWORK") || "Preprod"),
    zkPolicy: {
      midnightRequiredForMarketplace:
        requireMidnightAttestation(),
      note:
        "ZK verification is defined as Midnight circuits + Cardano anchor; see docs/TDD/",
    },
    features: {
      /** `POST /api/creator/midnight/run-all-and-attest` when `NUAUTH_SERVER_MIDNIGHT_CLI=1` */
      serverMidnightCli: serverMidnightCliEnabled(),
    },
  }));

function publicDataset(ds: DatasetRecord) {
  const { wrappedDek: _, licenseListing, ...rest } = ds;
  return {
    ...rest,
    zkComplete: isMidnightZkComplete(ds),
    listingForSale: licenseListing
      ? {
        priceLovelace: licenseListing.priceLovelace,
        scriptAddress: licenseListing.scriptAddress,
      }
      : undefined,
  };
}

app.get("/api/datasets", async (c) => {
  const reg = await loadRegistry();
  return c.json({
    datasets: reg.datasets.map((d) => publicDataset(d)),
  });
});

app.get("/api/datasets/:id", async (c) => {
  const reg = await loadRegistry();
  const ds = findDataset(reg, c.req.param("id"));
  if (!ds) return c.json({ error: "Dataset not found" }, 404);
  return c.json({ dataset: publicDataset(ds) });
});

app.post("/api/creator/register", async (c) => {
  let body: { filename?: string; contentBase64?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.contentBase64?.length) {
    return c.json({ error: "contentBase64 is required" }, 400);
  }
  const filename = body.filename?.trim() || "dataset.bin";
  let plaintext: Uint8Array;
  try {
    plaintext = decodeBase64(body.contentBase64);
  } catch {
    return c.json({ error: "Invalid base64" }, 400);
  }

  const commitment = await contentCommitment(plaintext);
  const id = crypto.randomUUID();
  const policy = { datasetId: id, kind: "nuauth-v1" as const };
  const { ciphertextFileBytes, wrappedDek } = await encryptDataset(
    plaintext,
    policy,
  );

  const lucid = await lucidFromMnemonic(creatorMnemonic());
  const creatorAddress = await lucid.wallet().address();

  const blobRelativePath = `blobs/${id}.bin`;
  await writeBlob(blobRelativePath, ciphertextFileBytes);

  const reg = await loadRegistry();
  const initialZk = await buildStampZkBundle({
    datasetId: id,
    commitment,
    filename,
  });
  const ds: DatasetRecord = {
    id,
    filename,
    creatorAddress,
    commitment,
    policy,
    wrappedDek,
    blobRelativePath,
    createdAt: new Date().toISOString(),
    stampMetadata: {
      zk: initialZk,
    },
  };
  upsertDataset(reg, ds);
  await saveRegistry(reg);

  return c.json({
    datasetId: id,
    commitment,
    creatorAddress,
    filename,
    policy,
  });
});

app.post("/api/creator/stamp", async (c) => {
  let body: { datasetId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);
  if (ds.stampTxHash) {
    return c.json({
      error: "Already stamped",
      txHash: ds.stampTxHash,
    }, 409);
  }

  const zkBefore = await buildStampZkBundle({
    datasetId: ds.id,
    commitment: ds.commitment,
    filename: ds.filename,
  });
  const { txHash } = await submitStampTransaction(creatorMnemonic(), {
    datasetId: ds.id,
    commitment: ds.commitment,
    filename: ds.filename,
    zk: zkBefore,
  });

  const zkAfter = await buildStampZkBundle({
    datasetId: ds.id,
    commitment: ds.commitment,
    filename: ds.filename,
    cardanoStampTxHash: txHash,
  });

  ds.stampTxHash = txHash;
  if (!ds.stampMetadata) ds.stampMetadata = {};
  ds.stampMetadata.zk = zkAfter;
  upsertDataset(reg, ds);
  await saveRegistry(reg);

  return c.json({
    txHash,
    datasetId: ds.id,
    commitment: ds.commitment,
    cardanoStampComplete: true,
    zkComplete: isMidnightZkComplete(ds),
    midnight: {
      required: true,
      l1AnchorDigestHex: zkAfter.l1AnchorDigestHex,
      circuits: zkAfter.midnightCircuits,
      nextStep:
        "Run contract + midnight-local-cli (proveCreatorStamp, bindL1Stamp) using commitment + l1AnchorDigestHex, then POST /api/creator/midnight/attest",
      docs: "docs/ZK_AND_MIDNIGHT.md",
    },
  });
});

app.post("/api/creator/midnight/attest", async (c) => {
  let body: {
    datasetId?: string;
    contractAddress?: string;
    proveCreatorStampTxHash?: string;
    bindL1StampTxHash?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);

  const err = assertMidnightAttestationPayload({
    contractAddress: body.contractAddress,
    proveCreatorStampTxHash: body.proveCreatorStampTxHash,
    bindL1StampTxHash: body.bindL1StampTxHash,
  });
  if (err) return c.json({ error: err }, 400);

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);
  if (!ds.stampTxHash) {
    return c.json({
      error: "Cardano stamp must be completed before Midnight attestation",
    }, 400);
  }
  if (ds.midnightAttestation) {
    return c.json({
      error: "Midnight already attested",
      attestation: ds.midnightAttestation,
    }, 409);
  }

  ds.midnightAttestation = {
    contractAddress: body.contractAddress!.trim(),
    proveCreatorStampTxHash: body.proveCreatorStampTxHash!.trim(),
    bindL1StampTxHash: body.bindL1StampTxHash!.trim(),
    attestedAt: new Date().toISOString(),
  };
  if (!ds.stampMetadata) ds.stampMetadata = {};
  (ds.stampMetadata as Record<string, unknown>).midnightAttestation =
    ds.midnightAttestation;
  upsertDataset(reg, ds);
  await saveRegistry(reg);

  return c.json({
    datasetId: ds.id,
    zkComplete: true,
    midnightAttestation: ds.midnightAttestation,
  });
});

/**
 * Dev / controlled environments: runs `midnight-local-cli` `npm run run-all` on the server,
 * then persists the same attestation as `POST /api/creator/midnight/attest`.
 * Requires `NUAUTH_SERVER_MIDNIGHT_CLI=1` and Deno `--allow-run` (see `deno task serve`).
 */
app.post("/api/creator/midnight/run-all-and-attest", async (c) => {
  if (!serverMidnightCliEnabled()) {
    return c.json({
      error:
        "Disabled. Set NUAUTH_SERVER_MIDNIGHT_CLI=1 in .env to allow server-side Midnight CLI (trusted environments only).",
    }, 403);
  }

  let body: { datasetId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);
  if (!ds.stampTxHash) {
    return c.json({
      error: "Cardano stamp must be completed before Midnight attestation",
    }, 400);
  }
  if (ds.midnightAttestation) {
    return c.json({
      error: "Midnight already attested",
      attestation: ds.midnightAttestation,
    }, 409);
  }

  const zk = ds.stampMetadata?.zk as Record<string, unknown> | undefined;
  const l1 = typeof zk?.l1AnchorDigestHex === "string"
    ? zk.l1AnchorDigestHex.trim()
    : "";
  if (l1.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(l1)) {
    return c.json({
      error:
        "Stamp metadata missing l1AnchorDigestHex (complete Cardano stamp first)",
    }, 400);
  }

  let parsed;
  let log = "";
  try {
    const out = await runMidnightRunAll({
      repoRoot: Deno.cwd(),
      commitmentHex: ds.commitment,
      l1AnchorHex: l1,
      creatorSkHex: optionalEnv("NUAUTH_CREATOR_SK_HEX"),
    });
    parsed = out.parsed;
    log = out.log;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 502);
  }

  const err = assertMidnightAttestationPayload({
    contractAddress: parsed.contractAddress,
    proveCreatorStampTxHash: parsed.proveCreatorStampTxHash,
    bindL1StampTxHash: parsed.bindL1StampTxHash,
  });
  if (err) return c.json({ error: err }, 500);

  ds.midnightAttestation = {
    contractAddress: parsed.contractAddress.trim(),
    proveCreatorStampTxHash: parsed.proveCreatorStampTxHash.trim(),
    bindL1StampTxHash: parsed.bindL1StampTxHash.trim(),
    attestedAt: new Date().toISOString(),
  };
  if (!ds.stampMetadata) ds.stampMetadata = {};
  (ds.stampMetadata as Record<string, unknown>).midnightAttestation =
    ds.midnightAttestation;
  upsertDataset(reg, ds);
  await saveRegistry(reg);

  return c.json({
    datasetId: ds.id,
    zkComplete: true,
    midnightAttestation: ds.midnightAttestation,
    midnightDeployTxHash: parsed.deployTxHash,
    midnightCliLogTail: log.slice(-4000),
  });
});

app.post("/api/creator/list-license", async (c) => {
  let body: {
    datasetId?: string;
    priceLovelace?: string | number;
    lockLovelace?: string | number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);

  const priceRaw =
    body.priceLovelace ?? optionalEnv("DEFAULT_LICENSE_LOVELACE") ?? "2000000";
  const priceLovelace = BigInt(String(priceRaw));
  if (priceLovelace <= 0n) {
    return c.json({ error: "priceLovelace must be positive" }, 400);
  }

  const lockRaw =
    body.lockLovelace ?? optionalEnv("LICENSE_LISTING_LOCK_LOVELACE") ?? "5000000";
  const lockLovelace = BigInt(String(lockRaw));
  if (lockLovelace <= 0n) {
    return c.json({ error: "lockLovelace must be positive" }, 400);
  }

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);
  if (ds.licenseListing) {
    return c.json({
      error: "Dataset already has an active license listing",
      listing: ds.licenseListing,
    }, 409);
  }

  if (requireMidnightAttestation() && !isMidnightZkComplete(ds)) {
    return c.json({
      error:
        "Dataset is not ZK-verified (Midnight). Complete Cardano stamp + POST /api/creator/midnight/attest first.",
      zkComplete: false,
    }, 403);
  }

  try {
    const listing = await submitLicenseListingLock(
      creatorMnemonic(),
      ds.creatorAddress,
      ds.id,
      priceLovelace,
      lockLovelace,
    );
    ds.licenseListing = {
      lockTxHash: listing.lockTxHash,
      outputIndex: listing.outputIndex,
      priceLovelace: listing.priceLovelace.toString(),
      lockLovelace: listing.lockLovelace.toString(),
      scriptAddress: listing.scriptAddress,
      listedAt: new Date().toISOString(),
    };
    upsertDataset(reg, ds);
    await saveRegistry(reg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 502);
  }

  return c.json({
    datasetId: ds.id,
    licenseListing: ds.licenseListing,
  });
});

app.post("/api/developer/license", async (c) => {
  let body: { datasetId?: string; lovelace?: string | number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);
  const lovelaceRaw =
    body.lovelace ?? optionalEnv("DEFAULT_LICENSE_LOVELACE") ?? "2000000";
  const lovelace = BigInt(String(lovelaceRaw));
  if (lovelace <= 0n) {
    return c.json({ error: "lovelace must be positive" }, 400);
  }

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);

  if (requireMidnightAttestation() && !isMidnightZkComplete(ds)) {
    return c.json({
      error:
        "Dataset is not ZK-verified (Midnight). Complete Cardano stamp + POST /api/creator/midnight/attest first.",
      zkComplete: false,
    }, 403);
  }

  const listing = ds.licenseListing;
  if (!listing) {
    return c.json({
      error:
        "No Plutus license listing for this dataset. Creator must POST /api/creator/list-license first.",
    }, 400);
  }

  const expectedPrice = BigInt(listing.priceLovelace);
  if (lovelace !== expectedPrice) {
    return c.json({
      error:
        "lovelace must match the on-chain listing price (see listing.priceLovelace or GET /api/datasets/:id).",
      priceLovelace: listing.priceLovelace,
    }, 400);
  }

  const buyer = await lucidFromMnemonic(buyerMnemonic());
  const buyerAddress = await buyer.wallet().address();

  let txHash: string;
  try {
    const out = await submitPlutusLicensePurchase(
      buyerMnemonic(),
      ds.creatorAddress,
      listing,
      ds.id,
      {
        datasetId: ds.id,
        buyerAddress,
        filename: ds.filename,
        commitment: ds.commitment,
      },
    );
    txHash = out.txHash;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 502);
  }

  delete ds.licenseListing;
  upsertDataset(reg, ds);

  addLicense(reg, {
    datasetId: ds.id,
    buyerAddress,
    txHash,
    lovelace: lovelace.toString(),
    createdAt: new Date().toISOString(),
    kind: "plutus_v3_listing",
    listingLockTxHash: listing.lockTxHash,
    listingOutputIndex: listing.outputIndex,
  });
  await saveRegistry(reg);

  return c.json({
    txHash,
    datasetId: ds.id,
    buyerAddress,
    lovelace: lovelace.toString(),
    kind: "plutus_v3_listing",
  });
});

app.post("/api/developer/decrypt", async (c) => {
  let body: { datasetId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const datasetId = body.datasetId?.trim();
  if (!datasetId) return c.json({ error: "datasetId is required" }, 400);

  const reg = await loadRegistry();
  const ds = findDataset(reg, datasetId);
  if (!ds) return c.json({ error: "Dataset not found" }, 404);

  const buyer = await lucidFromMnemonic(buyerMnemonic());
  const buyerAddress = await buyer.wallet().address();

  if (!hasActivePlutusLicense(reg, datasetId, buyerAddress)) {
    return c.json({
      error:
        "No Plutus-backed license for this wallet (complete POST /api/creator/list-license then POST /api/developer/license).",
      buyerAddress,
    }, 403);
  }

  if (requireMidnightAttestation() && !isMidnightZkComplete(ds)) {
    return c.json({
      error:
        "Dataset missing Midnight ZK attestation; decrypt blocked until ZK path is complete.",
      zkComplete: false,
    }, 403);
  }

  const fileBytes = await readBlob(ds.blobRelativePath);
  const plaintext = await decryptDataset(fileBytes, ds.wrappedDek, ds.policy);

  return c.json({
    datasetId: ds.id,
    filename: ds.filename,
    plaintextBase64: encodeBase64(plaintext),
  });
});

const port = Number(optionalEnv("API_PORT") || "8788");

Deno.serve({ port }, app.fetch);

console.log(`NuAuth backend listening on http://127.0.0.1:${port}`);
