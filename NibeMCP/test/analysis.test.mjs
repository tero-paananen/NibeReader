import test from 'node:test';
import assert from 'node:assert/strict';
import {openHistory, saveReadings} from '../dist/history.js';
import {NibeService} from '../dist/service.js';
import {fixture} from './helpers.mjs';
const iso = ts => new Date(ts).toISOString();
const reading = (id, ts, value, quality = 'ok') => ({metric_id: id, timestamp: iso(ts), value, raw_value: value, unit: '°C', quality});

test('summary uses raw sample weighting and reports gaps, failures and boundary coverage', async () => {
  const f = await fixture();
  try {
    const start = Date.now() - 10000, range = {start: iso(start), end: iso(start + 5000)};
    const db = openHistory(f.c, true);
    saveReadings(db, f.c, [reading('outdoor_temperature', start - 500, 99), reading('outdoor_temperature', start + 1000, 10), reading('outdoor_temperature', start + 2000, null, 'error'), reading('outdoor_temperature', start + 3000, 20), reading('outdoor_temperature', start + 5000, 100)]);
    db.close();
    const s = f.service.summarizeOperation({...range, metric_ids: ['outdoor_temperature']}).metrics[0];
    assert.equal(s.sample_count, 2); assert.equal(s.failed_sample_count, 1);
    assert.equal(s.mean, 15); assert.equal(s.change, 10); assert.equal(s.coverage_fraction, 0.5);
    assert.equal(s.gaps.length, 3);
    assert.throws(() => f.service.summarizeOperation({...range, start: 'yesterday'}));
    assert.throws(() => f.service.summarizeOperation({...range, metric_ids: ['bad']}));
    const empty = f.service.comparePeriods({before: range, after: {start: iso(start + 6000), end: iso(start + 7000)}, metric_ids: ['supply_temperature']});
    assert(empty.differences.every(d => d.mean_change === null));
    assert(empty.before.metrics.some(m => m.metric_id === 'outdoor_temperature'));
  } finally { await f.cleanup(); }
});

test('delta pairs nearby readings once, excludes failures and does not bridge misaligned samples', async () => {
  const f = await fixture();
  try {
    const start = Date.now() - 10000, range = {start: iso(start), end: iso(start + 5000)};
    const db = openHistory(f.c, true);
    saveReadings(db, f.c, [reading('supply_temperature', start, 35), reading('return_temperature', start + 100, 30),
      reading('supply_temperature', start + 1000, 40), reading('return_temperature', start + 1100, null, 'error'),
      reading('supply_temperature', start + 2000, 45), reading('return_temperature', start + 2700, 30)]);
    db.close();
    const d = f.service.analyzeTemperatureDelta({...range, pair: 'heating'});
    assert.equal(d.mean, 5); assert.equal(d.sample_count, 1); assert.equal(d.failed_sample_count, 1);
    assert.equal(d.unmatched_sample_count, 2); assert.equal(d.covered_seconds, 0.9);
    assert.equal(d.gaps.length, 2);
    assert.equal(f.service.analyzeTemperatureDelta({...range, pair: 'brine'}).mean, null);
    assert.throws(() => f.service.analyzeTemperatureDelta({...range, pair: 'bad'}));
  } finally { await f.cleanup(); }
});

test('event notes persist, filter, preserve legacy readings and never contact the pump', async () => {
  const f = await fixture();
  try {
    const start = Date.now() - 10000, range = {start: iso(start), end: iso(start + 5000)};
    const db = openHistory(f.c, true);
    saveReadings(db, f.c, [reading('outdoor_temperature', start, 10)]);
    db.exec('DROP TABLE events; PRAGMA user_version=1'); db.close();
    assert.deepEqual(f.service.listEvents(range).events, []);
    const event = f.service.recordEvent({timestamp: range.start, category: 'maintenance', note: 'Cleaned filter'}).event;
    const fresh = new NibeService(f.c);
    assert.deepEqual(fresh.listEvents({...range, category: 'maintenance'}).events, [event]);
    assert.equal(fresh.listEvents({...range, category: 'observation'}).events.length, 0);
    assert.equal(fresh.listEvents({...range, end: range.start.replace(/Z$/, '+00:00'), start: iso(start - 1000)}).events.length, 0);
    assert.equal(fresh.summarizeOperation({...range, metric_ids: ['outdoor_temperature']}).metrics[0].mean, 10);
    assert.throws(() => fresh.recordEvent({timestamp: range.start, category: ' ', note: 'test'}));
    assert.throws(() => fresh.recordEvent({timestamp: 'today', category: 'maintenance', note: 'test'}));
    assert.equal(f.requests.length, 0);
    assert.equal((await fresh.status()).collection.running, false);
  } finally { await f.cleanup(); }
});

test('recording notes without a host does not bind the database to an empty endpoint', async () => {
  const f = await fixture();
  try {
    const offline = new NibeService({...f.c, host: ''});
    offline.recordEvent({timestamp: iso(Date.now()), category: 'observation', note: 'Initial note'});
    const db = openHistory(f.c, true); db.close();
    assert.throws(() => openHistory({...f.c, host: 'another-pump'}));
  } finally { await f.cleanup(); }
});
