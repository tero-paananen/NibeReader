import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { databasePath, openHistory, saveReadings, readHistory } from '../dist/history.js';
import { fixture } from './helpers.mjs';

const reading = (ts, value = 10, quality = 'ok') => ({ metric_id: 'outdoor_temperature', timestamp: new Date(ts).toISOString(), raw_value: value === null ? null : value * 10, value, unit: '°C', quality });

test('empty history/status do not create database or collector', async () => {
  const f = await fixture();
  try {
    const end = Date.now(), start = end - 60000;
    const result = readHistory(f.c, { metric_ids: ['outdoor_temperature'], start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    assert.equal(result.series[0].points.length, 0);
    assert.equal(result.series[0].gaps.length, 1);
    assert.equal((await f.service.status()).collection.running, false);
    assert.equal(existsSync(databasePath(f.c)), false);
  } finally { await f.cleanup(); }
});

test('history retains errors, exposes gaps, aggregates within limits, prunes retention', async () => {
  const f = await fixture();
  try {
    const now = Date.now(), start = now - 2000000;
    const db = openHistory(f.c, true);
    saveReadings(db, f.c, [reading(now - 366 * 86400000), ...Array.from({ length: 1200 }, (_, i) => reading(start + i * 1000, i)), reading(start + 1200000, null, 'error')], now);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readings').get().n, 1201);
    db.close();
    const result = readHistory(f.c, { metric_ids: ['outdoor_temperature'], start: new Date(start).toISOString(), end: new Date(now).toISOString() });
    const series = result.series[0];
    assert.equal(series.mode, 'aggregate');
    assert(series.points.length <= 1000);
    assert.equal(series.points.reduce((n, p) => n + p.sample_count, 0), 1200);
    assert.equal(series.points.reduce((n, p) => n + p.failed_sample_count, 0), 1);
    assert.deepEqual(series.gaps, [{ start: new Date(start + 1200000).toISOString(), end: new Date(now).toISOString() }]);
    const raw = readHistory(f.c, { metric_ids: ['outdoor_temperature'], start: new Date(start + 1200000).toISOString(), end: new Date(now).toISOString() });
    assert.equal(raw.series[0].points[0].value, null);
    assert.equal(raw.series[0].points[0].quality, 'error');
  } finally { await f.cleanup(); }
});

test('timezone offsets, half-open ranges and invalid time requests', async () => {
  const f = await fixture();
  try {
    const args = { metric_ids: ['outdoor_temperature'], start: '2026-10-25T03:00:00+03:00', end: '2026-10-25T03:00:00+02:00' };
    const result = readHistory(f.c, args);
    assert.equal(Date.parse(result.end) - Date.parse(result.start), 3600000);
    assert.throws(() => readHistory(f.c, { ...args, start: '2026-10-25T03:00:00' }));
    assert.throws(() => readHistory(f.c, { ...args, end: args.start }));
    assert.throws(() => readHistory(f.c, { ...args, interval: 0 }));
  } finally { await f.cleanup(); }
});
