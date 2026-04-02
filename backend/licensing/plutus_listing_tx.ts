import { advanceEmulatorIfNeeded } from "../cardano/emulator_context.ts";
import { lucidFromMnemonic } from "../cardano/lucid_client.ts";
import {
  listingDatumHex,
  listingNetwork,
  listingScriptAddress,
  loadListingSpendValidator,
  paymentKeyHashFromAddress,
  purchaseRedeemerHex,
} from "../cardano/license_listing.ts";
import { chunkCip20Messages } from "../lib/cip20.ts";
import { cardanoBackend } from "../lib/config.ts";
import type { LicenseListingRecord } from "../lib/state.ts";
import type { LicensePayload } from "./license_tx.ts";

export type NewListingResult = {
  lockTxHash: string;
  outputIndex: number;
  scriptAddress: string;
  priceLovelace: bigint;
  lockLovelace: bigint;
};

async function syncAfterSubmit(lucid: Awaited<ReturnType<typeof lucidFromMnemonic>>, txHash: string) {
  if (cardanoBackend() === "emulator") advanceEmulatorIfNeeded();
  else await lucid.awaitTx(txHash);
}

/**
 * Creator locks ADA + inline listing datum at `nuauth_license_listing`.
 */
export async function submitLicenseListingLock(
  creatorMnemonic: string,
  creatorAddress: string,
  datasetId: string,
  priceLovelace: bigint,
  lockLovelace: bigint,
): Promise<NewListingResult> {
  if (priceLovelace <= 0n) throw new Error("priceLovelace must be positive");
  if (lockLovelace <= 0n) throw new Error("lockLovelace must be positive");

  const lucid = await lucidFromMnemonic(creatorMnemonic);
  const walletAddr = await lucid.wallet().address();
  if (walletAddr !== creatorAddress) {
    throw new Error("Creator wallet address does not match dataset creatorAddress");
  }

  const network = listingNetwork();
  const script = loadListingSpendValidator();
  const scriptAddr = listingScriptAddress(network, script);
  const sellerVkh = paymentKeyHashFromAddress(creatorAddress);
  const datumHex = listingDatumHex(sellerVkh, datasetId, priceLovelace);

  const signed = await lucid.newTx()
    .pay.ToContract(
      scriptAddr,
      { kind: "inline", value: datumHex },
      { lovelace: lockLovelace },
    )
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  const lockTxHash = await signed.submit();
  await syncAfterSubmit(lucid, lockTxHash);

  const utxos = await lucid.utxosAt(scriptAddr);
  const match = utxos.find((u) =>
    u.txHash === lockTxHash && u.datum != null &&
    String(u.datum).toLowerCase() === datumHex.toLowerCase()
  );
  if (!match) {
    throw new Error("Could not resolve listing UTxO after lock transaction");
  }

  return {
    lockTxHash: match.txHash,
    outputIndex: match.outputIndex,
    scriptAddress: scriptAddr,
    priceLovelace,
    lockLovelace,
  };
}

/**
 * Buyer spends the listing UTxO and pays the seller; optional CIP-20 mirrors legacy indexing.
 */
export async function submitPlutusLicensePurchase(
  buyerMnemonic: string,
  sellerAddress: string,
  listing: LicenseListingRecord,
  datasetId: string,
  payload: LicensePayload,
): Promise<{ txHash: string }> {
  const price = BigInt(listing.priceLovelace);
  const lucid = await lucidFromMnemonic(buyerMnemonic);
  const script = loadListingSpendValidator();

  const [utxo] = await lucid.utxosByOutRef([{
    txHash: listing.lockTxHash,
    outputIndex: listing.outputIndex,
  }]);
  if (!utxo) {
    throw new Error(
      "Listing UTxO not found (already purchased or wrong network/ref)",
    );
  }

  const sellerVkh = paymentKeyHashFromAddress(sellerAddress);
  const expectedDatum = listingDatumHex(sellerVkh, datasetId, price);
  if (
    utxo.datum == null ||
    String(utxo.datum).toLowerCase() !== expectedDatum.toLowerCase()
  ) {
    throw new Error("Listing UTxO datum does not match dataset / seller / price");
  }

  const json = JSON.stringify({
    t: "nuauth-license-plutus",
    listingLockTxHash: listing.lockTxHash,
    listingOutputIndex: listing.outputIndex,
    ...payload,
  });
  const msg = chunkCip20Messages(json);
  const redeemerHex = purchaseRedeemerHex();

  const signed = await lucid.newTx()
    .attach.SpendingValidator(script)
    .collectFrom([utxo], redeemerHex)
    .pay.ToAddress(sellerAddress, { lovelace: price })
    .attachMetadata(674, { msg })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  const txHash = await signed.submit();
  await syncAfterSubmit(lucid, txHash);
  return { txHash };
}
