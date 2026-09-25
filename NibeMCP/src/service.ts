import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { identity, privateDirectory, requireHost, type Config } from './config.js';
import { collectorStatus, rpc, type CollectorStatus } from './ipc.js';
import { acquireLock } from './lock.js';
import { historyStatus, readHistory, type HistoryRequest } from './history.js';
import { readPump } from './modbus.js';
import { metrics, selectMetrics, type Reading } from './metrics.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function checkIdentity(c: Config, status: CollectorStatus) {
  if (c.host && status.device !== identity(c)) throw new Error('Collector is configured for a different pump. Use a separate NIBE_DATA_DIR.');
}

export class NibeService {
  constructor(readonly config: Config) {}
  listMetrics() {
    return { metrics: metrics.map(m => ({ ...m, register_type: 'input', validation: 'requires_comparison_with_pump_display' })),
      note: 'These definitions come from NibeReader. Successful reads alone do not establish physical validation. Frequency is requested, not measured.' };
  }
  async status() {
    const collector = await collectorStatus(this.config);
    if (collector) checkIdentity(this.config, collector);
    return { collection: collector ?? { running: false }, history: historyStatus(this.config),
      configured: Boolean(this.config.host), sample_seconds: this.config.sampleMs / 1000,
      note: 'No collector is started by this operation. Connectivity reflects the last collector poll, not a new probe.' };
  }
  async live(ids?: string[]) {
    selectMetrics(ids);
    const collector = await collectorStatus(this.config);
    if (collector) {
      checkIdentity(this.config, collector);
      return { source: 'collector', readings: await rpc<Reading[]>(this.config, 'live', ids) };
    }
    return { source: 'temporary_connection', readings: await readPump(this.config, ids) };
  }
  history(request: HistoryRequest) { return readHistory(this.config, request); }
  async start() {
    const c = this.config;
    requireHost(c);
    const release = await acquireLock(c, 'lifecycle', 95000);
    try {
      const existing = await collectorStatus(c);
      if (existing) { checkIdentity(c, existing); return { already_running: true, collection: existing }; }
      privateDirectory(c.dataDir);
      const log = openSync(join(c.dataDir, 'collector.log'), 'a', 0o600);
      let spawnError: Error | undefined, exited = false;
      try {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./collector.js', import.meta.url))], {
          detached: true, stdio: ['ignore', 'ignore', log],
          env: { ...process.env, NIBE_HOST: c.host, NIBE_PORT: String(c.port), NIBE_UNIT_ID: String(c.unitId),
            NIBE_DATA_DIR: c.dataDir, NIBE_SAMPLE_SECONDS: String(c.sampleMs / 1000), NIBE_RETENTION_DAYS: String(c.retentionDays) },
        });
        child.on('error', error => { spawnError = error; });
        child.on('exit', () => { exited = true; });
        child.unref();
      } finally { closeSync(log); }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        const current = await collectorStatus(c);
        if (current) { checkIdentity(c, current); return { already_running: false, collection: current }; }
        if (exited) throw new Error(`Collector exited during startup. See ${join(c.dataDir, 'collector.log')}`);
        await pause(100);
      }
      throw new Error('Collector startup was not confirmed. Check get_status before retrying.');
    } finally { release(); }
  }
  async stop() {
    const c = this.config;
    // If nothing has ever run, do not create a data directory just to report stopped.
    if (!existsSync(c.dataDir)) return { running: false, already_stopped: true };
    const release = await acquireLock(c, 'lifecycle', 95000);
    try {
      const current = await collectorStatus(c);
      if (!current) {
        const confirmStopped = await acquireLock(c, 'collector', 95000);
        confirmStopped();
        return { running: false, already_stopped: true };
      }
      checkIdentity(c, current);
      await rpc(c, 'stop');
      const deadline = Date.now() + 95000;
      while (Date.now() < deadline) {
        if (!await collectorStatus(c)) {
          const confirmStopped = await acquireLock(c, 'collector', 95000);
          confirmStopped();
          return { running: false, already_stopped: false };
        }
        await pause(100);
      }
      throw new Error('Collector has not finished stopping. Check get_status; no force-kill was performed.');
    } finally { release(); }
  }
}
