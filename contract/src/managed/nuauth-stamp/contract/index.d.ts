import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  creatorSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                              value: Uint8Array
                                                                            }];
}

export type ImpureCircuits<PS> = {
  proveCreatorStamp(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  bindL1Stamp(context: __compactRuntime.CircuitContext<PS>, anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  proveCreatorStamp(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  bindL1Stamp(context: __compactRuntime.CircuitContext<PS>, anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  proveCreatorStamp(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  bindL1Stamp(context: __compactRuntime.CircuitContext<PS>, anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly contentCommitment: Uint8Array;
  readonly creatorPk: Uint8Array;
  readonly l1Anchor: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               commitment_0: Uint8Array,
               ownerPk_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
