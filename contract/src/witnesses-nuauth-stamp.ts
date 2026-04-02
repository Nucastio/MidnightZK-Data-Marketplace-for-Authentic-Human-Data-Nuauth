import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/nuauth-stamp/contract/index.js';

export type NuauthStampPrivateState = {
  creatorSecretKey?: Uint8Array;
};

export const nuauthStampWitnesses = {
  creatorSecret: ({
    privateState,
  }: WitnessContext<Ledger, NuauthStampPrivateState>): [
    NuauthStampPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    {
      is_some: true,
      value: privateState.creatorSecretKey ?? new Uint8Array(),
    },
  ],
};
