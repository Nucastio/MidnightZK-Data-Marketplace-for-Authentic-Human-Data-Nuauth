import type { Emulator } from "@lucid-evolution/lucid";

let shared: Emulator | null = null;

export function setSharedEmulator(emulator: Emulator): void {
  shared = emulator;
}

export function getSharedEmulator(): Emulator | null {
  return shared;
}

/** Move emulator mempool → ledger so the next tx sees change UTxOs. */
export function advanceEmulatorIfNeeded(): void {
  const e = shared;
  if (e) {
    e.awaitBlock(1);
  }
}
