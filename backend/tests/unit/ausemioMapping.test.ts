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

describe('canonical service-2 VO field mapping', () => {
  it('retains literal public VO field key spellings', () => {
    expect(AUSEMIO_FIELDS.service).toBe('properties[vyber_sluzby]');
    expect(AUSEMIO_FIELDS.location).toBe('properties[ulica_miesto_poruchy_lokalita]');
    expect(AUSEMIO_FIELDS.detailDescription).toBe('properties[detail_decription]');
    expect(AUSEMIO_FIELDS.files).toBe('files[]');
    expect(AUSEMIO_FIELDS.email).toBe('email');
  });

  it('flattens multipart properties without manufacturing optional codes or CSS placeholders', () => {
    const parsed = parseAusemioMultipartBody({
      properties: {
        vyber_sluzby: '2',
        ulica_miesto_poruchy_lokalita: 'Spam',
      },
      email: ' reporter@example.test ',
    });

    expect(parsed[AUSEMIO_FIELDS.service]).toBe('2');
    expect(parsed[AUSEMIO_FIELDS.location]).toBe('Spam');
    expect(parsed[AUSEMIO_FIELDS.locationBlock]).toBeUndefined();
    expect(parsed[AUSEMIO_FIELDS.faultType]).toBeUndefined();
    expect(Object.keys(parsed).some((key) => key.includes('css') || key.includes('prechode')))
      .toBe(false);
    expect(parsed[AUSEMIO_FIELDS.locale]).toBeUndefined();
    expect(parsed[AUSEMIO_FIELDS.email]).toBe('reporter@example.test');
  });

  it('accepts only current public VO code sets and supported local form locales', () => {
    expect(isValidFaultType('Q')).toBe(true);
    expect(isValidFaultType('Q61')).toBe(true);
    expect(isValidFaultType('Q99')).toBe(true);
    expect(isValidFaultType('Q5')).toBe(false);
    expect(isValidFaultType('Q20')).toBe(false);
    expect(isValidLocationBlock('Q10')).toBe(true);
    expect(isValidLocationBlock('Q11')).toBe(true);
    expect(isValidLocationBlock('Q12')).toBe(true);
    expect(isValidLocationBlock('Q8')).toBe(false);
    expect(isValidSubmitLocale('sk')).toBe(true);
    expect(isValidSubmitLocale('en')).toBe(true);
    expect(isValidSubmitLocale('de')).toBe(false);
  });

  it('projects only technical log data without copying contact/location fields', () => {
    const log = mapReportToTechnicalLog(
      {
        [AUSEMIO_FIELDS.service]: '2',
        [AUSEMIO_FIELDS.faultType]: 'Q99',
        [AUSEMIO_FIELDS.locationBlock]: 'Q11',
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
      faultType: 'Q99',
      locationBlock: 'Q11',
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
