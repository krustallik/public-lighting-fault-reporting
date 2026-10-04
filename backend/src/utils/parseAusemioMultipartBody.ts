import { AUSEMIO_FIELDS } from '../config/ausemioMapping.js';

const LEGACY_FIELDS = {
  faultTypeCss: 'properties[typ_poruchy_css]',
  pedestrianCrossing: 'properties[porucha_na_prechode_pre_chodcov]',
  trafficSignal: 'properties[porucha_na_cestnej_svetelnej_signalizacii]',
} as const;

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

/** Historical parser used only by the disabled legacy report route. */
export function parseAusemioMultipartBody(body: Record<string, unknown>): Record<string, string> {
  const flat = flattenMultipartBody(body);
  const readField = (key: string): string => {
    const value = flat[key];
    return typeof value === 'string' ? value.trim() : '';
  };

  return {
    [AUSEMIO_FIELDS.service]: readField(AUSEMIO_FIELDS.service) || '2',
    [AUSEMIO_FIELDS.location]: readField(AUSEMIO_FIELDS.location),
    [AUSEMIO_FIELDS.detailDescription]: readField(AUSEMIO_FIELDS.detailDescription),
    [AUSEMIO_FIELDS.locationBlock]: readField(AUSEMIO_FIELDS.locationBlock) || 'Q10',
    [AUSEMIO_FIELDS.faultType]: readField(AUSEMIO_FIELDS.faultType) || 'Q',
    [LEGACY_FIELDS.faultTypeCss]: readField(LEGACY_FIELDS.faultTypeCss),
    [LEGACY_FIELDS.pedestrianCrossing]: readField(LEGACY_FIELDS.pedestrianCrossing),
    [LEGACY_FIELDS.trafficSignal]: readField(LEGACY_FIELDS.trafficSignal),
    [AUSEMIO_FIELDS.otherFault]: readField(AUSEMIO_FIELDS.otherFault),
    [AUSEMIO_FIELDS.phone]: readField(AUSEMIO_FIELDS.phone),
    [AUSEMIO_FIELDS.email]: readField(AUSEMIO_FIELDS.email),
    [AUSEMIO_FIELDS.locale]: readField(AUSEMIO_FIELDS.locale) || 'sk',
  };
}
