/**
 * Wallet bootstrap for Midnight **undeployed** (local Docker) or **preprod** (public RPC).
 * Preprod URLs align with https://docs.midnight.network/guides/deploy-mn-app
 */
import * as ledger from "@midnight-ntwrk/ledger-v8";
import type { DefaultDustConfiguration as DustConfiguration } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import type { DefaultShieldedConfiguration as ShieldedConfiguration } from "@midnight-ntwrk/wallet-sdk-shielded";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
  type DefaultUnshieldedConfiguration,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { Buffer } from "buffer";
import type { NuauthMidnightConfig } from "./config.js";
import { relayWsUrlFromHttpOrigin } from "./midnight_network.js";

export type WalletContext = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

export async function initWalletWithSeed(
  seed: Buffer,
  midnight: NuauthMidnightConfig,
): Promise<WalletContext> {
  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seed));

  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive keys");
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    midnight.networkId,
  );

  const baseConfiguration: ShieldedConfiguration & DustConfiguration = {
    networkId: midnight.networkId,
    costParameters: {
      additionalFeeOverhead: midnight.shieldedAdditionalFeeOverhead,
      feeBlocksMargin: 5,
    },
    indexerClientConnection: {
      indexerHttpUrl: midnight.indexer,
      indexerWsUrl: midnight.indexerWS,
    },
  };

  const shieldedWallet = ShieldedWallet(baseConfiguration).startWithSecretKeys(shieldedSecretKeys);
  const dustWallet = DustWallet({
    ...baseConfiguration,
    costParameters: {
      additionalFeeOverhead: midnight.dustAdditionalFeeOverhead,
      feeBlocksMargin: 5,
    },
  }).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedConfiguration: DefaultUnshieldedConfiguration = {
    ...baseConfiguration,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };
  const unshieldedWallet = UnshieldedWallet(unshieldedConfiguration).startWithPublicKey(
    UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
  );

  const relayURL = relayWsUrlFromHttpOrigin(midnight.relayHttpOrigin);
  const provingServerUrl = new URL(midnight.proofServer);

  const facade: WalletFacade = await WalletFacade.init({
    configuration: {
      ...baseConfiguration,
      relayURL,
      provingServerUrl,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    },
    shielded: async () => shieldedWallet,
    unshielded: async () => unshieldedWallet,
    dust: async () => dustWallet,
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}
