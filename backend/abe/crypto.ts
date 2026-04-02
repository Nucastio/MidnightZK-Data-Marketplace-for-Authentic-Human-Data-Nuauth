import { abeMasterKey } from "../lib/config.ts";
import { toHex, fromHex } from "../lib/hex.ts";
import type { WrappedDekRecord } from "../lib/state.ts";

export type PolicyV1 = { datasetId: string; kind: "nuauth-v1" };

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(buf);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Derives a per-dataset AES key from the master secret (prototype policy binding). */
async function deriveDatasetWrapKey(
  master: Uint8Array,
  policy: PolicyV1,
): Promise<CryptoKey> {
  const info = new TextEncoder().encode(
    `nuauth:wrap:${policy.kind}:${policy.datasetId}`,
  );
  const raw = await sha256(concat(master, info));
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(raw),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; combined: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      new Uint8Array(plaintext),
    ),
  );
  return { iv, combined };
}

async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  combined: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      new Uint8Array(combined),
    ),
  );
}

/**
 * Encrypt dataset at rest: random DEK → AES-GCM(plaintext); wrap DEK with policy-bound key.
 * On-disk blob layout: `iv (12 bytes) || AES-GCM ciphertext including tag`.
 */
export async function encryptDataset(
  plaintext: Uint8Array,
  policy: PolicyV1,
): Promise<{ ciphertextFileBytes: Uint8Array; wrappedDek: WrappedDekRecord }> {
  const master = abeMasterKey();
  const wrapKey = await deriveDatasetWrapKey(master, policy);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const dekKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(dek),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const body = await aesGcmEncrypt(dekKey, plaintext);
  const ciphertextFileBytes = concat(body.iv, body.combined);
  const wrap = await aesGcmEncrypt(wrapKey, dek);
  const wrappedDek: WrappedDekRecord = {
    iv: toHex(wrap.iv),
    combined: toHex(wrap.combined),
  };
  return { ciphertextFileBytes, wrappedDek };
}

export async function decryptDataset(
  ciphertextFileBytes: Uint8Array,
  wrapped: WrappedDekRecord,
  policy: PolicyV1,
): Promise<Uint8Array> {
  const master = abeMasterKey();
  const wrapKey = await deriveDatasetWrapKey(master, policy);
  const dekPlain = await aesGcmDecrypt(
    wrapKey,
    new Uint8Array(fromHex(wrapped.iv)),
    new Uint8Array(fromHex(wrapped.combined)),
  );
  const dekKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(dekPlain),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = new Uint8Array(ciphertextFileBytes.slice(0, 12));
  const combined = new Uint8Array(ciphertextFileBytes.slice(12));
  return aesGcmDecrypt(dekKey, iv, combined);
}
