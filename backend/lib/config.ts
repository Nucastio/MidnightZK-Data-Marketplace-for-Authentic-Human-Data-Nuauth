import { fromHex } from "./hex.ts";
import { requireEnv, optionalEnv } from "./env.ts";

export { optionalEnv, requireEnv };

/** `emulator` = in-process Lucid `Emulator` (no Blockfrost). `blockfrost` = Preprod/Mainnet via Blockfrost. */
export function cardanoBackend(): "blockfrost" | "emulator" {
  const raw = (
    optionalEnv("CARDANO_BACKEND") ||
    optionalEnv("NUAUTH_CARDANO_BACKEND") ||
    "blockfrost"
  ).toLowerCase();
  if (raw === "emulator" || raw === "local") return "emulator";
  return "blockfrost";
}

function blockfrostProjectId(): string {
  const id = optionalEnv("BLOCKFROST_PROJECT_ID") ||
    optionalEnv("BLOCKFROST_API_KEY");
  if (!id) {
    throw new Error(
      "Set BLOCKFROST_PROJECT_ID (or alias BLOCKFROST_API_KEY) for Blockfrost",
    );
  }
  return id;
}

export function blockfrostConfig() {
  if (cardanoBackend() === "emulator") {
    throw new Error("blockfrostConfig() is not used when CARDANO_BACKEND=emulator");
  }
  return {
    url: optionalEnv("BLOCKFROST_URL") ||
      "https://cardano-preprod.blockfrost.io/api/v0",
    projectId: blockfrostProjectId(),
    network: (optionalEnv("CARDANO_NETWORK") || "Preprod") as
      | "Preprod"
      | "Mainnet"
      | "Preview",
  };
}

/** 32-byte master secret for prototype policy-based wrapping (hex). */
export function abeMasterKey(): Uint8Array {
  const hex = requireEnv("ABE_MASTER_KEY_HEX");
  const clean = hex.replace(/^0x/i, "");
  if (clean.length !== 64) {
    throw new Error("ABE_MASTER_KEY_HEX must be 64 hex chars (32 bytes)");
  }
  return fromHex(clean);
}

/** Dataset registration + stamping + receives license payments (seller). */
export function creatorMnemonic(): string {
  return optionalEnv("CREATOR_WALLET_MNEMONIC") ||
    optionalEnv("SELLER_WALLET_MNEMONIC") ||
    requireEnv("WALLET_MNEMONIC");
}

/** License payment + decrypt (buyer / AI developer). */
export function buyerMnemonic(): string {
  return optionalEnv("BUYER_WALLET_MNEMONIC") || requireEnv("WALLET_MNEMONIC");
}

export function dataDir(): string {
  return optionalEnv("NUAUTH_DATA_DIR") || "data";
}
