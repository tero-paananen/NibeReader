import {metrics} from '../dist/metrics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { collectorStatus } from '../dist/ipc.js';
import { databasePath } from '../dist/history.js';
import { fixture, delay, until } from './helpers.mjs';

test('MCP reads never start collection; explicit start survives MCP exit; singleton and stop', { timeout: 20000 }, async () => {
  const f = await fixture();
  const client = new Client({ name: 'integration-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/server.js', import.meta.url))], env: f.env, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 12);
    assert.equal(list.tools.find(t => t.name === 'start_collection').annotations.readOnlyHint, false);
    assert.equal(list.tools.find(t => t.name === 'check_device_health').annotations.readOnlyHint, true);
    for (const name of ['list_metrics', 'get_status', 'read_live', 'check_device_health']) {
      const result = await client.callTool({ name, arguments: {} });
      assert(!result.isError, JSON.stringify(result));
      if (name === 'check_device_health') {
        assert.match(result.content[0].text, /NIBE alarm and compressor report/);
        assert.equal(result.structuredContent.alarms.active, false);
        assert.equal(result.structuredContent.compressor.cycling.outcome, 'insufficient data');
      }
      assert.equal(await collectorStatus(f.c), undefined);
    }
    const history = await client.callTool({ name: 'read_history', arguments: { metric_ids: ['outdoor_temperature'], start: new Date(Date.now() - 60000).toISOString(), end: new Date().toISOString() } });
    assert(!history.isError);
    assert.equal(existsSync(databasePath(f.c)), false);
    const range = {start: new Date(Date.now() - 60000).toISOString(), end: new Date().toISOString()};
    const requestsBeforeAnalysis = f.requests.length;
    for (const [name, args] of [
      ['summarize_operation', range], ['analyze_temperature_delta', {...range, pair: 'heating'}],
      ['compare_periods', {before: range, after: range}], ['list_events', range],
    ]) {
      assert.equal(list.tools.find(t => t.name === name).annotations.readOnlyHint, true);
      const output = await client.callTool({name, arguments: args});
      assert(!output.isError, JSON.stringify(output));
    }
    assert.equal(existsSync(databasePath(f.c)), false);
    const recorded = await client.callTool({name: 'record_event', arguments: {timestamp: range.start, category: 'maintenance', note: 'User cleaned filter'}});
    assert(!recorded.isError);
    assert.equal(list.tools.find(t => t.name === 'record_event').annotations.readOnlyHint, false);
    assert.equal(list.tools.find(t => t.name === 'record_event').annotations.idempotentHint, false);
    const notes = await client.callTool({name: 'list_events', arguments: range});
    assert.equal(notes.structuredContent.events.length, 1);
    assert.equal(f.requests.length, requestsBeforeAnalysis);
    assert.equal(await collectorStatus(f.c), undefined);
    const invalid = await client.callTool({ name: 'read_live', arguments: { metric_ids: ['bad'] } });
    assert(invalid.isError);
    const started = await client.callTool({ name: 'start_collection', arguments: {} });
    assert(!started.isError, JSON.stringify(started));
    const original = await collectorStatus(f.c);
    const concurrent = await Promise.all([f.service.start(), f.service.start(), f.service.start()]);
    assert(concurrent.every(r => r.collection.pid === original.pid));
    assert.equal(statSync(f.c.socketPath).mode & 0o777, 0o600);
    await client.close();
    const before = f.requests.length;
    await until(() => f.requests.length > before);
    assert.equal((await collectorStatus(f.c)).pid, original.pid);
    const after = await f.service.live(['outdoor_temperature']);
    assert.equal(after.source, 'collector');
    assert.equal(after.readings.length, 1);
    await f.service.stop();
    assert.equal(await collectorStatus(f.c), undefined);
    assert.equal((await f.service.stop()).already_stopped, true);
    assert(existsSync(databasePath(f.c)));
    assert.equal((await f.service.live(['outdoor_temperature'])).source, 'temporary_connection');
    assert.equal(await collectorStatus(f.c), undefined);
    assert(!stderr.includes('SyntaxError'), stderr);
  } finally { await client.close(); await f.cleanup(); }
});

test('concurrent first starts share one PID; crash stays stopped and explicit restart recovers stale socket', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const starts = await Promise.all([f.service.start(), f.service.start(), f.service.start()]);
    assert.equal(new Set(starts.map(r => r.collection.pid)).size, 1);
    const pid = starts[0].collection.pid;
    process.kill(pid, 'SIGKILL');
    await until(async () => !await collectorStatus(f.c));
    await delay(1200);
    assert.equal(await collectorStatus(f.c), undefined);
    const restarted = await f.service.start();
    assert.notEqual(restarted.collection.pid, pid);
    await until(async () => (await f.service.status()).history.last_successful_sample);
  } finally { await f.cleanup(); }
});

test('process suspension causes a gap without replaying missed samples', { timeout: 15000 }, async () => {
  const f = await fixture();
  let pid;
  try {
    pid = (await f.service.start()).collection.pid;
    await until(async () => (await f.service.status()).history.last_successful_sample);
    process.kill(pid, 'SIGSTOP');
    const before = f.requests.length;
    await delay(2400);
    assert.equal(f.requests.length, before);
    process.kill(pid, 'SIGCONT');
    await until(() => f.requests.length >= before + metrics.length);
    await delay(150);
    assert(f.requests.length <= before + metrics.length);
    const result = f.service.history({ metric_ids: ['outdoor_temperature'], start: new Date(Date.now() - 10000).toISOString(), end: new Date().toISOString() });
    assert(result.series[0].gaps.some(g => Date.parse(g.end) - Date.parse(g.start) > 1000));
  } finally { if (pid) { try { process.kill(pid, 'SIGCONT'); } catch {} } await f.cleanup(); }
});
