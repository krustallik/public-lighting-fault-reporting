import { describe, expect, it } from 'vitest';
import { buildReportFormData } from '../../src/utils/buildReportFormData';
import type { ReportFormValues } from '../../src/schemas/reportSchema';

const validValues: ReportFormValues = {
  locality: '  Hlavná  ',
  detailDescription: '  Svietidlo bliká  ',
  locationBlock: 'Q11',
  faultType: 'Q10',
  otherFaultText: 'stale hidden value',
  phone: '+421951449039',
  email: ' resident@example.test ',
  consent: true,
};

describe('buildReportFormData for the local service-2 VO sink', () => {
  it('emits only literal VO fields, omits CSS and stale conditional data, and preserves selected public codes', () => {
    const data = buildReportFormData(validValues, [], 'sk');

    expect(Array.from(data.keys())).toEqual([
      'properties[vyber_sluzby]',
      'properties[ulica_miesto_poruchy_lokalita]',
      'properties[detail_decription]',
      'properties[lokalizacia_blok]',
      'properties[typ_poruchy]',
      'properties[tel_cislo]',
      'email',
      'locale',
    ]);
    expect(data.get('properties[vyber_sluzby]')).toBe('2');
    expect(data.get('properties[ulica_miesto_poruchy_lokalita]')).toBe('Hlavná');
    expect(data.get('properties[detail_decription]')).toBe('Svietidlo bliká');
    expect(data.get('properties[lokalizacia_blok]')).toBe('Q11');
    expect(data.get('properties[typ_poruchy]')).toBe('Q10');
    expect(data.get('properties[tel_cislo]')).toBe('+421951449039');
    expect(data.get('email')).toBe('resident@example.test');
    expect(data.get('locale')).toBe('sk');
    expect(Array.from(data.keys()).some((key) => key.includes('css') || key.includes('prechode')))
      .toBe(false);
    expect(data.has('properties[iny_druh_poruchy]')).toBe(false);
    expect(data.has('consent')).toBe(false);
    expect(data.has('lightPointId')).toBe(false);
  });

  it('keeps blank optional block/fault absent instead of applying Q10/Q defaults', () => {
    const data = buildReportFormData(
      { ...validValues, detailDescription: ' ', locationBlock: '', faultType: '', otherFaultText: '' },
      [],
      'en'
    );

    expect(data.get('properties[vyber_sluzby]')).toBe('2');
    expect(data.has('properties[detail_decription]')).toBe(false);
    expect(data.has('properties[lokalizacia_blok]')).toBe(false);
    expect(data.has('properties[typ_poruchy]')).toBe(false);
    expect(data.has('properties[iny_druh_poruchy]')).toBe(false);
    expect(data.get('locale')).toBe('en');
  });

  it('includes other-fault text only for selected Q99 and appends repeated files[]', () => {
    const first = new File(['one'], 'one.bin', { type: 'application/octet-stream' });
    const second = new File(['two'], 'two.bin', { type: 'application/octet-stream' });
    const data = buildReportFormData(
      { ...validValues, faultType: 'Q99', otherFaultText: '  Damaged cable  ' },
      [first, second],
      'en'
    );

    expect(data.get('properties[typ_poruchy]')).toBe('Q99');
    expect(data.get('properties[iny_druh_poruchy]')).toBe('Damaged cable');
    expect(data.getAll('files[]')).toHaveLength(2);
    expect((data.getAll('files[]')[0] as File).name).toBe('one.bin');
    expect((data.getAll('files[]')[1] as File).name).toBe('two.bin');
  });
});
