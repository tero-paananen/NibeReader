import {config} from './config.js';
import {NibeService} from './service.js';

process.umask(0o077);
const service = new NibeService(config());
try {
  const command = process.argv[2];
  const output =
    command === 'status'
      ? await service.status()
      : command === 'start'
      ? await service.start()
      : command === 'stop'
      ? await service.stop()
      : command === 'live'
      ? await service.live(
          process.argv.length > 3 ? process.argv.slice(3) : undefined
        )
      : (() => {
          throw new Error(
            'Usage: node dist/cli.js status|start|stop|live [metric_id ...]'
          );
        })();
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
