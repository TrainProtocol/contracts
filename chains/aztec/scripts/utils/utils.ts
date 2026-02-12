export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function stringToBytes(str: string, length: number): number[] {
  const padded = str.padStart(length, ' ');
  return Array.from(Buffer.from(padded, 'utf8')).slice(0, length);
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

import fs from 'fs';

export function updateEnvFile(
  envPath: string,
  entries: Record<string, string>,
): void {
  const existing = (() => {
    try {
      return fs.readFileSync(envPath, 'utf8');
    } catch {
      return '';
    }
  })();

  const lines = existing.split('\n').filter((l: string) => l.length > 0);
  const map = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) map.set(key, value);
  }

  for (const [k, v] of Object.entries(entries)) {
    map.set(k, v);
  }

  const next = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  fs.writeFileSync(envPath, next + '\n');
}
