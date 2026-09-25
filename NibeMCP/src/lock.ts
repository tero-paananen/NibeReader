import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { privateDirectory, type Config } from './config.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// A separate rollback-journal database supplies an OS-backed, process-lifetime lock.
// No stale heartbeat expiry: sleep preserves ownership; exit/crash/reboot releases it.
export async function acquireLock(c: Config, name: string, waitMs = 0): Promise<() => void> {
  privateDirectory(c.dataDir);
  const db = new DatabaseSync(join(c.dataDir, `${name}-lock.sqlite`));
  db.exec('PRAGMA busy_timeout=0');
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      db.exec('BEGIN EXCLUSIVE');
      return () => { db.exec('ROLLBACK'); db.close(); };
    } catch (error) {
      if (!(error instanceof Error) || !/locked|busy/i.test(error.message) || Date.now() >= deadline) {
        db.close();
        throw new Error(`Cannot acquire ${name} lock: ${String(error)}`);
      }
      await pause(50);
    }
  }
}
