import type { DatasetRecord } from "./state.ts";
import { optionalEnv } from "./env.ts";

/**
 * Per SRS, ZK verification is satisfied through Midnight circuits; Cardano carries anchors + licensing.
 * When strict (default), listing/licensing/decrypt require a recorded Midnight attestation after Cardano stamp.
 */
export function requireMidnightAttestation(): boolean {
  const v = optionalEnv("NUAUTH_REQUIRE_MIDNIGHT_STRICT");
  if (v === "0" || v?.toLowerCase() === "false") return false;
  return true;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
/** Midnight segment / tx identifiers are hex; accept 64-char hashes (strict) or allow 52+ for flexibility */
function validMidnightTxId(s: string): boolean {
  if (HEX64.test(s)) return true;
  return /^[0-9a-fA-F]{52,128}$/.test(s);
}

export function isMidnightZkComplete(ds: DatasetRecord): boolean {
  const m = ds.midnightAttestation;
  if (!ds.stampTxHash || !m) return false;
  if (!m.contractAddress?.trim()) return false;
  if (!validMidnightTxId(m.proveCreatorStampTxHash)) return false;
  if (!validMidnightTxId(m.bindL1StampTxHash)) return false;
  return true;
}

export function assertMidnightAttestationPayload(m: {
  contractAddress?: string;
  proveCreatorStampTxHash?: string;
  bindL1StampTxHash?: string;
}): string | null {
  if (!m.contractAddress?.trim()) return "contractAddress is required";
  if (!m.proveCreatorStampTxHash || !validMidnightTxId(m.proveCreatorStampTxHash)) {
    return "proveCreatorStampTxHash must be a hex transaction/segment id from Midnight";
  }
  if (!m.bindL1StampTxHash || !validMidnightTxId(m.bindL1StampTxHash)) {
    return "bindL1StampTxHash must be a hex transaction/segment id from Midnight";
  }
  return null;
}
