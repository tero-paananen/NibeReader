import { createServer, type Socket } from 'node:net';
import { chmodSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, identity, privateDirectory, requireHost, type Config } from './config.js';
import { acquireLock } from './lock.js';
import { openHistory, saveReadings } from './history.js';
import { readPump } from './modbus.js';
import { metrics, selectMetrics, type Reading } from './metrics.js';
import type { CollectorStatus } from './ipc.js';

export async function runCollector(c: Config) {
  process.umask(0o077);
  requireHost(c);
  const release = await acquireLock(c, 'collector');
  const db = openHistory(c, true)!;
  privateDirectory(dirname(c.socketPath));
  try { unlinkSync(c.socketPath); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const status: CollectorStatus = {
    metric_ids: metrics.map(m => m.id),
    running: true, stopping: false, pid: process.pid, started_at: new Date().toISOString(), device: identity(c),
    sample_seconds: c.sampleMs / 1000, retention_days: c.retentionDays,
    last_poll: null, last_successful_sample: null, last_error: null,
  };
  let inFlight: Promise<Reading[]> | undefined;
  function snapshot() {
    if (!inFlight) {
      inFlight = readPump(c).finally(() => { inFlight = undefined; });
    }
    return inFlight;
  }
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> = Promise.resolve();
  let failures = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(100000, () => socket.destroy());
    let buffer = '', handled = false;
    socket.on('data', async chunk => {
      if (handled) return;
      buffer += chunk.toString();
      if (buffer.length > 8192) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      handled = true;
      try {
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (request.method === 'status') socket.end(JSON.stringify({ result: status }) + '\n');
        else if (request.method === 'stop') {
          status.stopping = true;
          socket.end(JSON.stringify({ result: { stopping: true } }) + '\n');
          void shutdown();
        } else if (request.method === 'live') {
          if (status.stopping) throw new Error('Collector is stopping');
          const selected = selectMetrics(request.metric_ids).map(m => m.id);
          const readings = (await snapshot()).filter(r => selected.includes(r.metric_id as typeof metrics[number]['id']));
          socket.end(JSON.stringify({ result: readings }) + '\n');
        } else throw new Error('Unknown collector method');
      } catch (error) { socket.end(JSON.stringify({ error: String(error) }) + '\n'); }
    });
  });
  async function poll() {
    const begin = Date.now();
    try {
      const readings = await snapshot();
      saveReadings(db, c, readings);
      status.last_poll = new Date().toISOString();
      const good = readings.filter(r => r.quality === 'ok');
      if (good.length) status.last_successful_sample = good[good.length - 1].timestamp;
      status.last_error = readings.find(r => r.quality !== 'ok')?.error ?? null;
      failures = good.length ? 0 : failures + 1;
    } catch (error) { status.last_error = String(error); failures++; }
    if (!status.stopping) {
      const delay = failures ? Math.min(300000, Math.max(c.sampleMs, 5000 * 2 ** Math.min(failures - 1, 6))) : c.sampleMs;
      // Never catch up missed polls after sleep with a burst of artificial samples.
      timer = setTimeout(() => { polling = poll(); }, Math.max(1000, delay - (Date.now() - begin)));
    }
  }
  let shutdownPromise: Promise<void> | undefined;
  function shutdown() {
    return shutdownPromise ??= (async () => {
      status.stopping = true;
      if (timer) clearTimeout(timer);
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      await polling;
      if (inFlight) await inFlight.catch(() => {});
      // Let completed responses flush, then close any idle IPC connections.
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const socket of sockets) socket.destroy();
      await closed;
      db.close();
      try { unlinkSync(c.socketPath); } catch {}
      release();
    })();
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(c.socketPath, () => { chmodSync(c.socketPath, 0o600); resolve(); });
  });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  polling = poll();
}

if (process.argv[1]?.endsWith('/collector.js')) {
  runCollector(config()).catch(error => { console.error(error); process.exit(1); });
}
