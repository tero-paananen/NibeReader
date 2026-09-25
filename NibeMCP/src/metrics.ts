export const metrics = [
  { id: 'outdoor_temperature', name: 'Outdoor temperature (BT1)', register: 1, divisor: 10, unit: '°C', signed: true },
  { id: 'supply_temperature', name: 'Supply temperature (BT2)', register: 5, divisor: 10, unit: '°C', signed: true },
  { id: 'return_temperature', name: 'Return temperature (BT3)', register: 7, divisor: 10, unit: '°C', signed: true },
  { id: 'hot_water_top_temperature', name: 'Hot-water top (BT7)', register: 8, divisor: 10, unit: '°C', signed: true },
  { id: 'hot_water_charging_temperature', name: 'Hot-water charging (BT6)', register: 9, divisor: 10, unit: '°C', signed: true },
  { id: 'brine_inlet_temperature', name: 'Brine inlet (BT10)', register: 10, divisor: 10, unit: '°C', signed: true },
  { id: 'brine_outlet_temperature', name: 'Brine outlet (BT11)', register: 11, divisor: 10, unit: '°C', signed: true },
  { id: 'requested_compressor_frequency', name: 'Requested compressor frequency (not measured speed)', register: 140, divisor: 1, unit: 'Hz', signed: false },
] as const;
export type Metric = typeof metrics[number];
export interface Reading {
  metric_id: string; timestamp: string; raw_value: number | null; value: number | null;
  unit: string; quality: 'ok' | 'unavailable' | 'error'; error?: string;
}
export function selectMetrics(ids?: string[]): readonly Metric[] {
  if (ids === undefined) return metrics;
  if (!ids.length || ids.length > metrics.length || new Set(ids).size !== ids.length) throw new Error('Provide 1–8 distinct metric IDs.');
  return ids.map(id => {
    const metric = metrics.find(m => m.id === id);
    if (!metric) throw new Error(`Unknown metric: ${id}`);
    return metric;
  });
}
export function decode(metric: Metric, bytes: Buffer): number {
  if (bytes.length !== 2) throw new Error(`Malformed register response: expected 2 bytes, received ${bytes.length}`);
  return metric.signed ? bytes.readInt16BE() : bytes.readUInt16BE();
}
