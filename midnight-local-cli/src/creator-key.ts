import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';

function pad32Utf8(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const o = new Uint8Array(32);
  o.set(b.slice(0, 32));
  return o;
}

/** Must match `hashCreatorPk` in `nuauth-stamp.compact`. */
export function creatorLedgerPublicKey(creatorSk: Uint8Array): Uint8Array {
  if (creatorSk.length !== 32) {
    throw new Error('creator secret must be 32 bytes');
  }
  const t = new CompactTypeVector(2, new CompactTypeBytes(32));
  return persistentHash(t, [pad32Utf8('nuauth:stamp:creator:v1'), creatorSk]);
}
