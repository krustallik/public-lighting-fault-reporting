import { describe, expect, it } from 'vitest';
import { buildReportFormData } from '@/utils/buildReportFormData';
import type { ReportFormValues } from '@/schemas/reportSchema';

const validValues: ReportFormValues = {
  locality: '  Hlavná  ',
  detailDescription: '  Svietidlo bliká  ',
  locationBlock: 'Q11',
  faultType: 'Q10',
  otherFaultText: 'stale hidden value',
  phone: '+421901234567',
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
    expect(data.get('properties[tel_cislo]')).toBe('+421901234567');
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

  it('preserves international phone bytes and never infers a Slovak prefix', () => {
    const data = buildReportFormData({ ...validValues, phone: '0901234567' }, [], 'en');
    expect(data.get('properties[tel_cislo]')).toBe('0901234567');
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

  it.each([
    ['Q10', 'Q'],
    ['Q11', 'Q1'],
    ['Q12', 'Q2'],
  ])('preserves independent block/fault code values %s / %s without treating Q10 as shared meaning', (block, fault) => {
    const data = buildReportFormData(
      { ...validValues, locationBlock: block, faultType: fault, otherFaultText: '' },
      [],
      'sk'
    );

    expect(data.get('properties[lokalizacia_blok]')).toBe(block);
    expect(data.get('properties[typ_poruchy]')).toBe(fault);
    expect(data.has('properties[iny_druh_poruchy]')).toBe(false);
  });

  it.each(['Q', 'Q1', 'Q2', 'Q3', 'Q4', 'Q6', 'Q10', 'Q61', 'Q99'])
    ('serializes the selected public VO fault code %s literally', (faultType) => {
      const data = buildReportFormData(
        { ...validValues, faultType, otherFaultText: faultType === 'Q99' ? 'synthetic detail' : '' },
        [],
        'en'
      );

      expect(data.get('properties[typ_poruchy]')).toBe(faultType);
      expect(data.get('properties[vyber_sluzby]')).toBe('2');
      expect(data.get('locale')).toBe('en');
      expect(data.has('properties[iny_druh_poruchy]')).toBe(faultType === 'Q99');
    });

  it('preserves each repeated file object, order, and metadata in the multipart payload', () => {
    const files = [
      new File(['one'], 'first.png', { type: 'image/png', lastModified: 101 }),
      new File(['two-two'], 'second.dat', { type: 'application/x-synthetic', lastModified: 202 }),
      new File([], 'zero.bin', { type: 'application/octet-stream', lastModified: 303 }),
    ];
    const data = buildReportFormData(validValues, files, 'sk');
    const serialized = data.getAll('files[]') as File[];

    expect(serialized.map(({ name, type, size, lastModified }) => ({ name, type, size, lastModified })))
      .toEqual([
        { name: 'first.png', type: 'image/png', size: 3, lastModified: 101 },
        { name: 'second.dat', type: 'application/x-synthetic', size: 7, lastModified: 202 },
        { name: 'zero.bin', type: 'application/octet-stream', size: 0, lastModified: 303 },
      ]);
  });
});
