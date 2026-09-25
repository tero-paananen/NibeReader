import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';

export interface Config {
  host: string; port: number; unitId: number; dataDir: string;
  socketPath: string; sampleMs: number; retentionDays: number; timeoutMs: number;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  return value;
}

export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.NIBE_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'NibeMCP'));
  // macOS Unix socket paths must be short; use a private, stable per-user directory.
  const hash = createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
  const socketPath = `/tmp/nibe-mcp-${process.getuid?.() ?? 'user'}-${hash}/collector.sock`;
  return {
    host: env.NIBE_HOST?.trim() ?? '',
    port: integer(env, 'NIBE_PORT', 502, 1, 65535),
    unitId: integer(env, 'NIBE_UNIT_ID', 1, 0, 255),
    dataDir, socketPath,
    sampleMs: integer(env, 'NIBE_SAMPLE_SECONDS', 60, 1, 86400) * 1000,
    retentionDays: integer(env, 'NIBE_RETENTION_DAYS', 365, 1, 3650),
    timeoutMs: 5000,
  };
}

export function requireHost(c: Config) {
  if (!c.host) throw new Error('Set NIBE_HOST to the heat pump IP address or hostname before reading or starting collection.');
}

export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`Expected a directory owned by this user: ${path}`);
  }
  chmodSync(path, 0o700);
}

export function identity(c: Config) { return `${c.host}:${c.port}/${c.unitId}`; }
