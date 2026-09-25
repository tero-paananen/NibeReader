import {
  buildHealthReport,
  healthOptions,
  type HealthRequest,
} from './health.js';
import {
  summarizeOperation,
  analyzeTemperatureDelta,
  comparePeriods,
} from './analysis.js';
import {recordEvent, listEvents} from './events.js';
import {spawn} from 'node:child_process';
import {closeSync, existsSync, openSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {
  identity,
  privateDirectory,
  requireHost,
  type Config,
} from './config.js';
import {collectorStatus, rpc, type CollectorStatus} from './ipc.js';
import {acquireLock} from './lock.js';
import {historyStatus, readHistory, type HistoryRequest} from './history.js';
import {readPump} from './modbus.js';
import {
  metrics,
  healthMetricIds,
  selectMetrics,
  type Reading,
} from './metrics.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function checkIdentity(c: Config, status: CollectorStatus) {
  if (c.host && status.device !== identity(c))
    throw new Error(
      'Collector is configured for a different pump. Use a separate NIBE_DATA_DIR.'
    );
}

export class NibeService {
  constructor(readonly config: Config) {}
  listMetrics() {
    return {
      metrics: metrics.map(m => ({
        ...m,
        register_type: 'input',
        validation: 'requires_comparison_with_pump_display',
      })),
      note: 'These definitions come from NibeReader. Successful reads alone do not establish physical validation. Requested frequency is not measured; actual_compressor_frequency is a separate reading.',
    };
  }
  async status() {
    const collector = await collectorStatus(this.config);
    if (collector) checkIdentity(this.config, collector);
    return {
      collection: collector ?? {running: false},
      history: historyStatus(this.config),
      missing_collector_metrics: collector
        ? metrics
            .filter(
              m =>
                !(
                  collector.metric_ids ?? metrics.slice(0, 8).map(m => m.id)
                ).includes(m.id)
            )
            .map(m => m.id)
        : [],
      configured: Boolean(this.config.host),
      sample_seconds: this.config.sampleMs / 1000,
      note: 'No collector is started by this operation. Connectivity reflects the last collector poll, not a new probe.',
    };
  }
  async live(ids?: string[]) {
    const selected = selectMetrics(ids);
    const collector = await collectorStatus(this.config);
    if (collector) {
      checkIdentity(this.config, collector);
      const supported =
        collector.metric_ids ?? metrics.slice(0, 8).map(m => m.id);
      const available = selected
        .filter(m => supported.includes(m.id))
        .map(m => m.id);
      const rows = available.length
        ? await rpc<Reading[]>(this.config, 'live', available)
        : [];
      return {
        source: 'collector',
        readings: selected.map(
          m =>
            rows.find(r => r.metric_id === m.id) ?? {
              metric_id: m.id,
              timestamp: new Date().toISOString(),
              raw_value: null,
              value: null,
              unit: m.unit,
              quality: 'unavailable' as const,
              error:
                'Collector lacks this metric. Explicitly stop and restart collection to load the new profile.',
            }
        ),
      };
    }
    return {
      source: 'temporary_connection',
      readings: await readPump(this.config, ids),
    };
  }
  async checkDeviceHealth(request: HealthRequest = {}) {
    const now = Date.now();
    const options = healthOptions(request, now);
    const normalized = {
      ...request,
      start: new Date(options.start).toISOString(),
      end: new Date(options.end).toISOString(),
    };
    let readings: Reading[];
    try {
      readings = (await this.live(healthMetricIds)).readings;
    } catch (error) {
      readings = healthMetricIds.map(id => ({
        metric_id: id,
        timestamp: new Date().toISOString(),
        raw_value: null,
        value: null,
        unit: metrics.find(m => m.id === id)!.unit,
        quality: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return buildHealthReport(this.config, normalized, readings, Date.now());
  }
  history(request: HistoryRequest) {
    return readHistory(this.config, request);
  }
  summarizeOperation(request: Parameters<typeof summarizeOperation>[1]) {
    return summarizeOperation(this.config, request);
  }
  analyzeTemperatureDelta(
    request: Parameters<typeof analyzeTemperatureDelta>[1]
  ) {
    return analyzeTemperatureDelta(this.config, request);
  }
  comparePeriods(request: Parameters<typeof comparePeriods>[1]) {
    return comparePeriods(this.config, request);
  }
  recordEvent(request: Parameters<typeof recordEvent>[1]) {
    return recordEvent(this.config, request);
  }
  listEvents(request: Parameters<typeof listEvents>[1]) {
    return listEvents(this.config, request);
  }
  async start() {
    const c = this.config;
    requireHost(c);
    const release = await acquireLock(c, 'lifecycle', 95000);
    try {
      const existing = await collectorStatus(c);
      if (existing) {
        checkIdentity(c, existing);
        return {already_running: true, collection: existing};
      }
      privateDirectory(c.dataDir);
      const log = openSync(join(c.dataDir, 'collector.log'), 'a', 0o600);
      let spawnError: Error | undefined,
        exited = false;
      try {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL('./collector.js', import.meta.url))],
          {
            detached: true,
            stdio: ['ignore', 'ignore', log],
            env: {
              ...process.env,
              NIBE_HOST: c.host,
              NIBE_PORT: String(c.port),
              NIBE_UNIT_ID: String(c.unitId),
              NIBE_DATA_DIR: c.dataDir,
              NIBE_SAMPLE_SECONDS: String(c.sampleMs / 1000),
              NIBE_RETENTION_DAYS: String(c.retentionDays),
            },
          }
        );
        child.on('error', error => {
          spawnError = error;
        });
        child.on('exit', () => {
          exited = true;
        });
        child.unref();
      } finally {
        closeSync(log);
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        const current = await collectorStatus(c);
        if (current) {
          checkIdentity(c, current);
          return {already_running: false, collection: current};
        }
        if (exited)
          throw new Error(
            `Collector exited during startup. See ${join(
              c.dataDir,
              'collector.log'
            )}`
          );
        await pause(100);
      }
      throw new Error(
        'Collector startup was not confirmed. Check get_status before retrying.'
      );
    } finally {
      release();
    }
  }
  async stop() {
    const c = this.config;
    // If nothing has ever run, do not create a data directory just to report stopped.
    if (!existsSync(c.dataDir)) return {running: false, already_stopped: true};
    const release = await acquireLock(c, 'lifecycle', 95000);
    try {
      const current = await collectorStatus(c);
      if (!current) {
        const confirmStopped = await acquireLock(c, 'collector', 95000);
        confirmStopped();
        return {running: false, already_stopped: true};
      }
      checkIdentity(c, current);
      await rpc(c, 'stop');
      const deadline = Date.now() + 95000;
      while (Date.now() < deadline) {
        if (!(await collectorStatus(c))) {
          const confirmStopped = await acquireLock(c, 'collector', 95000);
          confirmStopped();
          return {running: false, already_stopped: false};
        }
        await pause(100);
      }
      throw new Error(
        'Collector has not finished stopping. Check get_status; no force-kill was performed.'
      );
    } finally {
      release();
    }
  }
}
