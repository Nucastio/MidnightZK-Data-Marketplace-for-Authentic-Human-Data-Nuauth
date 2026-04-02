import * as Rx from "rxjs";
import type { WalletContext } from "./wallet.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure the wallet has DUST available by registering any unregistered unshielded UTXOs.
 * This is required on Preview/Preprod for fee balancing.
 */
export async function ensureDustReady(
  ctx: WalletContext,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<void> {
  const pollMs = opts?.pollMs ?? 3000;
  const timeoutMs = opts?.timeoutMs ?? 180_000;

  await ctx.wallet.dust.waitForSyncedState();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await Rx.firstValueFrom(
      ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced), Rx.take(1)),
    );

    const dustNow = st.dust.balance(new Date());
    const unregistered = st.unshielded.availableCoins
      .filter((c) => !c.meta.registeredForDustGeneration)
      .map((c) => ({
        ...c.utxo,
        ctime: new Date(c.meta.ctime),
        registeredForDustGeneration: c.meta.registeredForDustGeneration,
      }));

    if (dustNow > 0n && unregistered.length === 0) {
      return;
    }

    if (unregistered.length === 0) {
      console.log(
        `[dust] waiting for unregistered unshielded UTXOs… dust=${dustNow} coins=${st.unshielded.availableCoins.length}`,
      );
      await sleep(pollMs);
      continue;
    }

    console.log(`[dust] registering ${unregistered.length} UTXO(s) for dust generation…`);
    const ttl = new Date(Date.now() + 10 * 60 * 1000);
    const registerTx = await ctx.wallet.dust.createDustGenerationTransaction(
      new Date(),
      ttl,
      unregistered,
      ctx.unshieldedKeystore.getPublicKey(),
      st.dust.address,
    );
    const intent = registerTx.intents?.get(1);
    if (!intent) throw new Error("Dust generation intent not found on transaction");
    const signature = ctx.unshieldedKeystore.signData(intent.signatureData(1));
    const recipe = await ctx.wallet.dust.addDustGenerationSignature(registerTx, signature);
    const finalized = await ctx.wallet.finalizeTransaction(recipe);
    const txId = await ctx.wallet.submitTransaction(finalized);
    console.log("[dust] submitted dust registration txId:", String(txId));

    await Rx.firstValueFrom(
      ctx.wallet
        .state()
        .pipe(Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n), Rx.take(1)),
    );
    return;
  }

  throw new Error(`[dust] timeout after ${timeoutMs}ms waiting for dust readiness`);
}

