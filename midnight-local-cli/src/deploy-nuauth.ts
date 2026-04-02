/**
 * Deploy `nuauth-stamp` to Midnight (**undeployed** local Docker or **preprod** public RPC).
 *
 * Env:
 * - `MIDNIGHT_DEPLOY_NETWORK` – `undeployed` (default) or `preprod`.
 * - `BIP39_MNEMONIC` – funded on the selected Midnight network (local fund vs [Preprod faucet](https://faucet.preprod.midnight.network/)).
 * - `NUAUTH_CREATOR_SK_HEX` – 64 hex chars (32 bytes) private seed for ZK creator proofs.
 * - `NUAUTH_CONTENT_COMMITMENT_HEX` – 64 hex chars; defaults to `00…`.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { nuauthStampPrivateStateId, NuauthStamp } from '@nuauth/midnight-contract';
import { nuauthStampCompiledContractLocal } from './nuauth-compiled-contract.js';
import { NuauthMidnightConfig } from './config.js';
import { configureNuauthStampProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { creatorLedgerPublicKey } from './creator-key.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC (fund via midnight-local-network)');
    process.exit(1);
  }

  const config = new NuauthMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  const creatorSk = hexToBytes32(process.env.NUAUTH_CREATOR_SK_HEX ?? '03'.repeat(32));
  const creatorPk = creatorLedgerPublicKey(creatorSk);
  const commitment = hexToBytes32(process.env.NUAUTH_CONTENT_COMMITMENT_HEX ?? '00'.repeat(32));

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

  const pub = deployed.deployTxData.public;
  console.log('Deployed nuauth-stamp at:', pub.contractAddress);

  if (!('initialContractState' in pub) || !pub.initialContractState) {
    throw new Error('deploy result missing initialContractState');
  }
  try {
    const ledger = NuauthStamp.ledger(pub.initialContractState.data);
    const cc = ledger.contentCommitment as unknown;
    const hexPrefix = Buffer.from(cc as Uint8Array).toString('hex').slice(0, 16);
    console.log('Ledger snapshot: contentCommitment (hex prefix)=', hexPrefix, '…');
  } catch {
    console.log('Deployed; ledger parse skipped (check generated contract typings).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
