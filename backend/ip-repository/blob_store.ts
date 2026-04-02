import { dataDir } from "../lib/config.ts";

export function blobPath(relative: string): string {
  return `${dataDir()}/${relative}`;
}

export async function writeBlob(relative: string, bytes: Uint8Array): Promise<void> {
  const path = blobPath(relative);
  const last = path.lastIndexOf("/");
  if (last >= 0) {
    await Deno.mkdir(path.slice(0, last), { recursive: true });
  }
  await Deno.writeFile(path, bytes);
}

export async function readBlob(relative: string): Promise<Uint8Array> {
  return await Deno.readFile(blobPath(relative));
}
