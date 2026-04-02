import { advanceEmulatorIfNeeded } from "../cardano/emulator_context.ts";
import { lucidFromMnemonic } from "../cardano/lucid_client.ts";
import { chunkCip20Messages } from "../lib/cip20.ts";
import { optionalEnv } from "../lib/env.ts";

export type StampPayload = {
  datasetId: string;
  commitment: string;
  filename: string;
  /** CIP-20 JSON must stay ASCII-safe; `zk` includes binding digests + Midnight circuit names. */
  zk: Record<string, unknown>;
};

/**
 * Anchors stamping metadata on Cardano (CIP-20 label 674) via a self-payment (holds min ADA).
 */
export async function submitStampTransaction(
  creatorMnemonic: string,
  payload: StampPayload,
): Promise<{ txHash: string }> {
  const lucid = await lucidFromMnemonic(creatorMnemonic);
  const addr = await lucid.wallet().address();
  const minLovelace = BigInt(optionalEnv("STAMP_MIN_LOVELACE") || "2000000");
  const json = JSON.stringify({
    t: "nuauth-stamp",
    ...payload,
  });
  const msg = chunkCip20Messages(json);
  const signed = await lucid.newTx()
    .pay.ToAddress(addr, { lovelace: minLovelace })
    .attachMetadata(674, { msg })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());
  const txHash = await signed.submit();
  advanceEmulatorIfNeeded();
  return { txHash };
}
