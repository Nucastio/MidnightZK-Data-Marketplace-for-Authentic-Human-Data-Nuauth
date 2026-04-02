/**
 * Fund a BIP39 wallet on **undeployed** local Midnight (Brick Towers Docker) from the genesis
 * wallet, then register unshielded UTXOs for DUST — same flow as midnight-local-network's
 * `fund-and-register-dust`, but uses Nuauth's {@link initWalletWithSeed} (patched wallet SDKs).
 *
 * Env: `MIDNIGHT_DEPLOY_NETWORK=undeployed` (default here), `BIP39_MNEMONIC` or pass mnemonic as argv.
 */
import { Buffer } from "buffer";
import * as bip39 from "bip39";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import * as rx from "rxjs";
import type { CombinedTokenTransfer, WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import {
  DustAddress,
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import type { UnshieldedWalletState } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { NuauthMidnightConfig } from "./config.js";
import { initWalletWithSeed, type WalletContext } from "./wallet.js";

const TRANSFER_AMOUNT = 31_337_000_000n;

const GENESIS_SEED = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000001",
  "hex",
);

function mnemonicFromEnvOrArgv(): string {
  const arg = process.argv[2];
  const fromEnv = process.env.BIP39_MNEMONIC?.trim();
  const m = arg || fromEnv;
  if (!m) {
    console.error("Usage: BIP39_MNEMONIC='…' npx tsx src/fund-local-undeployed.ts\n   or: npx tsx src/fund-local-undeployed.ts \"word1 word2 …\"");
    process.exit(2);
  }
  if (!bip39.validateMnemonic(m)) {
    console.error("Invalid BIP39 mnemonic.");
    process.exit(2);
  }
  return m;
}

async function fundFromGenesis(
  sender: WalletContext,
  outputs: CombinedTokenTransfer[],
): Promise<string> {
  const recipe = await sender.wallet.transferTransaction(
    outputs,
    {
      shieldedSecretKeys: sender.shieldedSecretKeys,
      dustSecretKey: sender.dustSecretKey,
    },
    {
      ttl: new Date(Date.now() + 30 * 60 * 1000),
      payFees: true,
    },
  );

  const signedTx = await sender.wallet.signUnprovenTransaction(
    recipe.transaction,
    (payload) => sender.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await sender.wallet.finalizeTransaction(signedTx);
  return sender.wallet.submitTransaction(finalizedTx);
}

async function registerDustGeneration(
  walletFacade: WalletFacade,
  unshieldedState: UnshieldedWalletState,
  dustReceiverAddress: DustAddress,
  unshieldedPublicKey: ledger.SignatureVerifyingKey,
  signWithUnshielded: (payload: Uint8Array) => ledger.Signature,
): Promise<string | undefined> {
  const ttlIn10min = new Date(Date.now() + 10 * 60 * 1000);
  await walletFacade.dust.waitForSyncedState();

  const utxos = unshieldedState.availableCoins
    .filter((coin) => !coin.meta.registeredForDustGeneration)
    .map((utxo) => ({
      ...utxo.utxo,
      ctime: new Date(utxo.meta.ctime),
      registeredForDustGeneration: utxo.meta.registeredForDustGeneration,
    }));

  if (utxos.length === 0) {
    console.log("[fund-local-undeployed] No unregistered UTXOs for dust; skipping dust registration.");
    return undefined;
  }

  console.log(`[fund-local-undeployed] Registering ${utxos.length} UTXO(s) for dust…`);

  const registerForDustTransaction = await walletFacade.dust.createDustGenerationTransaction(
    new Date(),
    ttlIn10min,
    utxos,
    unshieldedPublicKey,
    dustReceiverAddress,
  );

  const intent = registerForDustTransaction.intents?.get(1);
  if (!intent) {
    throw new Error("Dust generation intent not found on transaction");
  }

  const signature = signWithUnshielded(intent.signatureData(1));
  const recipe = await walletFacade.dust.addDustGenerationSignature(registerForDustTransaction, signature);
  const transaction = await walletFacade.finalizeTransaction(recipe);
  const txId = await walletFacade.submitTransaction(transaction);

  const dustBalance = await rx.firstValueFrom(
    walletFacade.state().pipe(
      rx.map((s) => s.dust.balance(new Date())),
      rx.filter((balance) => balance > 0n),
    ),
  );

  console.log("[fund-local-undeployed] Dust registration tx:", txId, "dust balance:", dustBalance.toString());
  return txId;
}

async function main(): Promise<void> {
  process.env.MIDNIGHT_DEPLOY_NETWORK = "undeployed";
  console.log("[fund-local-undeployed] boot…");
  const config = new NuauthMidnightConfig();
  const mnemonic = mnemonicFromEnvOrArgv();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));

  console.log("[fund-local-undeployed] initializing genesis sender wallet…");
  const sender = await initWalletWithSeed(GENESIS_SEED, config);
  await rx.firstValueFrom(sender.wallet.state().pipe(rx.filter((s) => s.isSynced), rx.take(1)));
  console.log("[fund-local-undeployed] genesis sender synced");

  console.log("[fund-local-undeployed] initializing receiver wallet…");
  const receiver = await initWalletWithSeed(seed, config);
  const receiverSynced = await rx.firstValueFrom(
    receiver.wallet.state().pipe(rx.filter((s) => s.isSynced), rx.take(1)),
  );
  console.log("[fund-local-undeployed] receiver synced");

  const shieldedAddressStr = MidnightBech32m.encode("undeployed", receiverSynced.shielded.address)
    .toString();
  const unshieldedAddress = receiver.unshieldedKeystore.getBech32Address().toString();
  const shieldedDecoded = MidnightBech32m.parse(shieldedAddressStr).decode(
    ShieldedAddress,
    "undeployed",
  );
  const unshieldedDecoded = MidnightBech32m.parse(unshieldedAddress).decode(
    UnshieldedAddress,
    "undeployed",
  );

  /** Match Brick Towers `fund.ts`: genesis pays both legs so local balances exist for fees + DUST registration. */
  const outputs: CombinedTokenTransfer[] = [
    {
      type: "unshielded" as const,
      outputs: [
        {
          amount: TRANSFER_AMOUNT,
          receiverAddress: unshieldedDecoded,
          type: ledger.unshieldedToken().raw,
        },
      ],
    },
    {
      type: "shielded" as const,
      outputs: [
        {
          amount: TRANSFER_AMOUNT,
          receiverAddress: shieldedDecoded,
          type: ledger.shieldedToken().raw,
        },
      ],
    },
  ];

  const txHash = await fundFromGenesis(sender, outputs);
  console.log("[fund-local-undeployed] Funding tx submitted:", txHash);

  const receiverState = await rx.firstValueFrom(
    receiver.wallet.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0)),
  );

  console.log(
    "[fund-local-undeployed] Receiver unshielded UTXOs:",
    receiverState.unshielded.availableCoins.length,
  );

  await registerDustGeneration(
    receiver.wallet,
    receiverState.unshielded,
    receiverState.dust.address,
    receiver.unshieldedKeystore.getPublicKey(),
    (payload) => receiver.unshieldedKeystore.signData(payload),
  );

  await receiver.wallet.stop();
  await sender.wallet.stop();
  console.log("[fund-local-undeployed] Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
