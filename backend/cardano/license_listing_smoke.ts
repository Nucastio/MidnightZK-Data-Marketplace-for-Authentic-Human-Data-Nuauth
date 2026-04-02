/**
 * Full Plutus V3 smoke: lock `nuauth_license_listing` + buyer spend (Lucid Evolution on Deno).
 *
 * Prereq: `cd cardano/aiken && aiken build`
 *
 * Emulator: `CARDANO_BACKEND=emulator` + WALLET_MNEMONIC (+ optional BUYER_WALLET_MNEMONIC)
 * Preprod: `CARDANO_BACKEND=blockfrost` + BLOCKFROST_PROJECT_ID + funded wallets
 */
import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
import {
  Blockfrost,
  Constr,
  Data,
  getAddressDetails,
  Lucid,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import {
  blockfrostConfig,
  buyerMnemonic,
  cardanoBackend,
  creatorMnemonic,
} from "../lib/config.ts";
import { advanceEmulatorIfNeeded } from "./emulator_context.ts";
import { getOrCreateSharedEmulator } from "./emulator.ts";

const REPO_ROOT = new URL("../../", import.meta.url);
const PLUTUS_JSON = new URL("cardano/aiken/plutus.json", REPO_ROOT);

type PlutusExport = {
  validators: Array<{ title: string; compiledCode: string }>;
};

function loadSpendScript(): { type: "PlutusV3"; script: string } {
  const raw = Deno.readTextFileSync(PLUTUS_JSON);
  const blueprint = JSON.parse(raw) as PlutusExport;
  const v = blueprint.validators.find((x) =>
    x.title.endsWith(".spend") && x.title.includes("nuauth_license_listing")
  );
  if (!v?.compiledCode) throw new Error("Run: cd cardano/aiken && aiken build");
  return { type: "PlutusV3", script: v.compiledCode };
}

function textToHex(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

await load({ export: true });

const price = BigInt(Deno.env.get("LICENSE_LISTING_PRICE_LOVELACE") || "3000000");
const lockLovelace = BigInt(
  Deno.env.get("LICENSE_LISTING_LOCK_LOVELACE") || "5000000",
);
const datasetId = Deno.env.get("LICENSE_LISTING_DATASET_ID") || "smoke-dataset-01";

const script = loadSpendScript();
const backend = cardanoBackend();

let lucid: Awaited<ReturnType<typeof Lucid>>;
let network: "Custom" | "Preprod" | "Mainnet" | "Preview";
if (backend === "emulator") {
  network = "Custom";
  lucid = await Lucid(getOrCreateSharedEmulator(), "Custom");
} else {
  const c = blockfrostConfig();
  network = c.network;
  lucid = await Lucid(new Blockfrost(c.url, c.projectId), c.network);
}

const scriptAddr = validatorToAddress(network, script);

lucid.selectWallet.fromSeed(creatorMnemonic().trim(), {
  addressType: "Base",
  accountIndex: 0,
});

const sellerAddr = await lucid.wallet().address();
const payCred = getAddressDetails(sellerAddr).paymentCredential;
if (payCred?.type !== "Key") {
  throw new Error("Seller must use key payment credential");
}
const sellerVkh = payCred.hash;

const datumHex = Data.to(
  new Constr(0, [sellerVkh, textToHex(datasetId), price]),
);

console.log(
  JSON.stringify({
    cardanoBackend: backend,
    network,
    scriptAddress: scriptAddr,
    sellerAddress: sellerAddr,
    priceLovelace: price.toString(),
    lockLovelace: lockLovelace.toString(),
    datasetId,
  }, null, 2),
);

const lockSigned = await lucid.newTx()
  .pay.ToContract(
    scriptAddr,
    { kind: "inline", value: datumHex },
    { lovelace: lockLovelace },
  )
  .complete()
  .then((tb) => tb.sign.withWallet().complete());

const lockHash = await lockSigned.submit();
if (backend === "emulator") advanceEmulatorIfNeeded();
else await lucid.awaitTx(lockHash);

console.log(JSON.stringify({ step: "lock_submitted", txHash: lockHash }, null, 2));

lucid.selectWallet.fromSeed(buyerMnemonic().trim(), {
  addressType: "Base",
  accountIndex: 0,
});

const scriptUtxos = await lucid.utxosAt(scriptAddr);
if (scriptUtxos.length === 0) {
  throw new Error("No UTxO at script after lock");
}

const redeemerHex = Data.to(new Constr(0, []));

const purchaseSigned = await lucid.newTx()
  .attach.SpendingValidator(script)
  .collectFrom(scriptUtxos, redeemerHex)
  .pay.ToAddress(sellerAddr, { lovelace: price })
  .complete()
  .then((tb) => tb.sign.withWallet().complete());

const purchaseHash = await purchaseSigned.submit();
if (backend === "emulator") advanceEmulatorIfNeeded();
else await lucid.awaitTx(purchaseHash);

console.log(
  JSON.stringify({
    step: "purchase_complete",
    buyerAddress: await lucid.wallet().address(),
    lockTxHash: lockHash,
    purchaseTxHash: purchaseHash,
  }, null, 2),
);
