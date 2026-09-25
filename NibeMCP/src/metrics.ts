export interface Metric {
  id: string;
  name: string;
  register: number;
  divisor: number;
  unit: string;
  signed: boolean;
  encoding?: 'u8' | 's32';
  labels?: Record<number, string>;
}
export const metrics: readonly Metric[] = [
  {
    id: 'outdoor_temperature',
    name: 'Outdoor temperature (BT1)',
    register: 1,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'supply_temperature',
    name: 'Supply temperature (BT2)',
    register: 5,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'return_temperature',
    name: 'Return temperature (BT3)',
    register: 7,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'hot_water_top_temperature',
    name: 'Hot-water top (BT7)',
    register: 8,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'hot_water_charging_temperature',
    name: 'Hot-water charging (BT6)',
    register: 9,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'brine_inlet_temperature',
    name: 'Brine inlet (BT10)',
    register: 10,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'brine_outlet_temperature',
    name: 'Brine outlet (BT11)',
    register: 11,
    divisor: 10,
    unit: '°C',
    signed: true,
  },
  {
    id: 'requested_compressor_frequency',
    name: 'Requested compressor frequency (not measured speed)',
    register: 140,
    divisor: 1,
    unit: 'Hz',
    signed: false,
  },
  {
    id: 'active_alarm',
    name: 'Active alarm',
    register: 2195,
    divisor: 1,
    unit: '',
    signed: false,
    encoding: 'u8',
    labels: {0: 'No alarm', 1: 'Active alarm'},
  },
  {
    id: 'alarm_number',
    name: 'Reported alarm number',
    register: 1975,
    divisor: 1,
    unit: '',
    signed: false,
  },
  {
    id: 'operating_priority',
    name: 'Operating priority',
    register: 1028,
    divisor: 1,
    unit: '',
    signed: false,
    encoding: 'u8',
    labels: {
      10: 'Off',
      20: 'Hot water',
      30: 'Heating',
      40: 'Pool',
      60: 'Cooling',
    },
  },
  {
    id: 'actual_compressor_frequency',
    name: 'Actual compressor frequency',
    register: 1046,
    divisor: 10,
    unit: 'Hz',
    signed: false,
  },
  {
    id: 'compressor_status',
    name: 'Compressor status',
    register: 1100,
    divisor: 1,
    unit: '',
    signed: false,
    encoding: 'u8',
    labels: {0: 'Off', 1: 'On'},
  },
  {
    id: 'compressor_starts',
    name: 'Total compressor starts',
    register: 1083,
    divisor: 1,
    unit: 'starts',
    signed: true,
    encoding: 's32',
  },
  {
    id: 'compressor_runtime',
    name: 'Total compressor runtime',
    register: 1087,
    divisor: 1,
    unit: 'h',
    signed: true,
    encoding: 's32',
  },
];
export const healthMetricIds = metrics.slice(8).map(m => m.id);
export const registerCount = (metric: Metric) =>
  metric.encoding === 's32' ? 2 : 1;
export function stateLabel(metric: Metric, value: number): string | undefined {
  return metric.labels
    ? metric.labels[value] ?? `Unknown (${value})`
    : undefined;
}
export interface Reading {
  metric_id: string;
  timestamp: string;
  raw_value: number | null;
  value: number | null;
  unit: string;
  quality: 'ok' | 'unavailable' | 'error';
  error?: string;
  label?: string;
}
export function selectMetrics(ids?: string[]): readonly Metric[] {
  if (ids === undefined) return metrics;
  if (
    !ids.length ||
    ids.length > metrics.length ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`Provide 1–${metrics.length} distinct metric IDs.`);
  return ids.map(id => {
    const metric = metrics.find(m => m.id === id);
    if (!metric) throw new Error(`Unknown metric: ${id}`);
    return metric;
  });
}
export function decode(metric: Metric, bytes: Buffer): number {
  const expected = registerCount(metric) * 2;
  if (bytes.length !== expected)
    throw new Error(
      `Malformed register response: expected ${expected} bytes, received ${bytes.length}`
    );
  // NIBE sends the low 16-bit word first; bytes within each word are big endian.
  if (metric.encoding === 's32')
    return (bytes.readUInt16BE(2) << 16) | bytes.readUInt16BE(0);
  if (metric.encoding === 'u8' && bytes.readUInt16BE() > 255)
    throw new Error('Invalid u8 register value');
  return metric.signed ? bytes.readInt16BE() : bytes.readUInt16BE();
}
