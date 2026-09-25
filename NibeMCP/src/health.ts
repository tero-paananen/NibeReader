import {type Config} from './config.js';
import {openHistory} from './history.js';
import {period} from './analysis.js';
import {healthMetricIds, metrics, stateLabel, type Reading} from './metrics.js';

export interface HealthRequest {
  start?: string;
  end?: string;
  short_run_minutes?: number;
  short_run_count?: number;
}
type Sample = {
  ts: number;
  value: number | null;
  quality: string;
  cadence_ms: number;
};
type Outcome = 'no concerns observed' | 'needs attention' | 'insufficient data';
const iso = (ts: number) => new Date(ts).toISOString();
export function healthOptions(request: HealthRequest, now = Date.now()) {
  if ((request.start === undefined) !== (request.end === undefined))
    throw new Error('Provide start and end together.');
  const range =
    request.start !== undefined
      ? period({start: request.start, end: request.end!})
      : {start: now - 86400000, end: now};
  const minutes = request.short_run_minutes ?? 10,
    count = request.short_run_count ?? 3;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60)
    throw new Error(
      'short_run_minutes must be greater than zero and at most 60.'
    );
  if (!Number.isSafeInteger(count) || count < 2 || count > 1000)
    throw new Error('short_run_count must be an integer from 2 to 1000.');
  return {...range, minutes, count};
}
function valid(row: Sample) {
  return (
    row.quality === 'ok' && row.value !== null && Number.isFinite(row.value)
  );
}
function counter(rows: Sample[]) {
  const good = rows.filter(r => valid(r) && r.value! >= 0);
  const first = good[0],
    last = good.at(-1);
  const reset =
    rows.some(r => valid(r) && r.value! < 0) ||
    good.some((r, i) => i > 0 && r.value! < good[i - 1].value!);
  return {
    first: first ? {timestamp: iso(first.ts), value: first.value} : null,
    last: last ? {timestamp: iso(last.ts), value: last.value} : null,
    elapsed_seconds: first && last ? (last.ts - first.ts) / 1000 : null,
    difference:
      !reset && first && last && good.length >= 2
        ? last.value! - first.value!
        : null,
    possible_reset: reset,
    failed_sample_count: rows.length - good.length,
  };
}

export function buildHealthReport(
  c: Config,
  request: HealthRequest,
  live: Reading[],
  now = Date.now()
) {
  const {start, end, minutes, count} = healthOptions(request, now);
  const db = openHistory(c);
  const cutoff = now - c.retentionDays * 86400000;
  let statusRows: Sample[] = [],
    starts: Sample[] = [],
    runtime: Sample[] = [];
  try {
    db?.exec('BEGIN');
    const rows = (id: string) =>
      (db
        ?.prepare(
          'SELECT ts,value,quality,cadence_ms FROM readings WHERE metric_id=? AND ts>=? AND ts<? ORDER BY ts'
        )
        .all(id, Math.max(start, cutoff), end) ?? []) as Sample[];
    statusRows = rows('compressor_status');
    starts = rows('compressor_starts');
    runtime = rows('compressor_runtime');
  } finally {
    db?.close();
  }
  const isStatus = (r: Sample) =>
    valid(r) && (r.value === 0 || r.value === 1) && r.cadence_ms > 0;
  const precise = (r: Sample) => isStatus(r) && r.cadence_ms <= 60000;
  const adjacent = (a: Sample, b: Sample) =>
    precise(a) &&
    precise(b) &&
    b.ts > a.ts &&
    b.ts - a.ts <= Math.min(60000, a.cadence_ms);
  const runs: {
    start: string;
    end: string;
    lower_seconds: number;
    upper_seconds: number;
    segment_start: number;
    before_ts: number;
    stop_ts: number;
  }[] = [];
  let previous: Sample | undefined,
    run: {before: number; first: number; last: number} | undefined;
  let segmentStart = start,
    cursor = start,
    covered = 0,
    gapCount = 0,
    observedOperation = false,
    allPrecise = true;
  const gaps: {start: string; end: string}[] = [];
  function gap(a: number, b: number) {
    if (b > a) {
      gapCount++;
      if (gaps.length < 1000) gaps.push({start: iso(a), end: iso(b)});
    }
  }
  for (const row of statusRows) {
    if (isStatus(row)) {
      const stop = Math.min(end, row.ts + row.cadence_ms);
      gap(cursor, row.ts);
      covered += Math.max(0, stop - Math.max(cursor, row.ts));
      cursor = Math.max(cursor, stop);
      observedOperation ||= row.value === 1;
    }
    if (isStatus(row) && row.cadence_ms > 60000) allPrecise = false;
    // Failures are reflected in coverage. Actual gaps between otherwise valid readings
    // cannot be treated as a precise record simply because configured cadence is short.
    if (
      previous &&
      isStatus(previous) &&
      isStatus(row) &&
      row.ts - previous.ts > 60000
    )
      allPrecise = false;
    if (!previous || !adjacent(previous, row)) {
      run = undefined;
      segmentStart = row.ts;
    } else if (previous.value === 0 && row.value === 1)
      run = {before: previous.ts, first: row.ts, last: row.ts};
    else if (row.value === 1 && run) run.last = row.ts;
    else if (previous.value === 1 && row.value === 0 && run) {
      runs.push({
        start: iso(run.first),
        end: iso(row.ts),
        lower_seconds: (run.last - run.first) / 1000,
        upper_seconds: (row.ts - run.before) / 1000,
        segment_start: segmentStart,
        before_ts: run.before,
        stop_ts: row.ts,
      });
      run = undefined;
    }
    previous = row;
  }
  gap(cursor, end);
  // Every warning window must be entirely inside a contiguous precise segment.
  // Evaluate at every sample so a cluster early in a segment can qualify once an hour is observed.
  const windows: {start: string; end: string; short_run_count: number}[] = [];
  let segment = start,
    prev: Sample | undefined;
  const shortRuns = runs.filter(r => r.upper_seconds < minutes * 60);
  let nextRun = 0;
  let candidates: typeof shortRuns = [];
  for (const row of statusRows) {
    if (!prev || !adjacent(prev, row)) segment = row.ts;
    while (nextRun < shortRuns.length && shortRuns[nextRun].stop_ts <= row.ts)
      candidates.push(shortRuns[nextRun++]);
    const from = row.ts - 3600000;
    candidates = candidates.filter(
      r => r.segment_start === segment && r.before_ts >= from
    );
    if (precise(row) && row.ts - segment >= 3600000) {
      const n = candidates.length;
      if (
        n >= count &&
        (!windows.length || row.ts - Date.parse(windows.at(-1)!.end) >= 3600000)
      )
        windows.push({start: iso(from), end: iso(row.ts), short_run_count: n});
    }
    prev = row;
  }
  const coverage = covered / (end - start);
  const sufficient =
    end - start >= 86400000 &&
    coverage >= 0.9 &&
    allPrecise &&
    observedOperation;
  const insufficientReasons = [
    ...(end - start < 86400000 ? ['Less than 24 hours requested.'] : []),
    ...(coverage < 0.9
      ? ['Valid compressor status coverage is below 90%.']
      : []),
    ...(!allPrecise
      ? [
          'Status sampling exceeds 60 seconds or valid readings are separated by a gap longer than 60 seconds.',
        ]
      : []),
    ...(!observedOperation ? ['No valid compressor-on samples observed.'] : []),
  ];
  const cyclingOutcome: Outcome = windows.length
    ? 'needs attention'
    : sufficient
    ? 'no concerns observed'
    : 'insufficient data';
  const enriched = healthMetricIds.map(id => {
    const m = metrics.find(m => m.id === id)!;
    const r = live.find(r => r.metric_id === id) ?? {
      metric_id: id,
      timestamp: iso(now),
      value: null,
      raw_value: null,
      unit: m.unit,
      quality: 'unavailable' as const,
      error: 'Reading missing from live response',
    };
    return {
      ...r,
      label:
        r.quality === 'ok' && r.value !== null
          ? stateLabel(m, r.value)
          : undefined,
    };
  });
  const value = (id: string) => {
    const r = enriched.find(r => r.metric_id === id)!;
    return r.quality === 'ok' && r.value !== null && Number.isFinite(r.value)
      ? r.value
      : null;
  };
  const alarm = value('active_alarm');
  const priority = enriched.find(r => r.metric_id === 'operating_priority')!;
  const alarmIncomplete =
    (alarm !== 0 && alarm !== 1) ||
    value('alarm_number') === null ||
    !priority.label ||
    priority.label.startsWith('Unknown');
  const alarmOutcome: Outcome =
    alarm === 1
      ? 'needs attention'
      : alarm === 0 && !alarmIncomplete
      ? 'no concerns observed'
      : 'insufficient data';
  const startStats = counter(starts),
    runtimeStats = counter(runtime);
  const liveComplete = [
    'actual_compressor_frequency',
    'compressor_status',
    'compressor_starts',
    'compressor_runtime',
  ].every(id => {
    const v = value(id);
    return (
      v !== null && v >= 0 && (id !== 'compressor_status' || v === 0 || v === 1)
    );
  });
  const findings: string[] = [];
  if (windows.length)
    findings.push(
      'Possible frequent short cycling: repeated complete runs below the configured duration threshold.'
    );
  if (startStats.possible_reset || runtimeStats.possible_reset)
    findings.push(
      'A counter decreased or became negative; the affected difference is unavailable (possible reset).'
    );
  const compressorOutcome: Outcome = findings.length
    ? 'needs attention'
    : sufficient &&
      liveComplete &&
      startStats.difference !== null &&
      runtimeStats.difference !== null
    ? 'no concerns observed'
    : 'insufficient data';
  return {
    generated_at: iso(now),
    period: {start: iso(start), end: iso(end)},
    target: {
      model: 'NIBE S1255-12',
      software: '4.13.12',
      provenance: 'user-provided',
      physical_validation: 'not_verified',
    },
    live_readings: enriched,
    alarms: {
      outcome: alarmOutcome,
      active: alarm === 0 ? false : alarm === 1 ? true : null,
      reported_alarm_number: value('alarm_number'),
      operating_priority: enriched.find(
        r => r.metric_id === 'operating_priority'
      ),
      findings:
        alarm === 1
          ? [
              'The pump reports an active alarm. Consult its display for all active faults and instructions.',
            ]
          : [],
      incomplete_data: Boolean(alarmIncomplete),
      alarm_lookup: 'https://www.nibe.eu/sv-se/support/larmkoder',
    },
    compressor: {
      outcome: compressorOutcome,
      findings,
      incomplete_data:
        !sufficient ||
        !liveComplete ||
        startStats.difference === null ||
        runtimeStats.difference === null,
      starts: startStats,
      runtime_hours: runtimeStats,
      cycling: {
        outcome: cyclingOutcome,
        heuristic: {
          short_run_minutes: minutes,
          short_run_count: count,
          window_minutes: 60,
          manufacturer_fault_limit: false,
        },
        observed_complete_runs: runs.length,
        runs: runs
          .slice(0, 1000)
          .map(({segment_start, before_ts, stop_ts, ...r}) => r),
        runs_truncated: runs.length > 1000,
        warning_windows: windows.slice(0, 1000),
        warning_windows_truncated: windows.length > 1000,
        coverage_fraction: coverage,
        gaps,
        gaps_truncated: gapCount > gaps.length,
        observed_operation: observedOperation,
        insufficient_data_reasons: insufficientReasons,
        precise_sampling: allPrecise && statusRows.length > 0,
      },
    },
    limitations: [
      'Register readings require comparison with the pump display on software 4.13.12.',
      'Alarm number is not an exhaustive fault list; unknown codes are not translated.',
      'Cycling is inferred from sampled status. Boundary runs and runs crossing gaps are excluded; durations are bounds, not exact times.',
      'Runtime counters have whole-hour resolution. Counter differences describe their observed endpoints.',
      'No mechanical health diagnosis; inactivity alone is not a fault. Missing or unvalidated data does not establish health.',
    ],
  };
}
export function healthText(report: ReturnType<typeof buildHealthReport>) {
  const reading = (id: string) => {
    const r = report.live_readings.find(r => r.metric_id === id)!;
    return r.quality === 'ok' && r.value !== null
      ? `${r.label ?? r.value}${r.unit ? ' ' + r.unit : ''} (at ${r.timestamp})`
      : `unavailable: ${r.error ?? r.quality}`;
  };
  const cycling = report.compressor.cycling;
  return [
    `NIBE alarm and compressor report (${report.generated_at})`,
    `History: ${report.period.start} to ${report.period.end}`,
    `Alarms: ${report.alarms.outcome}; reported code: ${
      report.alarms.reported_alarm_number ?? 'unavailable'
    }`,
    `Operating activity: ${reading('operating_priority')}`,
    `Compressor: ${report.compressor.outcome}; status: ${reading(
      'compressor_status'
    )}`,
    `Actual frequency: ${reading('actual_compressor_frequency')}`,
    `Total starts: ${reading('compressor_starts')}; historical increase: ${
      report.compressor.starts.difference ?? 'unavailable'
    }`,
    `Total runtime: ${reading('compressor_runtime')}; historical increase: ${
      report.compressor.runtime_hours.difference ?? 'unavailable'
    } h`,
    `Cycling: ${cycling.outcome}; complete observed runs: ${
      cycling.observed_complete_runs
    }; status coverage: ${(100 * cycling.coverage_fraction).toFixed(1)}%`,
    `Heuristic: at least ${cycling.heuristic.short_run_count} complete runs shorter than ${cycling.heuristic.short_run_minutes} minutes within an uninterrupted hour. Not a manufacturer fault limit.`,
    ...report.alarms.findings,
    ...report.compressor.findings,
    ...cycling.insufficient_data_reasons,
    `Alarm lookup: ${report.alarms.alarm_lookup}`,
    ...report.limitations,
  ].join('\n');
}
