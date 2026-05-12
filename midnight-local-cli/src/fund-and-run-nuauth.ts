/**
 * Combined: fund wallet from genesis + deploy + prove + bind — single wallet init.
 * Eliminates double-init overhead of running fund + run-all separately.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { nuauthStampPrivateStateId } from '@nuauth/midnight-contract';
import { nuauthStampCompiledContractLocal } from './nuauth-compiled-contract.js';
import { NuauthMidnightConfig } from './config.js';
import { configureNuauthStampProviders } from './providers.js';
import { initWalletWithSeed, type WalletContext } from './wallet.js';
import { creatorLedgerPublicKey } from './creator-key.js';
import {
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import type { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';

(globalThis as any).WebSocket = WebSocket;

const GENESIS_SEED = Buffer.from(
  '0000000000000000000000000000000000000000000000000000000000000001',
  'hex',
);
const TRANSFER_AMOUNT = 31_337_000_000n;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function logTx(label: string, pub: { txId: unknown; txHash: unknown; blockHeight?: unknown }) {
  const bh = pub.blockHeight !== undefined ? ` blockHeight=${pub.blockHeight}` : '';
  console.log(`${label}: txId=${String(pub.txId)} txHash=${String(pub.txHash)}${bh}`);
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }

  const config = new NuauthMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));

  // ── Step 1: Init genesis wallet and fund receiver ──
  console.log('Initializing genesis sender wallet…');
  const sender = await initWalletWithSeed(GENESIS_SEED, config);
  await Rx.firstValueFrom(sender.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Genesis synced.');

  console.log('Initializing receiver wallet…');
  const receiver = await initWalletWithSeed(seed, config);
  const receiverState = await Rx.firstValueFrom(
    receiver.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  console.log('Receiver synced.');

  const shieldedAddr = MidnightBech32m.encode('undeployed', receiverState.shielded.address).toString();
  const unshieldedAddr = receiver.unshieldedKeystore.getBech32Address().toString();
  const shieldedDecoded = MidnightBech32m.parse(shieldedAddr).decode(ShieldedAddress, 'undeployed');
  const unshieldedDecoded = MidnightBech32m.parse(unshieldedAddr).decode(UnshieldedAddress, 'undeployed');

  const outputs: CombinedTokenTransfer[] = [
    { type: 'unshielded', outputs: [{ amount: TRANSFER_AMOUNT, receiverAddress: unshieldedDecoded, type: ledger.unshieldedToken().raw }] },
    { type: 'shielded', outputs: [{ amount: TRANSFER_AMOUNT, receiverAddress: shieldedDecoded, type: ledger.shieldedToken().raw }] },
  ];

  console.log('Funding receiver from genesis…');
  const recipe = await sender.wallet.transferTransaction(
    outputs,
    { shieldedSecretKeys: sender.shieldedSecretKeys, dustSecretKey: sender.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: true },
  );
  const signedTx = await sender.wallet.signUnprovenTransaction(
    recipe.transaction,
    (payload) => sender.unshieldedKeystore.signData(payload),
  );
  const finalizedFund = await sender.wallet.finalizeTransaction(signedTx);
  const fundTxId = await sender.wallet.submitTransaction(finalizedFund);
  console.log('Fund tx submitted:', fundTxId);

  // Wait for receiver to see funds
  await Rx.firstValueFrom(
    receiver.wallet.state().pipe(Rx.filter((s) => s.unshielded.availableCoins.length > 0)),
  );
  console.log('Receiver funded.');

  // Register DUST
  await receiver.wallet.dust.waitForSyncedState();
  const rState = await Rx.firstValueFrom(receiver.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unregistered = rState.unshielded.availableCoins
    .filter((c) => !c.meta.registeredForDustGeneration)
    .map((c) => ({ ...c.utxo, ctime: new Date(c.meta.ctime), registeredForDustGeneration: c.meta.registeredForDustGeneration }));

  if (unregistered.length > 0) {
    console.log(`Registering ${unregistered.length} UTXO(s) for DUST…`);
    const ttl = new Date(Date.now() + 10 * 60 * 1000);
    const registerTx = await receiver.wallet.dust.createDustGenerationTransaction(
      new Date(), ttl, unregistered,
      receiver.unshieldedKeystore.getPublicKey(), rState.dust.address,
    );
    const intent = registerTx.intents?.get(1);
    if (!intent) throw new Error('Dust generation intent not found');
    const sig = receiver.unshieldedKeystore.signData(intent.signatureData(1));
    const dustRecipe = await receiver.wallet.dust.addDustGenerationSignature(registerTx, sig);
    const dustFinalized = await receiver.wallet.finalizeTransaction(dustRecipe);
    const dustTxId = await receiver.wallet.submitTransaction(dustFinalized);
    console.log('DUST registration tx:', String(dustTxId));
    await Rx.firstValueFrom(
      receiver.wallet.state().pipe(Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n)),
    );
  }
  console.log('DUST ready.');

  // Stop sender — no longer needed
  await sender.wallet.stop();

  // ── Step 2: Deploy + prove + bind (reuse receiver wallet) ──
  const creatorSk = hexToBytes32(process.env.NUAUTH_CREATOR_SK_HEX ?? '03'.repeat(32));
  const creatorPk = creatorLedgerPublicKey(creatorSk);
  const commitment = hexToBytes32(process.env.NUAUTH_CONTENT_COMMITMENT_HEX ?? '00'.repeat(32));
  const l1Anchor = hexToBytes32(process.env.NUAUTH_L1_ANCHOR_HEX ?? 'aa'.repeat(32));

  const providers = await configureNuauthStampProviders(receiver, config);

  console.log('Deploying nuauth-stamp…');
  const deployed = await deployContract(providers, {
    compiledContract: nuauthStampCompiledContractLocal,
    privateStateId: nuauthStampPrivateStateId,
    initialPrivateState: { creatorSecretKey: new Uint8Array(creatorSk) },
    args: [new Uint8Array(commitment), new Uint8Array(creatorPk)],
  });

  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;
  logTx('proveCreatorStamp (ZK)', (await callTx.proveCreatorStamp()).public);
  logTx('bindL1Stamp (ZK + L1 anchor)', (await callTx.bindL1Stamp(new Uint8Array(l1Anchor))).public);

  console.log('Done. All NuAuth ZK stamp circuits submitted.');
  await receiver.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
