import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
import { cardanoBackend, creatorMnemonic } from "../lib/config.ts";
import { lucidFromMnemonic } from "./lucid_client.ts";

await load({ export: true });

const backend = cardanoBackend();
const lucid = await lucidFromMnemonic(creatorMnemonic());
const address = await lucid.wallet().address();
const utxos = await lucid.wallet().getUtxos();
const lovelace = utxos.reduce((acc, u) => {
  const q = u.assets.lovelace;
  return acc + (typeof q === "bigint" ? q : BigInt(q ?? 0));
}, BigInt(0));

console.log(JSON.stringify({
  cardanoBackend: backend,
  network: backend === "emulator"
    ? "Custom (Lucid Evolution emulator)"
    : (Deno.env.get("CARDANO_NETWORK") || "Preprod"),
  address,
  utxoCount: utxos.length,
  lovelace: lovelace.toString(),
}, null, 2));
