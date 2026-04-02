/**
 * Print Midnight unshielded (tNIGHT) address for the current network id — no RPC sync.
 *
 * Usage:
 *   MIDNIGHT_DEPLOY_NETWORK=preprod BIP39_MNEMONIC="…" npx tsx src/print-midnight-address.ts
 *
 * Without BIP39_MNEMONIC: generates a new 24-word phrase and prints it (save immediately).
 */
import { Buffer } from "buffer";
import * as bip39 from "bip39";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";

function resolveNetworkId(): "preview" | "preprod" | "undeployed" {
  const v = (process.env.MIDNIGHT_DEPLOY_NETWORK || "preprod").toLowerCase().trim();
  if (v === "undeployed" || v === "local") return "undeployed";
  if (v === "preview") return "preview";
  return "preprod";
}

async function main(): Promise<void> {
  const networkId = resolveNetworkId();
  setNetworkId(networkId);

  let mnemonic = process.env.BIP39_MNEMONIC?.trim();
  let generated = false;
  if (!mnemonic) {
    mnemonic = bip39.generateMnemonic(256);
    generated = true;
  }
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error("Invalid BIP39_MNEMONIC");
    process.exit(1);
  }

  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seed));
  if (hdWallet.type !== "seedOk") throw new Error("HDWallet init failed");

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") throw new Error("Key derivation failed");

  hdWallet.hdWallet.clear();

  const keystore = createKeystore(derivationResult.keys[Roles.NightExternal], networkId);
  const rawAddr = keystore.getBech32Address();
  const unshieldedAddress =
    typeof rawAddr === "string" ? rawAddr : rawAddr.toString();

  console.log(JSON.stringify({
    midnightNetworkId: networkId,
    unshieldedAddress,
    ...(generated ? { generatedMnemonic24: mnemonic } : {}),
    note: "Fund tNIGHT at this address via https://faucet.preprod.midnight.network/ then register UTXOs for DUST per Midnight docs.",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
