/**
 * End-to-end smoke: lock ADA + inline datum at `nuauth_license_listing`, then buyer spends
 * with `Purchase` redeemer while paying seller >= datum.price.
 *
 * Uses @lucid-evolution/lucid (Plutus V3). Prefer Deno: `deno task cardano:license-smoke:emulator` from repo root.
 *
 * Env:
 *   Emulator (default): WALLET_MNEMONIC; optional BUYER_WALLET_MNEMONIC (else same as seller).
 *   Preprod: CARDANO_BACKEND=blockfrost BLOCKFROST_PROJECT_ID WALLET_MNEMONIC BUYER_WALLET_MNEMONIC (recommended distinct funded wallets).
 *
 * Optional: LICENSE_LISTING_PRICE_LOVELACE, LICENSE_LISTING_LOCK_LOVELACE, LICENSE_LISTING_DATASET_ID
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Lucid } from "@lucid-evolution/lucid";
import { Blockfrost, Emulator } from "@lucid-evolution/provider";
import { Data, Constr } from "@lucid-evolution/plutus";
import { walletFromSeed } from "@lucid-evolution/wallet";
import { getAddressDetails, validatorToAddress } from "@lucid-evolution/utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUTUS_JSON = join(__dirname, "../../plutus.json");

function loadSpendScript() {
  const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const v = blueprint.validators.find(
    (x) => x.title.includes("nuauth_license_listing") && x.title.endsWith(".spend"),
  );
  if (!v?.compiledCode) {
    throw new Error("Run from repo: cd cardano/aiken && aiken build");
  }
  return { type: "PlutusV3", script: v.compiledCode };
}

function textToHex(s) {
  return Buffer.from(s, "utf8").toString("hex");
}

function emuAccount(seedPhrase, lovelace) {
  const w = walletFromSeed(seedPhrase, {
    network: "Custom",
    addressType: "Base",
    accountIndex: 0,
  });
  return {
    seedPhrase,
    address: w.address,
    privateKey: w.paymentKey,
    assets: { lovelace },
  };
}

const sellerMnemonic =
  process.env.WALLET_MNEMONIC ||
  process.env.CREATOR_WALLET_MNEMONIC ||
  process.env.SELLER_WALLET_MNEMONIC;
const buyerMnemonic =
  process.env.BUYER_WALLET_MNEMONIC || sellerMnemonic;

if (!sellerMnemonic?.trim()) {
  console.error("Set WALLET_MNEMONIC (or CREATOR_WALLET_MNEMONIC)");
  process.exit(1);
}

const price = BigInt(process.env.LICENSE_LISTING_PRICE_LOVELACE || "3000000");
const lockLovelace = BigInt(process.env.LICENSE_LISTING_LOCK_LOVELACE || "5000000");
const datasetId = process.env.LICENSE_LISTING_DATASET_ID || "smoke-dataset-01";
const script = loadSpendScript();

const useBf = (process.env.CARDANO_BACKEND || "").toLowerCase() === "blockfrost";

/** @type {import("@lucid-evolution/lucid").LucidEvolution} */
let lucid;
/** @type {import("@lucid-evolution/provider").Emulator | null} */
let emulator = null;
let network;

if (useBf) {
  const url =
    process.env.BLOCKFROST_URL ||
    "https://cardano-preprod.blockfrost.io/api/v0";
  const pid = process.env.BLOCKFROST_PROJECT_ID;
  if (!pid) {
    console.error("CARDANO_BACKEND=blockfrost requires BLOCKFROST_PROJECT_ID");
    process.exit(1);
  }
  network = process.env.CARDANO_NETWORK === "Mainnet" ? "Mainnet" : "Preprod";
  lucid = await Lucid(new Blockfrost(url, pid), network);
} else {
  network = "Custom";
  const ada = 50_000_000_000n;
  const accounts = [emuAccount(sellerMnemonic.trim(), ada)];
  const b = buyerMnemonic.trim();
  if (b !== sellerMnemonic.trim()) {
    accounts.push(emuAccount(b, ada));
  }
  emulator = new Emulator(accounts);
  lucid = await Lucid(emulator, "Custom");
}

const scriptAddr = validatorToAddress(network, script);

lucid.selectWallet.fromSeed(sellerMnemonic.trim(), {
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
  JSON.stringify(
    {
      mode: useBf ? "blockfrost" : "emulator",
      network,
      scriptAddress: scriptAddr,
      sellerAddress: sellerAddr,
      priceLovelace: price.toString(),
      lockLovelace: lockLovelace.toString(),
      datasetId,
    },
    null,
    2,
  ),
);

const lockSigned = await lucid
  .newTx()
  .pay.ToContract(
    scriptAddr,
    { kind: "inline", value: datumHex },
    { lovelace: lockLovelace },
  )
  .complete()
  .then((t) => t.sign.withWallet().complete());

const lockHash = await lockSigned.submit();
if (emulator) emulator.awaitBlock(1);
else await lucid.awaitTx(lockHash);

console.log(JSON.stringify({ step: "lock_submitted", txHash: lockHash }, null, 2));

lucid.selectWallet.fromSeed(buyerMnemonic.trim(), {
  addressType: "Base",
  accountIndex: 0,
});

const scriptUtxos = await lucid.utxosAt(scriptAddr);
if (scriptUtxos.length === 0) {
  throw new Error("No script UTxOs — wait for sync or fund buyer/seller");
}

const redeemerHex = Data.to(new Constr(0, []));

const purchaseSigned = await lucid
  .newTx()
  .attach.SpendingValidator(script)
  .collectFrom(scriptUtxos, redeemerHex)
  .pay.ToAddress(sellerAddr, { lovelace: price })
  .complete()
  .then((t) => t.sign.withWallet().complete());

const purchaseHash = await purchaseSigned.submit();
if (emulator) emulator.awaitBlock(1);
else await lucid.awaitTx(purchaseHash);

const buyerAddrOut = await lucid.wallet().address();
console.log(
  JSON.stringify(
    {
      step: "purchase_complete",
      buyerAddress: buyerAddrOut,
      lockTxHash: lockHash,
      purchaseTxHash: purchaseHash,
    },
    null,
    2,
  ),
);
