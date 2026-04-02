import { Blockfrost, Lucid } from "@lucid-evolution/lucid";
import { blockfrostConfig, cardanoBackend } from "../lib/config.ts";
import { lucidWithEmulator } from "./emulator.ts";

export type CardanoNetworkName = "Preprod" | "Mainnet" | "Preview";

/** Lucid Evolution instance (Plutus V1/V2/V3 capable). */
export type NuauthLucid = Awaited<ReturnType<typeof Lucid>>;

export async function lucidFromMnemonic(mnemonic: string): Promise<NuauthLucid> {
  if (cardanoBackend() === "emulator") {
    return lucidWithEmulator(mnemonic);
  }
  const c = blockfrostConfig();
  const lucid = await Lucid(new Blockfrost(c.url, c.projectId), c.network);
  lucid.selectWallet.fromSeed(mnemonic.trim(), {
    addressType: "Base",
    accountIndex: 0,
  });
  return lucid;
}
