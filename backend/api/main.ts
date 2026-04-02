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

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

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
