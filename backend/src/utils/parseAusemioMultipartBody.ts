import {
  AUSEMIO_DEFAULT_FAULT_TYPE,
  AUSEMIO_DEFAULT_LOCATION_BLOCK,
  AUSEMIO_FIELDS,
  AUSEMIO_SUBMIT_LOCALE,
} from '../config/ausemioMapping.js';

function readField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse multipart text fields into AUSEMIO keys (with defaults for optional codes). */
export function parseAusemioMultipartBody(body: Record<string, unknown>): Record<string, string> {
  return {
    [AUSEMIO_FIELDS.service]: readField(body, AUSEMIO_FIELDS.service) || '2',
    [AUSEMIO_FIELDS.location]: readField(body, AUSEMIO_FIELDS.location),
    [AUSEMIO_FIELDS.detailDescription]: readField(body, AUSEMIO_FIELDS.detailDescription),
    [AUSEMIO_FIELDS.locationBlock]:
      readField(body, AUSEMIO_FIELDS.locationBlock) || AUSEMIO_DEFAULT_LOCATION_BLOCK,
    [AUSEMIO_FIELDS.faultType]:
      readField(body, AUSEMIO_FIELDS.faultType) || AUSEMIO_DEFAULT_FAULT_TYPE,
    [AUSEMIO_FIELDS.faultTypeCss]: readField(body, AUSEMIO_FIELDS.faultTypeCss),
    [AUSEMIO_FIELDS.pedestrianCrossing]: readField(body, AUSEMIO_FIELDS.pedestrianCrossing),
    [AUSEMIO_FIELDS.trafficSignal]: readField(body, AUSEMIO_FIELDS.trafficSignal),
    [AUSEMIO_FIELDS.otherFault]: readField(body, AUSEMIO_FIELDS.otherFault),
    [AUSEMIO_FIELDS.phone]: readField(body, AUSEMIO_FIELDS.phone),
    [AUSEMIO_FIELDS.email]: readField(body, AUSEMIO_FIELDS.email),
    [AUSEMIO_FIELDS.locale]: readField(body, AUSEMIO_FIELDS.locale) || AUSEMIO_SUBMIT_LOCALE,
  };
}
