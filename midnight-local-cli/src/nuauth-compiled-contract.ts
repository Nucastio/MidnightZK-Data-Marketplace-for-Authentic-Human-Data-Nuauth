/**
 * Must use the same `@midnight-ntwrk/compact-js` instance as `@midnight-ntwrk/midnight-js-contracts`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { NuauthStamp, nuauthStampWitnesses } from '@nuauth/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const nuauthStampCompiledContractLocal = CompiledContract.make(
  'nuauth-stamp',
  NuauthStamp.Contract,
).pipe(
  CompiledContract.withWitnesses(nuauthStampWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/nuauth-stamp'),
  ),
);
