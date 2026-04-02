import {
  Constr,
  Data,
  getAddressDetails,
  validatorToAddress,
} from "@lucid-evolution/lucid";

/** Lucid `attach.SpendingValidator` shape (Plutus V3). */
export type PlutusV3SpendScript = { type: "PlutusV3"; script: string };
export type CardanoLucidNetwork = "Custom" | "Preprod" | "Mainnet" | "Preview";
import { blockfrostConfig, cardanoBackend } from "../lib/config.ts";
const REPO_ROOT = new URL("../../", import.meta.url);
const PLUTUS_JSON = new URL("cardano/aiken/plutus.json", REPO_ROOT);

type PlutusExport = {
  validators: Array<{ title: string; compiledCode: string }>;
};

export function loadListingSpendValidator(): PlutusV3SpendScript {
  const raw = Deno.readTextFileSync(PLUTUS_JSON);
  const blueprint = JSON.parse(raw) as PlutusExport;
  const v = blueprint.validators.find((x) =>
    x.title.endsWith(".spend") && x.title.includes("nuauth_license_listing")
  );
  if (!v?.compiledCode) {
    throw new Error("Missing compiled validator; run: cd cardano/aiken && aiken build");
  }
  return { type: "PlutusV3", script: v.compiledCode };
}

export function listingNetwork(): CardanoLucidNetwork {
  if (cardanoBackend() === "emulator") return "Custom";
  return blockfrostConfig().network;
}

export function listingScriptAddress(
  network: CardanoLucidNetwork,
  script: PlutusV3SpendScript,
): string {
  return validatorToAddress(network, script);
}

/** UTF-8 string → hex (Aiken ByteArray / dataset id on-chain). */
export function utf8ToHex(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function listingDatumHex(
  sellerPaymentKeyHash: string,
  datasetId: string,
  priceLovelace: bigint,
): string {
  return Data.to(
    new Constr(0, [sellerPaymentKeyHash, utf8ToHex(datasetId), priceLovelace]),
  );
}

export function purchaseRedeemerHex(): string {
  return Data.to(new Constr(0, []));
}

export function paymentKeyHashFromAddress(addressBech32: string): string {
  const payCred = getAddressDetails(addressBech32).paymentCredential;
  if (payCred?.type !== "Key") {
    throw new Error("Address must use a key payment credential");
  }
  return payCred.hash;
}
