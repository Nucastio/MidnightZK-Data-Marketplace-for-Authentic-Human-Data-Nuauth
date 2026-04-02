import { toHex } from "../lib/hex.ts";
import { cardanoBackend } from "../lib/config.ts";

async function sha256HexUtf8(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return toHex(new Uint8Array(buf));
}

/**
 * Cross-layer ZK / binding metadata (inspired by ZK-Stables proof binding docs):
 * - `bindingDigest` commits dataset + Cardano backend + optional L1 tx id.
 * - `l1AnchorDigestHex` is a 32-byte digest suitable for Midnight `bindL1Stamp` (pass as hex env `NUAUTH_L1_ANCHOR_HEX`).
 */
export async function buildStampZkBundle(input: {
  datasetId: string;
  commitment: string;
  filename: string;
  /** Set after Cardano `submit` to finalize binding and derive `l1AnchorDigestHex`. */
  cardanoStampTxHash?: string;
}): Promise<Record<string, string | string[]>> {
  const backend = cardanoBackend();
  const preimage =
    `nuauth:zk:v1|${input.datasetId}|${input.commitment}|${input.filename}|${backend}|${
      input.cardanoStampTxHash ?? ""
    }`;
  const bindingDigest = await sha256HexUtf8(preimage);
  const l1AnchorDigestHex = input.cardanoStampTxHash?.length
    ? await sha256HexUtf8(`nuauth:l1-anchor|${input.cardanoStampTxHash}`)
    : "";

  return {
    version: "nuauth-zk-v1",
    bindingDigest,
    l1AnchorDigestHex: l1AnchorDigestHex || "",
    midnightCircuits: ["proveCreatorStamp", "bindL1Stamp"],
    midnightNetwork: "undeployed-local",
    cardanoBackend: backend,
    note:
      "ZK is defined on Midnight: run proveCreatorStamp + bindL1Stamp (see midnight-local-cli), then POST /api/creator/midnight/attest. Licensing/decrypt require attestation when NUAUTH_REQUIRE_MIDNIGHT_STRICT is on (default).",
  };
}
