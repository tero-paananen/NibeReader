import {connect} from 'node:net';
import type {Config} from './config.js';

export type Method = 'status' | 'live' | 'stop';
export interface CollectorStatus {
  metric_ids?: string[];
  running: boolean;
  pid: number;
  started_at: string;
  device: string;
  sample_seconds: number;
  retention_days: number;
  stopping: boolean;
  last_poll: string | null;
  last_successful_sample: string | null;
  last_error: string | null;
}

export function rpc<T>(
  c: Config,
  method: Method,
  metric_ids?: string[],
  timeout = 95000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = connect(c.socketPath);
    let buffer = '',
      finished = false;
    const timer = setTimeout(
      () => finish(new Error('Collector request timed out')),
      timeout
    );
    function finish(error?: Error, result?: T) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(result as T);
    }
    socket.on('connect', () =>
      socket.write(JSON.stringify({method, metric_ids}) + '\n')
    );
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!finished) finish(new Error('Collector closed before responding'));
    });
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024)
        return finish(new Error('Collector response too large'));
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        response.error
          ? finish(new Error(response.error))
          : finish(undefined, response.result);
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

export async function collectorStatus(
  c: Config
): Promise<CollectorStatus | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpc<CollectorStatus>(c, 'status', undefined, 2000);
    } catch (error) {
      // An unreachable socket means stopped; a responding-but-broken collector must not
      // silently be treated as stopped (especially for start and stop operations).
      if (
        ['ENOENT', 'ECONNREFUSED'].includes(
          (error as NodeJS.ErrnoException).code ?? ''
        )
      )
        return undefined;
      if (
        attempt < 2 &&
        ((error as NodeJS.ErrnoException).code === 'ECONNRESET' ||
          (error as Error).message === 'Collector closed before responding')
      ) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      throw error;
    }
  }
}
