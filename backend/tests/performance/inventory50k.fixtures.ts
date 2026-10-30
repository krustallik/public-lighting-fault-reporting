export interface SyntheticInventoryRecord {
  inventory_number: string;
  external_id?: string;
  latitude: number;
  longitude: number;
  address?: string;
  district?: string;
  lamp_type?: string;
  status?: 'active' | 'inactive' | 'maintenance';
}

const STREETS = ['Hlavná', 'Mäsiarska', 'Štúrova', 'Južná trieda', 'Trieda SNP', 'Ťahanovská', 'Kováčska', 'Námestie osloboditeľov'];
const DISTRICTS = ['Staré Mesto', 'Sídlisko Ťahanovce', 'Západ', 'Dargovských hrdinov', 'Juh', 'Nad jazerom', 'KVP', 'Šaca'];
const LAMP_TYPES = ['LED 24 W', 'LED 36 W', 'Sodíková 70 W', 'Sodíková 100 W', 'Výbojková 150 W'];
const STATUSES = ['active', 'inactive', 'maintenance'] as const;

function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

/** Deterministic, synthetic Košice inventory. Optional fields are omitted on a stable pattern. */
export function generateSyntheticInventory(count = 50_000, seed = 20261030, prefix = 'BENCH50K'): SyntheticInventoryRecord[] {
  const random = randomFor(seed);
  return Array.from({ length: count }, (_, index) => {
    const record: SyntheticInventoryRecord = {
      inventory_number: `${prefix}-${String(index + 1).padStart(5, '0')}`,
      latitude: Number((48.62 + random() * 0.17).toFixed(7)),
      longitude: Number((21.13 + random() * 0.19).toFixed(7)),
      status: STATUSES[index % STATUSES.length],
    };
    if (index % 13 !== 0) record.external_id = `VO-${String(index + 10_000).padStart(6, '0')}`;
    if (index % 17 !== 0) record.address = `${STREETS[index % STREETS.length]} ${1 + index % 240}, Košice`;
    if (index % 19 !== 0) record.district = DISTRICTS[index % DISTRICTS.length];
    if (index % 11 !== 0) record.lamp_type = LAMP_TYPES[index % LAMP_TYPES.length];
    return record;
  });
}

function csvField(value: unknown): string {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type InventoryImportFormat = 'csv' | 'json' | 'geojson';

export function serializeSyntheticInventory(records: SyntheticInventoryRecord[], format: InventoryImportFormat): Buffer {
  if (format === 'csv') {
    const headers = ['inventory_number', 'external_id', 'latitude', 'longitude', 'address', 'district', 'lamp_type', 'status'];
    return Buffer.from([headers.join(','), ...records.map((record) => headers.map((header) => csvField(record[header as keyof SyntheticInventoryRecord])).join(','))].join('\r\n'), 'utf8');
  }
  if (format === 'json') return Buffer.from(JSON.stringify(records), 'utf8');
  return Buffer.from(JSON.stringify({
    type: 'FeatureCollection',
    features: records.map(({ latitude, longitude, ...properties }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties,
    })),
  }), 'utf8');
}

export function importMimeType(format: InventoryImportFormat): string {
  return format === 'csv' ? 'text/csv' : format === 'geojson' ? 'application/geo+json' : 'application/json';
}
