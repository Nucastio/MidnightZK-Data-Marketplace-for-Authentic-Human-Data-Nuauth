/**
 * Deploy `nuauth-stamp`, run ZK circuits: `proveCreatorStamp`, `bindL1Stamp`.
 *
 * Env: `MIDNIGHT_DEPLOY_NETWORK` (`undeployed` | `preprod`), `BIP39_MNEMONIC`,
 * `NUAUTH_CREATOR_SK_HEX`, `NUAUTH_CONTENT_COMMITMENT_HEX`,
 * optional `NUAUTH_L1_ANCHOR_HEX` (32-byte hex binding Cardano stamp / metadata digest).
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { nuauthStampPrivateStateId } from '@nuauth/midnight-contract';
import { nuauthStampCompiledContractLocal } from './nuauth-compiled-contract.js';
import { NuauthMidnightConfig } from './config.js';
import { configureNuauthStampProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { creatorLedgerPublicKey } from './creator-key.js';
import { ensureDustReady } from './dust.js';

(globalThis as any).WebSocket = WebSocket;

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
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });
  console.log('DUST ready.');

  const creatorSk = hexToBytes32(process.env.NUAUTH_CREATOR_SK_HEX ?? '03'.repeat(32));
  const creatorPk = creatorLedgerPublicKey(creatorSk);
  const commitment = hexToBytes32(process.env.NUAUTH_CONTENT_COMMITMENT_HEX ?? '00'.repeat(32));
  const l1Anchor = hexToBytes32(process.env.NUAUTH_L1_ANCHOR_HEX ?? 'aa'.repeat(32));

  const providers = await configureNuauthStampProviders(walletCtx, config);

  console.log('Deploying nuauth-stamp…');
  const deployed = await deployContract(providers, {
    compiledContract: nuauthStampCompiledContractLocal,
    privateStateId: nuauthStampPrivateStateId,
    initialPrivateState: {
      creatorSecretKey: new Uint8Array(creatorSk),
    },
    args: [new Uint8Array(commitment), new Uint8Array(creatorPk)],
  });

  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;

  logTx('proveCreatorStamp (ZK)', (await callTx.proveCreatorStamp()).public);
  logTx('bindL1Stamp (ZK + L1 anchor)', (await callTx.bindL1Stamp(new Uint8Array(l1Anchor))).public);

  console.log('Done. All NuAuth ZK stamp circuits submitted.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
