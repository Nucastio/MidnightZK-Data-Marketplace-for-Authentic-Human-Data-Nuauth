import { toHex } from "../lib/hex.ts";

/** Content commitment (SHA-256 over raw bytes). ZK / Midnight proofs can anchor this hash later. */
export async function contentCommitment(plaintext: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(plaintext));
  return toHex(new Uint8Array(buf));
}
