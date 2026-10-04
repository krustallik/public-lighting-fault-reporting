import { AUSEMIO_FIELDS } from '../config/ausemioMapping.js';

function flattenMultipartBody(body: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

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
    } else {
      flat[key] = value;
    }
  }

  return flat;
}

const LOCAL_TEXT_FIELDS = [
  AUSEMIO_FIELDS.service,
  AUSEMIO_FIELDS.location,
  AUSEMIO_FIELDS.detailDescription,
  AUSEMIO_FIELDS.locationBlock,
  AUSEMIO_FIELDS.faultType,
  AUSEMIO_FIELDS.otherFault,
  AUSEMIO_FIELDS.phone,
  AUSEMIO_FIELDS.email,
  AUSEMIO_FIELDS.locale,
] as const;

/** Parse only supplied service-2 VO text fields; optional values stay absent. */
export function parseAusemioMultipartBody(body: Record<string, unknown>): Record<string, string> {
  const flat = flattenMultipartBody(body);
  const parsed: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const field of LOCAL_TEXT_FIELDS) {
    const value = flat[field];
    if (typeof value === 'string') {
      parsed[field] = value.trim();
    }
  }

  return parsed;
}
