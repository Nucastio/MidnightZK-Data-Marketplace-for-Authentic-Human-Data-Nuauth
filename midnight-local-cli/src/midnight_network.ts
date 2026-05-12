/**
 * Midnight layer targets: local Brick Towers stack vs public **Preview** / **Preprod**.
 *
 * Preprod RPC / indexer / proof server URLs match the official matrix:
 * https://docs.midnight.network/relnotes/overview
 *
 * Deploy guide (setNetworkId, indexer v3, relay wss):
 * https://docs.midnight.network/guides/deploy-mn-app
 */

export type MidnightDeployNetwork = "undeployed" | "preview" | "preprod";

export type MidnightNetworkEndpoints = {
  networkId: MidnightDeployNetwork;
  indexerHttp: string;
  indexerWs: string;
  /** e.g. https://rpc.preprod.midnight.network → relay uses wss:// */
  relayHttpOrigin: string;
  proofServer: string;
  dustAdditionalFeeOverhead: bigint;
  shieldedAdditionalFeeOverhead: bigint;
};

export function resolveMidnightDeployNetwork(): MidnightDeployNetwork {
  const v = (process.env.MIDNIGHT_DEPLOY_NETWORK || "undeployed").toLowerCase().trim();
  if (v === "preprod") return "preprod";
  if (v === "preview") return "preview";
  if (v === "undeployed" || v === "local") return "undeployed";
  throw new Error(
    `MIDNIGHT_DEPLOY_NETWORK must be 'undeployed', 'preview', or 'preprod' (got: ${v})`,
  );
}

export function getMidnightEndpoints(net: MidnightDeployNetwork): MidnightNetworkEndpoints {
  if (net === "undeployed") {
    const indexerPort = Number.parseInt(process.env.INDEXER_PORT ?? "8088", 10);
    const nodePort = Number.parseInt(process.env.NODE_PORT ?? "9944", 10);
    const proofPort = Number.parseInt(process.env.PROOF_SERVER_PORT ?? "6300", 10);
    // Local `yarn fund` DUST balances are far smaller than public testnets; use the same
    // scale as Preview/Preprod here (see preview `overhead` below), not 1e3 larger.
    const overhead = 300_000_000_000_000n;
    return {
      networkId: "undeployed",
      indexerHttp: `http://127.0.0.1:${indexerPort}/api/v4/graphql`,
      indexerWs: `ws://127.0.0.1:${indexerPort}/api/v4/graphql/ws`,
      relayHttpOrigin: `http://127.0.0.1:${nodePort}`,
      proofServer: process.env.MIDNIGHT_PROOF_SERVER ||
        `http://127.0.0.1:${proofPort}`,
      dustAdditionalFeeOverhead: overhead,
      shieldedAdditionalFeeOverhead: overhead,
    };
  }

  const overhead = 300_000_000_000_000n;
  if (net === "preview") {
    return {
      networkId: "preview",
      indexerHttp: process.env.MIDNIGHT_INDEXER_HTTP ||
        "https://indexer.preview.midnight.network/api/v3/graphql",
      indexerWs: process.env.MIDNIGHT_INDEXER_WS ||
        "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
      relayHttpOrigin: process.env.MIDNIGHT_NODE_RPC ||
        "https://rpc.preview.midnight.network",
      proofServer: process.env.MIDNIGHT_PROOF_SERVER ||
        "https://lace-proof-pub.preview.midnight.network",
      dustAdditionalFeeOverhead: overhead,
      shieldedAdditionalFeeOverhead: overhead,
    };
  }

  return {
    networkId: "preprod",
    indexerHttp: process.env.MIDNIGHT_INDEXER_HTTP ||
      "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWs: process.env.MIDNIGHT_INDEXER_WS ||
      "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    relayHttpOrigin: process.env.MIDNIGHT_NODE_RPC ||
      "https://rpc.preprod.midnight.network",
    proofServer: process.env.MIDNIGHT_PROOF_SERVER ||
      "https://lace-proof-pub.preprod.midnight.network",
    dustAdditionalFeeOverhead: overhead,
    shieldedAdditionalFeeOverhead: overhead,
  };
}

/** Node relay WebSocket URL (WalletFacade). */
export function relayWsUrlFromHttpOrigin(relayHttpOrigin: string): URL {
  const u = relayHttpOrigin.replace(/^http/i, (m) =>
    m.toLowerCase() === "https" ? "wss" : "ws"
  );
  return new URL(u);
}
