import { dataDir } from "./config.ts";

export type WrappedDekRecord = {
  iv: string;
  /** Full AES-GCM output (ciphertext || 128-bit tag), hex-encoded. */
  combined: string;
};

/** Recorded after `proveCreatorStamp` + `bindL1Stamp` on Midnight (undeployed or future network). */
export type MidnightAttestation = {
  contractAddress: string;
  proveCreatorStampTxHash: string;
  bindL1StampTxHash: string;
  attestedAt: string;
};

/** Active Plutus listing (one open offer per dataset in this prototype). */
export type LicenseListingRecord = {
  lockTxHash: string;
  outputIndex: number;
  priceLovelace: string;
  lockLovelace: string;
  scriptAddress: string;
  listedAt: string;
};

export type DatasetRecord = {
  id: string;
  filename: string;
  creatorAddress: string;
  commitment: string;
  policy: { datasetId: string; kind: "nuauth-v1" };
  wrappedDek: WrappedDekRecord;
  blobRelativePath: string;
  createdAt: string;
  stampTxHash?: string;
  stampMetadata?: Record<string, unknown>;
  /** Mandatory for SRS ZK: Midnight ZK circuits executed and tx ids recorded (see `zk_policy.ts`). */
  midnightAttestation?: MidnightAttestation;
  /** Open `nuauth_license_listing` UTxO; cleared after a successful Plutus purchase. */
  licenseListing?: LicenseListingRecord;
};

export type LicenseKind = "plutus_v3_listing" | "cip20_metadata";

export type LicenseRecord = {
  datasetId: string;
  buyerAddress: string;
  txHash: string;
  lovelace: string;
  createdAt: string;
  /**
   * `plutus_v3_listing` — buyer spent the listing validator; required for decrypt.
   * Omitted or `cip20_metadata` — legacy payment-only row (decrypt ignores).
   */
  kind?: LicenseKind;
  listingLockTxHash?: string;
  listingOutputIndex?: number;
};

export type RegistryFile = {
  datasets: DatasetRecord[];
  licenses: LicenseRecord[];
};

const REGISTRY = "registry.json";

function registryPath(): string {
  return `${dataDir()}/${REGISTRY}`;
}

async function ensureDir(): Promise<void> {
  await Deno.mkdir(dataDir(), { recursive: true });
}

export async function loadRegistry(): Promise<RegistryFile> {
  try {
    const raw = await Deno.readTextFile(registryPath());
    return JSON.parse(raw) as RegistryFile;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { datasets: [], licenses: [] };
    }
    throw e;
  }
}

export async function saveRegistry(reg: RegistryFile): Promise<void> {
  await ensureDir();
  const path = registryPath();
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(reg, null, 2));
  await Deno.rename(tmp, path);
}

export function findDataset(reg: RegistryFile, id: string): DatasetRecord | undefined {
  return reg.datasets.find((d) => d.id === id);
}

export function upsertDataset(reg: RegistryFile, ds: DatasetRecord): void {
  const i = reg.datasets.findIndex((d) => d.id === ds.id);
  if (i >= 0) reg.datasets[i] = ds;
  else reg.datasets.push(ds);
}

export function addLicense(reg: RegistryFile, lic: LicenseRecord): void {
  const dup = reg.licenses.some((l) =>
    l.datasetId === lic.datasetId && l.buyerAddress === lic.buyerAddress &&
    l.txHash === lic.txHash
  );
  if (!dup) reg.licenses.push(lic);
}

export function licenseKindOf(l: LicenseRecord): LicenseKind {
  return l.kind ?? "cip20_metadata";
}

/** Legacy helper — any license row (not used for decrypt). */
export function hasActiveLicense(
  reg: RegistryFile,
  datasetId: string,
  buyerAddress: string,
): boolean {
  return reg.licenses.some((l) =>
    l.datasetId === datasetId && l.buyerAddress === buyerAddress
  );
}

/** Decrypt and marketplace ABE gate: only Plutus listing purchases count. */
export function hasActivePlutusLicense(
  reg: RegistryFile,
  datasetId: string,
  buyerAddress: string,
): boolean {
  return reg.licenses.some((l) =>
    l.datasetId === datasetId &&
    l.buyerAddress === buyerAddress &&
    licenseKindOf(l) === "plutus_v3_listing"
  );
}
