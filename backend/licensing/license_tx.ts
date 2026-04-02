import { advanceEmulatorIfNeeded } from "../cardano/emulator_context.ts";
import { lucidFromMnemonic } from "../cardano/lucid_client.ts";
import { chunkCip20Messages } from "../lib/cip20.ts";

export type LicensePayload = {
  datasetId: string;
  buyerAddress: string;
  filename: string;
  commitment: string;
};

/**
 * Buyer pays creator with CIP-20 metadata recording the license intent (prototype automation).
 */
export async function submitLicensePayment(
  buyerMnemonic: string,
  creatorAddress: string,
  lovelace: bigint,
  payload: LicensePayload,
): Promise<{ txHash: string }> {
  const lucid = await lucidFromMnemonic(buyerMnemonic);
  const json = JSON.stringify({
    t: "nuauth-license",
    ...payload,
  });
  const msg = chunkCip20Messages(json);
  const signed = await lucid.newTx()
    .pay.ToAddress(creatorAddress, { lovelace })
    .attachMetadata(674, { msg })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());
  const txHash = await signed.submit();
  advanceEmulatorIfNeeded();
  return { txHash };
}
