export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v?.trim() || undefined;
}
