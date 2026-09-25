import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, metrics, selectMetrics } from '../dist/metrics.js';
import { readPump } from '../dist/modbus.js';
import { config } from '../dist/config.js';
import { fixture } from './helpers.mjs';

test('configuration and decoding reject bad input', () => {
  assert.throws(() => config({ NIBE_PORT: 'oops' }));
  assert.throws(() => selectMetrics(['invented']));
  assert.throws(() => selectMetrics([]));
  assert.throws(() => decode(metrics[0], Buffer.from([1])));
  assert.equal(decode(metrics[0], Buffer.from([0xff, 0x85])), -123);
  assert.equal(decode(metrics[7], Buffer.from([0xff, 0xfe])), 65534);
});

test('real Modbus packets: signed temperature, units, scaling, unit ID, read-only function', async () => {
  const f = await fixture();
  try {
    const rows = await readPump(f.c);
    assert.equal(rows[0].value, -12.3);
    assert.equal(rows[1].value, 32.5);
    assert.equal(rows[7].value, 45);
    assert.match(metrics[7].name, /Requested/);
    assert.equal(f.requests.length, metrics.length);
    assert(f.requests.every(r => r.fc === 4 && r.unitId === 7 && (r.count === 1 || r.count === 2)));
    assert.equal((await f.service.status()).collection.running, false);
  } finally { await f.cleanup(); }
});

test('unsupported register is unavailable, timeout is bounded, later request reconnects', async () => {
  const f = await fixture();
  try {
    f.behavior.rejectRegister = 9;
    const rows = await readPump(f.c);
    assert.equal(rows[4].quality, 'unavailable');
    assert.equal(rows[4].value, null);
    assert.equal(rows[5].quality, 'ok');
    f.behavior.silent = true;
    const start = Date.now();
    const failed = await readPump({ ...f.c, timeoutMs: 100 }, ['outdoor_temperature']);
    assert.equal(failed[0].quality, 'error');
    assert(Date.now() - start < 2000);
    f.behavior.silent = false;
    assert.equal((await readPump(f.c, ['outdoor_temperature']))[0].value, -12.3);
  } finally { await f.cleanup(); }
});

test('fragmented replies decode and malformed replies fail without crashing', { timeout: 5000 }, async () => {
  const f = await fixture();
  try {
    f.behavior.fragmented = true;
    assert.equal((await readPump(f.c, ['outdoor_temperature']))[0].value, -12.3);
    f.behavior.malformed = true;
    assert.equal((await readPump({ ...f.c, timeoutMs: 100 }, ['outdoor_temperature']))[0].quality, 'error');
    f.behavior.malformed = false;
    assert.equal((await readPump(f.c, ['outdoor_temperature']))[0].quality, 'ok');
  } finally { await f.cleanup(); }
});

test('32-bit low-word-first counters, signed values and exact response sizes', async () => {
  const f = await fixture();
  try {
    f.behavior.fragmented = true;
    const rows = await readPump(f.c, ['compressor_starts', 'compressor_runtime', 'actual_compressor_frequency']);
    assert.deepEqual(rows.map(r => r.value), [70000, 90000, 45]);
    assert.deepEqual(f.requests.map(r => r.count), [2, 2, 1]);
    f.behavior.values[1083] = -2147483648;
    assert.equal((await readPump(f.c, ['compressor_starts']))[0].value, -2147483648);
    f.behavior.wrongCount = true;
    assert.equal((await readPump(f.c, ['compressor_starts']))[0].quality, 'error');
    f.behavior.wrongCount = false; f.behavior.malformed = true;
    assert.equal((await readPump(f.c, ['compressor_starts']))[0].quality, 'error');
    f.behavior.malformed = false; f.behavior.values[2195] = 256;
    assert.equal((await readPump(f.c, ['active_alarm']))[0].quality, 'error');
    f.behavior.values[2195] = 99;
    assert.equal((await readPump(f.c, ['active_alarm']))[0].label, 'Unknown (99)');
  } finally {await f.cleanup();}
});
