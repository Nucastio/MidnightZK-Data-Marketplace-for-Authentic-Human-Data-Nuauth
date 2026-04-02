import { Emulator, Lucid, walletFromSeed } from "@lucid-evolution/lucid";
import {
  buyerMnemonic,
  cardanoBackend,
  creatorMnemonic,
} from "../lib/config.ts";
import { optionalEnv } from "../lib/env.ts";
import { getSharedEmulator, setSharedEmulator } from "./emulator_context.ts";

function uniqueWalletSeeds(): string[] {
  const seeds = [creatorMnemonic(), buyerMnemonic()].map((s) => s.trim());
  return [...new Set(seeds)];
}

function emuAccount(
  seedPhrase: string,
  lovelace: bigint,
  accountIndex: number,
) {
  const w = walletFromSeed(seedPhrase, {
    network: "Custom",
    addressType: "Base",
    accountIndex,
  });
  return {
    seedPhrase,
    address: w.address,
    privateKey: w.paymentKey,
    assets: { lovelace },
  };
}

/**
 * One in-process Lucid Evolution `Emulator`, pre-funded for each distinct creator/buyer mnemonic.
 */
export function getOrCreateSharedEmulator(): Emulator {
  const existing = getSharedEmulator();
  if (existing) return existing;

  const lovelace = BigInt(
    optionalEnv("EMULATOR_SEED_LOVELACE") || "50000000000",
  );
  const accountIndex = Number(optionalEnv("EMULATOR_ACCOUNT_INDEX") || "0");

  const accounts = uniqueWalletSeeds().map((seed) =>
    emuAccount(seed, lovelace, accountIndex)
  );

  const emulator = new Emulator(accounts);
  setSharedEmulator(emulator);
  return emulator;
}

export async function lucidWithEmulator(
  mnemonic: string,
): Promise<Awaited<ReturnType<typeof Lucid>>> {
  if (cardanoBackend() !== "emulator") {
    throw new Error(
      "lucidWithEmulator called while CARDANO_BACKEND is not emulator",
    );
  }
  const emulator = getOrCreateSharedEmulator();
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(mnemonic.trim(), {
    addressType: "Base",
    accountIndex: Number(optionalEnv("EMULATOR_ACCOUNT_INDEX") || "0"),
  });
  return lucid;
}
