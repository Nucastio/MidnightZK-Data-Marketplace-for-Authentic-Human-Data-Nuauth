/**
 * Midnight.js wiring: `CompiledContract` + ZK artifact paths (see ZK-Stables bridge contract package).
 *
 * Constructor args (order matches generated `Contract.initialState`):
 * `[contentCommitment, creatorPk]`
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as NuauthStamp from './managed/nuauth-stamp/contract/index.js';
import { nuauthStampWitnesses } from './witnesses-nuauth-stamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const nuauthStampZkConfigPath = path.resolve(
  __dirname,
  'managed',
  'nuauth-stamp',
);

export const nuauthStampCompiledContract = CompiledContract.make(
  'nuauth-stamp',
  NuauthStamp.Contract,
).pipe(
  CompiledContract.withWitnesses(nuauthStampWitnesses),
  CompiledContract.withCompiledFileAssets(nuauthStampZkConfigPath),
);

export const nuauthStampPrivateStateId = 'nuauthStampPrivateState' as const;

export type NuauthStampConstructorArgs = readonly [
  contentCommitment: Uint8Array,
  creatorPk: Uint8Array,
];
