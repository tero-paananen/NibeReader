import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { config } from '../dist/config.js';
import { NibeService } from '../dist/service.js';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(50); }
  throw new Error('Condition not reached before timeout');
}
export async function fixture() {
  const sockets = new Set();
  const requests = [];
  const behavior = { silent: false, rejectRegister: undefined, malformed: false, fragmented: false };
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 7) {
        const length = pending.readUInt16BE(4) + 6;
        if (pending.length < length) return;
        const packet = pending.subarray(0, length);
        pending = pending.subarray(length);
        const address = packet.readUInt16BE(8);
        requests.push({ fc: packet[7], address, unitId: packet[6], count: packet.readUInt16BE(10) });
        if (behavior.silent) continue;
        const exception = address === behavior.rejectRegister;
        const response = Buffer.alloc(exception ? 9 : 11);
        packet.copy(response, 0, 0, 4);
        response.writeUInt16BE(exception ? 3 : 5, 4);
        response[6] = packet[6]; response[7] = exception ? 0x84 : 4; response[8] = 2;
        if (!exception) response.writeUInt16BE(address === 1 ? 0xff85 : address === 140 ? 45 : 325, 9);
        if (behavior.malformed) response[8] = 7;
        if (behavior.fragmented) {
          socket.write(response.subarray(0, 8));
          setTimeout(() => { if (!socket.destroyed) socket.write(response.subarray(8)); }, 5);
        } else socket.write(response);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dataDir = mkdtempSync(join(tmpdir(), 'nibe-test-'));
  const env = { ...process.env, NIBE_HOST: '127.0.0.1', NIBE_PORT: String(server.address().port), NIBE_UNIT_ID: '7', NIBE_DATA_DIR: dataDir, NIBE_SAMPLE_SECONDS: '1' };
  const c = config(env);
  const service = new NibeService(c);
  return { server, requests, behavior, c, env, service, async cleanup() {
    await service.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(dirname(c.socketPath), { recursive: true, force: true });
  } };
}
