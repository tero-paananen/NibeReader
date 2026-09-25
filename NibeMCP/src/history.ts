import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { identity, privateDirectory, type Config } from './config.js';
import { selectMetrics, type Reading } from './metrics.js';

export const databasePath = (c: Config) => join(c.dataDir, 'history.sqlite');
export function openHistory(c: Config, writable = false): DatabaseSync | undefined {
  if (!writable && !existsSync(databasePath(c))) return undefined;
  if (writable) privateDirectory(c.dataDir);
  const db = new DatabaseSync(databasePath(c), { readOnly: !writable });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (writable) db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS readings (
        metric_id TEXT NOT NULL, ts INTEGER NOT NULL, raw_value INTEGER, value REAL,
        unit TEXT NOT NULL, quality TEXT NOT NULL, error TEXT, cadence_ms INTEGER NOT NULL,
        PRIMARY KEY(metric_id, ts)
      );
      CREATE INDEX IF NOT EXISTS readings_time ON readings(ts);
      PRAGMA user_version=1;
    `);
    const stored = db.prepare("SELECT value FROM metadata WHERE key='device'").get() as { value: string } | undefined;
    if (stored && c.host && stored.value !== identity(c)) throw new Error('This data directory belongs to a different pump endpoint. Use its original NIBE_HOST or a separate NIBE_DATA_DIR.');
    if (writable && !stored) db.prepare("INSERT INTO metadata VALUES ('device', ?)").run(identity(c));
    return db;
  } catch (error) { db.close(); throw error; }
}

export function saveReadings(db: DatabaseSync, c: Config, readings: Reading[], now = Date.now()) {
  const insert = db.prepare('INSERT OR REPLACE INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of readings) insert.run(r.metric_id, Date.parse(r.timestamp), r.raw_value, r.value, r.unit, r.quality, r.error ?? null, c.sampleMs);
    db.prepare('DELETE FROM readings WHERE ts < ?').run(now - c.retentionDays * 86400000);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function historyStatus(c: Config) {
  const db = openHistory(c);
  try {
    const row = db?.prepare("SELECT MIN(ts) AS first, MAX(ts) AS last, MAX(CASE WHEN quality='ok' THEN ts END) AS success FROM readings WHERE ts >= ?")
      .get(Date.now() - c.retentionDays * 86400000) as { first: number | null; last: number | null; success: number | null } | undefined;
    const iso = (v: number | null | undefined) => v == null ? null : new Date(v).toISOString();
    return { first_sample: iso(row?.first), last_sample: iso(row?.last), last_successful_sample: iso(row?.success), retention_days: c.retentionDays };
  } finally { db?.close(); }
}

export interface HistoryRequest { metric_ids: string[]; start: string; end: string; interval?: number }
function parseDate(value: string) {
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Dates must be ISO 8601 timestamps with an explicit timezone.');
  return Date.parse(value);
}

export function readHistory(c: Config, request: HistoryRequest) {
  const selected = selectMetrics(request.metric_ids);
  const start = parseDate(request.start), end = parseDate(request.end);
  if (end <= start) throw new Error('end must be later than start');
  if (request.interval !== undefined && (!Number.isSafeInteger(request.interval) || request.interval < 1)) throw new Error('interval must be a positive integer number of seconds');
  const cutoff = Date.now() - c.retentionDays * 86400000;
  const effectiveStart = Math.max(start, cutoff);
  const db = openHistory(c);
  try {
    db?.exec('BEGIN');
    const series = selected.map(metric => {
      const countRow = db?.prepare('SELECT COUNT(*) AS n FROM readings WHERE metric_id=? AND ts>=? AND ts<?').get(metric.id, effectiveStart, end) as { n: number } | undefined;
      const count = countRow?.n ?? 0;
      const width = request.interval !== undefined || count > 1000
        ? Math.max((request.interval ?? 1) * 1000, Math.ceil((end - start) / 1000)) : null;
      const points = !db || !count ? [] : width === null
        ? db.prepare('SELECT ts, raw_value, value, unit, quality, error FROM readings WHERE metric_id=? AND ts>=? AND ts<? ORDER BY ts').all(metric.id, effectiveStart, end)
          .map(r => ({ ...r, timestamp: new Date(Number(r.ts)).toISOString(), ts: undefined }))
        : db.prepare(`SELECT CAST((ts-?)/? AS INTEGER) AS bucket,
            MIN(CASE WHEN quality='ok' THEN value END) AS min,
            AVG(CASE WHEN quality='ok' THEN value END) AS mean,
            MAX(CASE WHEN quality='ok' THEN value END) AS max,
            SUM(quality='ok') AS sample_count, SUM(quality!='ok') AS failed_sample_count
            FROM readings WHERE metric_id=? AND ts>=? AND ts<? GROUP BY bucket ORDER BY bucket`)
          .all(start, width, metric.id, effectiveStart, end).map(r => ({
            ...r, bucket: undefined, timestamp: new Date(start + Number(r.bucket) * width).toISOString(),
            end: new Date(Math.min(end, start + (Number(r.bucket) + 1) * width)).toISOString(),
          }));
      // Successful samples cover one sampling interval, not an indefinitely carried-forward value.
      const gaps = db ? db.prepare(`WITH spans AS (
          SELECT MAX(ts, ?) AS s, MIN(ts+cadence_ms, ?) AS e
          FROM readings WHERE metric_id=? AND quality='ok' AND ts>=? AND ts<? AND ts+cadence_ms>?
        ), ordered AS (
          SELECT s, e, MAX(e) OVER (ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous FROM spans
        ), gaps AS (
          SELECT COALESCE(previous, ?) AS s, s AS e FROM ordered WHERE s>COALESCE(previous, ?)
          UNION ALL SELECT COALESCE(MAX(e), ?), ? FROM spans HAVING COALESCE(MAX(e), ?) < ?
        ) SELECT s,e FROM gaps ORDER BY s LIMIT 1001`)
        .all(start, end, metric.id, cutoff, end, start, start, start, start, end, start, end)
        : [{ s: start, e: end }];
      return {
        metric_id: metric.id, unit: metric.unit, mode: width === null ? 'raw' : 'aggregate',
        interval_seconds: width === null ? null : width / 1000, points,
        gaps: gaps.slice(0, 1000).map(g => ({ start: new Date(Number(g.s)).toISOString(), end: new Date(Number(g.e)).toISOString() })),
        gaps_truncated: gaps.length > 1000,
      };
    });
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), retention_days: c.retentionDays,
      coverage_note: 'Gaps are intervals without a successful sample covering that time. No interpolation or backfill is performed.', series };
  } finally { db?.close(); }
}
