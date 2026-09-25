import {Socket} from 'node:net';
import modbus from 'jsmodbus';
import {requireHost, type Config} from './config.js';
import {acquireLock} from './lock.js';
import {
  decode,
  selectMetrics,
  registerCount,
  stateLabel,
  type Reading,
} from './metrics.js';

// Validate complete MBAP frames before passing them to jsmodbus's parser.
// Its older parser can throw on truncated/invalid byte counts. This reader only
// requests one or two input registers at a time.
class ReadSocket extends Socket {
  private frameBuffer = Buffer.alloc(0);
  constructor(private readonly unitId: number) {
    super();
  }
  override emit(event: string | symbol, ...args: any[]): boolean {
    if (event !== 'data') return super.emit(event, ...args);
    this.frameBuffer = Buffer.concat([this.frameBuffer, args[0]]);
    while (this.frameBuffer.length >= 7) {
      const length = this.frameBuffer.readUInt16BE(4);
      if (
        ![3, 5, 7].includes(length) ||
        this.frameBuffer.readUInt16BE(2) !== 0 ||
        this.frameBuffer[6] !== this.unitId
      ) {
        this.destroy(new Error('Malformed Modbus response header'));
        return true;
      }
      if (this.frameBuffer.length < length + 6) return true;
      const frame = this.frameBuffer.subarray(0, length + 6);
      this.frameBuffer = this.frameBuffer.subarray(length + 6);
      if (
        !(
          ([5, 7].includes(length) &&
            frame[7] === 4 &&
            frame[8] === length - 3) ||
          (length === 3 && frame[7] === 0x84)
        )
      ) {
        this.destroy(new Error('Malformed Modbus input register response'));
        return true;
      }
      try {
        super.emit(event, frame);
      } catch {
        this.destroy(new Error('Invalid Modbus response'));
        return true;
      }
    }
    return true;
  }
}

function boundedRequest<T>(
  socket: Socket,
  timeoutMs: number,
  action: () => Promise<T>
): Promise<T> {
  // jsmodbus 4 can clear an outstanding request without rejecting it on close.
  // Own the deadline and socket failure handling so no request can hang forever.
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Modbus request timed out')),
      timeoutMs
    );
    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(new Error('Modbus connection closed during request'));
    function finish(error?: unknown, value?: T) {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('close', onClose);
      error ? reject(error) : resolve(value as T);
    }
    socket.once('error', onError);
    socket.once('close', onClose);
    try {
      action().then(
        value => finish(undefined, value),
        error => finish(error)
      );
    } catch (error) {
      finish(error);
    }
  });
}

export async function readPump(c: Config, ids?: string[]): Promise<Reading[]> {
  requireHost(c);
  const selected = selectMetrics(ids);
  const release = await acquireLock(c, 'pump', 45000);
  const socket = new ReadSocket(c.unitId);
  // The library's unit ID and timeout belong in its constructor, not socket.connect().
  const client = new modbus.client.TCP(socket, c.unitId, c.timeoutMs);
  socket.on('error', () => {
    /* The connect/request promises report errors. */
  });
  const failure = (message: string): Reading[] =>
    selected.map(m => ({
      metric_id: m.id,
      timestamp: new Date().toISOString(),
      raw_value: null,
      value: null,
      unit: m.unit,
      quality: 'error',
      error: message,
    }));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Modbus connection timed out'));
      }, c.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off('error', onError);
        error ? reject(error) : resolve();
      };
      const onError = (error: Error) => finish(error);
      socket.once('error', onError);
      socket.connect({host: c.host, port: c.port}, () => finish());
    });
    const readings: Reading[] = [];
    for (const m of selected) {
      const base = {metric_id: m.id, unit: m.unit};
      try {
        const result = await boundedRequest(socket, c.timeoutMs, () =>
          client.readInputRegisters(m.register, registerCount(m))
        );
        const raw = decode(m, result.response.body.valuesAsBuffer);
        readings.push({
          ...base,
          timestamp: new Date().toISOString(),
          raw_value: raw,
          value: raw / m.divisor,
          quality: 'ok',
          label: stateLabel(m, raw / m.divisor),
        });
      } catch (error) {
        const e = error as {
          err?: string;
          message?: string;
          response?: {body?: {code?: number}};
        };
        const unavailable =
          e.err === 'ModbusException' &&
          [1, 2, 3].includes(e.response?.body?.code ?? -1);
        readings.push({
          ...base,
          timestamp: new Date().toISOString(),
          raw_value: null,
          value: null,
          quality: unavailable ? 'unavailable' : 'error',
          error: e.message ?? String(error),
        });
        if (e.err !== 'ModbusException') {
          socket.destroy();
          for (const rest of selected.slice(readings.length))
            readings.push({
              metric_id: rest.id,
              timestamp: new Date().toISOString(),
              unit: rest.unit,
              raw_value: null,
              value: null,
              quality: 'error',
              error:
                'Connection failed during this read; retry on the next request.',
            });
          break;
        }
      }
    }
    return readings;
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  } finally {
    socket.destroy();
    release();
  }
}
