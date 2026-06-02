import {
  AUSEMIO_DEFAULT_FAULT_TYPE,
  AUSEMIO_DEFAULT_LOCATION_BLOCK,
  AUSEMIO_FIELDS,
  AUSEMIO_DEFAULT_SUBMIT_LOCALE,
} from '../config/ausemioMapping.js';

/**
 * Multer/busboy may nest `properties[typ_poruchy]` as `{ properties: { typ_poruchy: "Q1" } }`.
 * Flatten to literal AUSEMIO keys: `properties[typ_poruchy]`.
 */
function flattenMultipartBody(body: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (
      key === 'properties' &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        flat[`properties[${subKey}]`] = subValue;
      }
      continue;
    }

    flat[key] = value;
  }

  return flat;
}

function readField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse multipart text fields into AUSEMIO keys (with defaults for optional codes). */
export function parseAusemioMultipartBody(body: Record<string, unknown>): Record<string, string> {
  const flat = flattenMultipartBody(body);

  return {
    [AUSEMIO_FIELDS.service]: readField(flat, AUSEMIO_FIELDS.service) || '2',
    [AUSEMIO_FIELDS.location]: readField(flat, AUSEMIO_FIELDS.location),
    [AUSEMIO_FIELDS.detailDescription]: readField(flat, AUSEMIO_FIELDS.detailDescription),
    [AUSEMIO_FIELDS.locationBlock]:
      readField(flat, AUSEMIO_FIELDS.locationBlock) || AUSEMIO_DEFAULT_LOCATION_BLOCK,
    [AUSEMIO_FIELDS.faultType]:
      readField(flat, AUSEMIO_FIELDS.faultType) || AUSEMIO_DEFAULT_FAULT_TYPE,
    [AUSEMIO_FIELDS.faultTypeCss]: readField(flat, AUSEMIO_FIELDS.faultTypeCss),
    [AUSEMIO_FIELDS.pedestrianCrossing]: readField(flat, AUSEMIO_FIELDS.pedestrianCrossing),
    [AUSEMIO_FIELDS.trafficSignal]: readField(flat, AUSEMIO_FIELDS.trafficSignal),
    [AUSEMIO_FIELDS.otherFault]: readField(flat, AUSEMIO_FIELDS.otherFault),
    [AUSEMIO_FIELDS.phone]: readField(flat, AUSEMIO_FIELDS.phone),
    [AUSEMIO_FIELDS.email]: readField(flat, AUSEMIO_FIELDS.email),
    [AUSEMIO_FIELDS.locale]:
      readField(flat, AUSEMIO_FIELDS.locale) || AUSEMIO_DEFAULT_SUBMIT_LOCALE,
  };
}
