import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {config, privateDirectory} from '../dist/config.js';
import {dirname} from 'node:path';
import {buildHealthReport, healthOptions} from '../dist/health.js';
import {NibeService} from '../dist/service.js';
import {openHistory, saveReadings, databasePath} from '../dist/history.js';
import {fixture} from './helpers.mjs';
const iso = ts => new Date(ts).toISOString();
const now = Date.now(), start = now - 86400000;
const live = [ ['active_alarm', 0], ['alarm_number', 0], ['operating_priority', 30], ['actual_compressor_frequency', 45], ['compressor_status', 1], ['compressor_starts', 100], ['compressor_runtime', 1000] ]
  .map(([metric_id, value]) => ({metric_id, value, raw_value: value, quality: 'ok', timestamp: iso(now), unit: ''}));
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'nibe-health-'));
  const c = config({NIBE_DATA_DIR: dataDir, NIBE_SAMPLE_SECONDS: '60'});
  return {c, cleanup: () => rmSync(dataDir, {recursive: true, force: true})};
}
function store(c, values, id = 'compressor_status', cadence = 60000) {
  const db = openHistory(c, true);
  saveReadings(db, {...c, sampleMs: cadence}, values.map(([ts, value, quality = 'ok']) => ({metric_id: id, timestamp: iso(ts), raw_value: value, value, quality, unit: ''})), now);
  db.close();
}
const fullDay = fn => Array.from({length: 1440}, (_, i) => [start + i * 60000, fn(i)]);
function counters(c) {
  store(c, [[start, 100], [now - 60000, 103]], 'compressor_starts');
  store(c, [[start, 1000], [now - 60000, 1023]], 'compressor_runtime');
}
function report(c, readings = live, args = {}) {return buildHealthReport(c, {start: iso(start), end: iso(now), ...args}, readings, now);}

test('validates paired periods and heuristic overrides before reading', () => {
  assert.equal(healthOptions({}, now).start, start);
  for (const args of [{start: iso(start)}, {end: iso(now)}, {short_run_minutes: 0}, {short_run_minutes: NaN}, {short_run_count: 1}, {short_run_count: 2.5}, {start: 'yesterday', end: iso(now)}]) assert.throws(() => healthOptions(args, now));
});

test('live alarm states, unknown states and missing history remain explicit without creating history', () => {
  const f = setup();
  try {
    const r = report(f.c);
    assert.equal(r.alarms.outcome, 'no concerns observed');
    assert.equal(r.compressor.outcome, 'insufficient data');
    assert.equal(r.compressor.cycling.coverage_fraction, 0);
    assert.equal(r.target.physical_validation, 'not_verified');
    assert(!existsSync(databasePath(f.c)));
    const alarm = report(f.c, live.map(r => r.metric_id === 'active_alarm' ? {...r, value: 1} : r.metric_id === 'alarm_number' ? {...r, value: 9876} : r));
    assert.equal(alarm.alarms.outcome, 'needs attention'); assert.equal(alarm.alarms.reported_alarm_number, 9876);
    const unknown = report(f.c, live.map(r => r.metric_id === 'active_alarm' || r.metric_id === 'operating_priority' || r.metric_id === 'compressor_status' ? {...r, value: 99} : r));
    assert.equal(unknown.alarms.outcome, 'insufficient data');
    assert.equal(unknown.alarms.operating_priority.label, 'Unknown (99)');
    assert.equal(unknown.compressor.outcome, 'insufficient data');
    assert.equal(report(f.c, []).alarms.active, null);
  } finally {f.cleanup();}
});

test('continuous operation qualifies; cumulative differences use endpoints; resets invalidate only affected counter', () => {
  const f = setup();
  try {
    store(f.c, fullDay(() => 1)); counters(f.c);
    const r = report(f.c);
    assert.equal(r.compressor.outcome, 'no concerns observed');
    assert.equal(r.compressor.cycling.observed_complete_runs, 0);
    assert.equal(r.compressor.starts.difference, 3);
    assert.equal(r.compressor.runtime_hours.elapsed_seconds, 86340);
    store(f.c, [[start + 300000, 90]], 'compressor_starts');
    const reset = report(f.c);
    assert.equal(reset.compressor.starts.difference, null);
    assert.equal(reset.compressor.starts.possible_reset, true);
    assert.equal(reset.compressor.runtime_hours.difference, 23);
    assert.equal(reset.compressor.outcome, 'needs attention');
  } finally {f.cleanup();}
});

test('three short complete runs trigger only with a full uninterrupted hour and strict duration bound', () => {
  const f = setup();
  try {
    // Upper bound = 5 minutes; three complete runs in the first hour.
    store(f.c, fullDay(i => [10, 25, 40].some(s => i >= s && i < s + 4) ? 1 : 0));
    counters(f.c);
    const r = report(f.c);
    assert.equal(r.compressor.cycling.outcome, 'needs attention');
    assert.equal(r.compressor.cycling.observed_complete_runs, 3);
    assert.equal(r.compressor.cycling.runs[0].upper_seconds, 300);
    assert.equal(r.compressor.cycling.runs[0].lower_seconds, 180);
    assert.equal(report(f.c, live, {short_run_minutes: 5}).compressor.cycling.warning_windows.length, 0);
    assert.equal(report(f.c, live, {short_run_count: 4}).compressor.cycling.warning_windows.length, 0);
    assert.equal(report(f.c, live, {end: iso(start + 3600000)}).compressor.cycling.warning_windows.length, 0);
    store(f.c, [[start + 50 * 60000, null, 'error']]);
    assert.equal(report(f.c).compressor.cycling.warning_windows.length, 0);
  } finally {f.cleanup();}
});

test('gaps, unknown status, coarse cadence and partial runs cannot reassure or fabricate runs', () => {
  const f = setup();
  try {
    store(f.c, [[start, 1], [start + 60000, 0], [start + 120000, 1], [start + 180000, null, 'error'], [start + 240000, 0], [now - 60000, 1]]);
    const r = report(f.c);
    assert.equal(r.compressor.cycling.observed_complete_runs, 0);
    assert.equal(r.compressor.cycling.outcome, 'insufficient data');
    assert(r.compressor.cycling.gaps.length > 0);
    store(f.c, fullDay(() => 0));
    assert.equal(report(f.c).compressor.cycling.outcome, 'insufficient data');
    store(f.c, fullDay(() => 1), 'compressor_status', 120000);
    assert.equal(report(f.c).compressor.cycling.outcome, 'insufficient data');
    store(f.c, fullDay(() => 99));
    assert.equal(report(f.c).compressor.cycling.coverage_fraction, 0);
  } finally {f.cleanup();}
});

test('health service reads live through Modbus without storing samples or starting collection', async () => {
  const f = await fixture();
  try {
    const r = await f.service.checkDeviceHealth();
    assert.equal(r.alarms.active, false);
    assert.equal(r.live_readings.find(r => r.metric_id === 'actual_compressor_frequency').value, 45);
    assert.equal(r.live_readings.find(r => r.metric_id === 'compressor_starts').value, 70000);
    assert.equal((await f.service.status()).collection.running, false);
    assert(!existsSync(databasePath(f.c)));
    assert(f.requests.every(r => r.fc === 4));
    f.behavior.rejectRegister = 2195;
    assert.equal((await f.service.checkDeviceHealth()).alarms.outcome, 'insufficient data');
    const db = openHistory(f.c, true); db.close();
    await f.service.checkDeviceHealth();
    const check = openHistory(f.c); assert.equal(check.prepare('SELECT COUNT(*) n FROM readings').get().n, 0); check.close();
  } finally {await f.cleanup();}
});

test('legacy collector exposes missing capabilities and health requires explicit restart', async () => {
  const f = setup(); privateDirectory(dirname(f.c.socketPath));
  const server = net.createServer(socket => socket.once('data', bytes => {
    const req = JSON.parse(String(bytes));
    socket.end(JSON.stringify({result: req.method === 'status' ? {running: true} : []}) + '\n');
  }));
  try {
    await new Promise(resolve => server.listen(f.c.socketPath, resolve));
    const service = new NibeService(f.c);
    assert.equal((await service.status()).missing_collector_metrics.length, 7);
    const r = await service.checkDeviceHealth();
    assert(r.live_readings.every(r => r.quality === 'unavailable' && /restart/.test(r.error)));
    assert.equal(r.compressor.outcome, 'insufficient data');
  } finally {await new Promise(resolve => server.close(resolve)); rmSync(dirname(f.c.socketPath), {recursive: true, force: true}); f.cleanup();}
});

test('coverage threshold and actual sampling spacing guard reassuring cycling results', () => {
  const f = setup();
  try {
    store(f.c, fullDay(() => 1).slice(144));
    assert.equal(report(f.c).compressor.cycling.coverage_fraction, 0.9);
    assert.equal(report(f.c).compressor.cycling.outcome, 'no concerns observed');
    store(f.c, [[start + 144 * 60000, null, 'error']]);
    assert.equal(report(f.c).compressor.cycling.outcome, 'insufficient data');
    const db = openHistory(f.c, true); db.exec('DELETE FROM readings'); db.close();
    store(f.c, Array.from({length: 1439}, (_, i) => [start + i * 60001, 1]));
    const r = report(f.c);
    assert(r.compressor.cycling.coverage_fraction > 0.99);
    assert.equal(r.compressor.cycling.outcome, 'insufficient data');
    assert.equal(r.compressor.cycling.precise_sampling, false);
  } finally {f.cleanup();}
});
