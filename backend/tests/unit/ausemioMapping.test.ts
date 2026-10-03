import { describe, expect, it } from 'vitest';
import {
  AUSEMIO_FIELDS,
  isValidSubmitLocale,
  mapReportToTechnicalLog,
} from '../../src/config/ausemioMapping.js';
import {
  isValidFaultType,
  isValidLocationBlock,
} from '../../src/config/ausemioFormOptions.js';
import { parseAusemioMultipartBody } from '../../src/utils/parseAusemioMultipartBody.js';

describe('current local AUSEMIO field mapping', () => {
  it('retains the current local field key spellings', () => {
    expect(AUSEMIO_FIELDS.service).toBe('properties[vyber_sluzby]');
    expect(AUSEMIO_FIELDS.location).toBe('properties[ulica_miesto_poruchy_lokalita]');
    expect(AUSEMIO_FIELDS.detailDescription).toBe('properties[detail_decription]');
    expect(AUSEMIO_FIELDS.files).toBe('files[]');
    expect(AUSEMIO_FIELDS.email).toBe('email');
  });

  it('flattens nested multipart properties and supplies current defaults', () => {
    const parsed = parseAusemioMultipartBody({
      properties: {
        vyber_sluzby: '2',
        ulica_miesto_poruchy_lokalita: '  Hlavná 1  ',
      },
      email: ' reporter@example.test ',
    });

    expect(parsed[AUSEMIO_FIELDS.service]).toBe('2');
    expect(parsed[AUSEMIO_FIELDS.location]).toBe('Hlavná 1');
    expect(parsed[AUSEMIO_FIELDS.locationBlock]).toBe('Q10');
    expect(parsed[AUSEMIO_FIELDS.faultType]).toBe('Q');
    expect(parsed[AUSEMIO_FIELDS.locale]).toBe('sk');
    expect(parsed[AUSEMIO_FIELDS.email]).toBe('reporter@example.test');
  });

  it('accepts only the currently configured local code sets and locales', () => {
    expect(isValidFaultType('Q1')).toBe(true);
    expect(isValidFaultType('Q')).toBe(true);
    expect(isValidFaultType('Q99')).toBe(false);
    expect(isValidLocationBlock('Q8')).toBe(true);
    expect(isValidLocationBlock('Q11')).toBe(false);
    expect(isValidSubmitLocale('sk')).toBe(true);
    expect(isValidSubmitLocale('en')).toBe(true);
    expect(isValidSubmitLocale('de')).toBe(false);
  });

  it('projects technical log data without copying contact/location fields', () => {
    const log = mapReportToTechnicalLog(
      {
        [AUSEMIO_FIELDS.service]: '2',
        [AUSEMIO_FIELDS.faultType]: 'Q1',
        [AUSEMIO_FIELDS.locationBlock]: 'Q10',
        [AUSEMIO_FIELDS.locale]: 'sk',
        [AUSEMIO_FIELDS.email]: 'synthetic@example.test',
        [AUSEMIO_FIELDS.phone]: '+421951449039',
        [AUSEMIO_FIELDS.location]: 'Synthetic street',
      },
      2,
      'RPT-SYNTHETIC',
      '2026-10-03T00:00:00.000Z',
      12
    );

    expect(log).toEqual({
      service: '2',
      faultType: 'Q1',
      locationBlock: 'Q10',
      fileCount: 2,
      locale: 'sk',
      testMode: true,
      referenceCode: 'RPT-SYNTHETIC',
      timestamp: '2026-10-03T00:00:00.000Z',
      simulatedStatus: 201,
      lightPointId: 12,
    });
    expect(log).not.toHaveProperty('email');
    expect(log).not.toHaveProperty('phone');
    expect(log).not.toHaveProperty('location');
  });
});
