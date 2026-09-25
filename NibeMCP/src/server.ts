import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {config} from './config.js';
import {NibeService} from './service.js';

process.umask(0o077);
const service = new NibeService(config());
const server = new McpServer(
  {name: 'nibe-mcp', version: '1.0.0'},
  {
    instructions:
      'Start history collection ONLY when the user explicitly asks to start collection. Opening this server or reading live/history data must never start collection. stop_collection only stops local logging. No tool writes to the heat pump. Report timestamps, errors, and history gaps. Requested compressor frequency is not measured speed. Do not claim register values have been checked against the pump display.',
  }
);
const ids = z.array(z.string()).min(1).max(8);
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const lifecycle = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
async function result(action: () => unknown | Promise<unknown>) {
  try {
    const output = await action();
    return {
      content: [{type: 'text' as const, text: JSON.stringify(output)}],
      structuredContent: output as Record<string, unknown>,
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
server.registerTool(
  'list_metrics',
  {
    description:
      'List supported Nibe metrics, units, register definitions and validation status. Does not connect to the pump or start collection.',
    annotations: readOnly,
  },
  () => result(() => service.listMetrics())
);
server.registerTool(
  'read_live',
  {
    description:
      'Read current Nibe values with timestamps and per-metric quality. Does not start history collection.',
    inputSchema: {metric_ids: ids.optional()},
    annotations: readOnly,
  },
  ({metric_ids}) => result(() => service.live(metric_ids))
);
server.registerTool(
  'get_status',
  {
    description:
      'Report local collector state, last poll and historical coverage without starting collection or probing the pump.',
    annotations: readOnly,
  },
  () => result(() => service.status())
);
server.registerTool(
  'read_history',
  {
    description:
      'Read stored Nibe history over [start,end), with explicit timezone timestamps. interval is bucket size in seconds; large results are automatically aggregated. Never starts collection.',
    inputSchema: {
      metric_ids: ids,
      start: z.string(),
      end: z.string(),
      interval: z.number().int().positive().optional(),
    },
    annotations: readOnly,
  },
  args => result(() => service.history(args))
);
server.registerTool(
  'start_collection',
  {
    description:
      'Start detached local history collection ONLY upon an explicit user request. Continues after Codex closes. Does not change any heat-pump setting.',
    annotations: lifecycle,
  },
  () => result(() => service.start())
);
server.registerTool(
  'stop_collection',
  {
    description:
      'Stop local history collection and preserve recorded data. Does not change any heat-pump setting.',
    annotations: lifecycle,
  },
  () => result(() => service.stop())
);
await server.connect(new StdioServerTransport());
