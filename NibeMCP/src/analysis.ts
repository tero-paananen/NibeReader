import {type Config} from './config.js';
import {openHistory, parseDate} from './history.js';
import {selectMetrics} from './metrics.js';

export interface Period { start: string; end: string }
export interface AnalysisRequest extends Period { metric_ids?: string[] }
type Sample = {ts: number; value: number | null; quality: string; cadence_ms: number};
export function period(p: Period) {
  const start = parseDate(p.start), end = parseDate(p.end);
  if (end <= start) throw new Error('end must be later than start');
  return {start, end};
}
const iso = (ts: number) => new Date(ts).toISOString();
function statistics(rows: Iterable<Sample>, start: number, end: number) {
  let count = 0, failed = 0, sum = 0, min = Infinity, max = -Infinity;
  let first: Sample | undefined, last: Sample | undefined, cursor = start, covered = 0, gapCount = 0;
  const gaps: {start: string; end: string}[] = [];
  const gap = (s: number, e: number) => {
    if (e <= s) return;
    gapCount++;
    if (gaps.length < 1000) gaps.push({start: iso(s), end: iso(e)});
  };
  for (const row of rows) {
    if (row.quality !== 'ok' || row.value === null || !Number.isFinite(row.value)) { if (row.ts >= start) failed++; continue; }
    const s = Math.max(start, row.ts), e = Math.min(end, row.ts + row.cadence_ms);
    gap(cursor, s);
    covered += Math.max(0, e - Math.max(cursor, s));
    cursor = Math.max(cursor, e);
    // A preceding sample may cover the start boundary but is not in the statistics.
    if (row.ts < start) continue;
    count++; sum += row.value; min = Math.min(min, row.value); max = Math.max(max, row.value);
    first ??= row; last = row;
  }
  gap(cursor, end);
  return {sample_count: count, failed_sample_count: failed,
    min: count ? min : null, mean: count ? sum / count : null, max: count ? max : null,
    first: first ? {timestamp: iso(first.ts), value: first.value} : null,
    last: last ? {timestamp: iso(last.ts), value: last.value} : null,
    change: first && last ? last.value! - first.value! : null,
    covered_seconds: covered / 1000, coverage_fraction: covered / (end - start),
    gaps, gaps_truncated: gapCount > gaps.length};
}
const note = 'Sample-weighted statistics; coverage uses successful sample intervals. No interpolation. Observed differences do not establish faults, COP, energy savings, or causation.';
function samples(db: NonNullable<ReturnType<typeof openHistory>>, id: string, start: number, end: number, cutoff: number) {
  return db.prepare('SELECT ts,value,quality,cadence_ms FROM readings WHERE metric_id=? AND ts>=? AND ts<? AND ts+cadence_ms>? ORDER BY ts')
    .iterate(id, Math.max(cutoff, start - 86400000), end, start) as unknown as Iterable<Sample>;
}
export function summarizeOperation(c: Config, request: AnalysisRequest) {
  const {start, end} = period(request), selected = selectMetrics(request.metric_ids);
  const db = openHistory(c), cutoff = Date.now() - c.retentionDays * 86400000;
  try {
    db?.exec('BEGIN');
    return {start: iso(start), end: iso(end), note,
      metrics: selected.map(m => ({metric_id: m.id, unit: m.unit,
        ...statistics(db ? samples(db, m.id, start, end, cutoff) : [], start, end)}))};
  } finally { db?.close(); }
}
export function analyzeTemperatureDelta(c: Config, request: Period & {pair: 'heating' | 'brine'}) {
  const {start, end} = period(request);
  if (!['heating', 'brine'].includes(request.pair)) throw new Error('pair must be heating or brine');
  const ids = request.pair === 'heating' ? ['supply_temperature', 'return_temperature'] : ['brine_inlet_temperature', 'brine_outlet_temperature'];
  const db = openHistory(c), cutoff = Date.now() - c.retentionDays * 86400000;
  let unmatched = 0;
  function* aligned(): Generator<Sample> {
    if (!db) return;
    const left = samples(db, ids[0], start, end, cutoff)[Symbol.iterator]();
    const right = samples(db, ids[1], start, end, cutoff)[Symbol.iterator]();
    let a = left.next(), b = right.next();
    while (!a.done && !b.done) {
      const tolerance = Math.min(5000, a.value.cadence_ms / 2, b.value.cadence_ms / 2);
      if (Math.abs(a.value.ts - b.value.ts) > tolerance) {
        unmatched++;
        if (a.value.ts < b.value.ts) a = left.next(); else b = right.next();
        continue;
      }
      const x = a.value, y = b.value, ts = Math.max(x.ts, y.ts);
      yield {ts, value: x.value !== null && y.value !== null ? x.value - y.value : null,
        quality: x.quality === 'ok' && y.quality === 'ok' ? 'ok' : 'error',
        cadence_ms: Math.max(0, Math.min(x.ts + x.cadence_ms, y.ts + y.cadence_ms) - ts)};
      a = left.next(); b = right.next();
    }
    while (!a.done) { unmatched++; a = left.next(); }
    while (!b.done) { unmatched++; b = right.next(); }
  }
  try {
    db?.exec('BEGIN');
    const stats = statistics(aligned(), start, end);
    return {start: iso(start), end: iso(end), pair: request.pair, subtraction: `${ids[0]} - ${ids[1]}`, unit: '°C',
      alignment: 'One-to-one chronological pairs within 5 seconds and half of each sample cadence; coverage is the overlap of paired intervals.',
      unmatched_sample_count: unmatched, ...stats, note};
  } finally { db?.close(); }
}
export function comparePeriods(c: Config, request: {before: Period; after: Period; metric_ids?: string[]}) {
  period(request.before); period(request.after);
  const selected = selectMetrics(request.metric_ids).map(m => m.id);
  if (!selected.includes('outdoor_temperature')) selected.push('outdoor_temperature');
  const before = summarizeOperation(c, {...request.before, metric_ids: selected});
  const after = summarizeOperation(c, {...request.after, metric_ids: selected});
  return {before, after, differences: before.metrics.map((m, i) => ({metric_id: m.metric_id, unit: m.unit,
    mean_change: m.mean === null || after.metrics[i].mean === null ? null : after.metrics[i].mean! - m.mean})),
    note: 'Mean changes are after minus before. Outdoor temperature is included as context, not weather normalization. Unequal durations, missing data and operating conditions can make comparisons inconclusive. ' + note};
}
