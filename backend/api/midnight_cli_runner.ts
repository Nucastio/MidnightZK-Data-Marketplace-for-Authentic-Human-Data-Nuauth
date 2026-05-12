/**
 * Spawn `midnight-local-cli` `npm run run-all` and parse deploy / prove / bind hashes.
 * Opt-in via `NUAUTH_SERVER_MIDNIGHT_CLI=1` (server holds mnemonics; do not expose this API publicly).
 */
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { optionalEnv } from "../lib/env.ts";

export function serverMidnightCliEnabled(): boolean {
  const v = optionalEnv("NUAUTH_SERVER_MIDNIGHT_CLI")?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function randomHex32(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function parseMidnightRunAllLog(log: string): {
  contractAddress: string;
  deployTxHash: string;
  proveCreatorStampTxHash: string;
  bindL1StampTxHash: string;
} | null {
  const contract = [...log.matchAll(/Contract address:\s*(\S+)/g)].pop()?.[1]?.trim() ?? "";
  const deploy = log.match(/^deploy:[^\n]*\btxHash=([0-9a-fA-F]{64})/m)?.[1] ?? "";
  const prove = log.match(
    /proveCreatorStamp[^\n]*\btxHash=([0-9a-fA-F]{64})/,
  )?.[1] ?? "";
  const bind = log.match(/bindL1Stamp[^\n]*\btxHash=([0-9a-fA-F]{64})/)?.[1] ?? "";
  if (!contract || !prove || !bind) return null;
  return {
    contractAddress: contract,
    deployTxHash: deploy,
    proveCreatorStampTxHash: prove,
    bindL1StampTxHash: bind,
  };
}

export async function runMidnightRunAll(opts: {
  repoRoot: string;
  commitmentHex: string;
  l1AnchorHex: string;
  /** 32-byte hex; random if unset */
  creatorSkHex?: string;
}): Promise<{ log: string; parsed: NonNullable<ReturnType<typeof parseMidnightRunAllLog>> }> {
  const cliDir = join(opts.repoRoot, "midnight-local-cli");
  const creatorSk = opts.creatorSkHex?.length === 64
    ? opts.creatorSkHex
    : randomHex32();

  const env: Record<string, string> = { ...Deno.env.toObject() };
  env.NUAUTH_CONTENT_COMMITMENT_HEX = opts.commitmentHex;
  env.NUAUTH_L1_ANCHOR_HEX = opts.l1AnchorHex;
  env.NUAUTH_CREATOR_SK_HEX = creatorSk;
  if (!env.MIDNIGHT_DEPLOY_NETWORK?.trim()) {
    env.MIDNIGHT_DEPLOY_NETWORK = "undeployed";
  }

  const isUndeployed = (env.MIDNIGHT_DEPLOY_NETWORK || "undeployed") === "undeployed";
  const script = isUndeployed ? "fund-and-run" : "run-all";

  const out = await new Deno.Command("npm", {
    args: ["run", script],
    cwd: cliDir,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const dec = new TextDecoder();
  const log = `${dec.decode(out.stdout)}\n${dec.decode(out.stderr)}`;
  if (!out.success) {
    throw new Error(
      `npm run run-all exited code ${out.code}\n${log.slice(-8000)}`,
    );
  }
  const parsed = parseMidnightRunAllLog(log);
  if (!parsed) {
    throw new Error(
      `Could not parse Midnight CLI output (missing contract or tx hashes).\n${log.slice(-8000)}`,
    );
  }
  return { log, parsed };
}
