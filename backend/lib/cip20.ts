/**
 * CIP-20: each `msg` entry must be at most 64 UTF-8 bytes.
 * Payload should be ASCII-only JSON so 64-byte slices never split UTF-8 codepoints.
 */
const MAX_MSG_BYTES = 64;

const dec = new TextDecoder();

export function chunkCip20Messages(payload: string): string[] {
  const enc = new TextEncoder();
  const bytes = enc.encode(payload);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += MAX_MSG_BYTES) {
    chunks.push(dec.decode(bytes.subarray(i, i + MAX_MSG_BYTES)));
  }
  return chunks;
}
