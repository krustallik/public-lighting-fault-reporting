import { describe, expect, it } from 'vitest';
import { buildReportFormData } from '../../src/utils/buildReportFormData';
import type { ReportFormValues } from '../../src/schemas/reportSchema';

const validValues: ReportFormValues = {
  streetOrLocation: '  Test Location 001  ',
  detailDescription: '  Svietidlo bliká  ',
  locationBlock: '',
  faultType: '',
  otherFaultText: '  detail  ',
  phone: '+421000000000',
  email: ' resident@example.test ',
  consent: true,
};

describe('buildReportFormData', () => {
  it('uses current AUSEMIO keys, trims values, applies defaults, and omits app-only consent', () => {
    const data = buildReportFormData(validValues, [], 'sk');

    expect(Array.from(data.keys()).sort()).toEqual(
      [
        'properties[vyber_sluzby]',
        'properties[ulica_miesto_poruchy_lokalita]',
        'properties[detail_decription]',
        'properties[lokalizacia_blok]',
        'properties[typ_poruchy]',
        'properties[iny_druh_poruchy]',
        'properties[tel_cislo]',
        'properties[typ_poruchy_css]',
        'properties[porucha_na_prechode_pre_chodcov]',
        'properties[porucha_na_cestnej_svetelnej_signalizacii]',
        'email',
        'locale',
      ].sort()
    );
    expect(data.get('properties[vyber_sluzby]')).toBe('2');
    expect(data.get('properties[ulica_miesto_poruchy_lokalita]')).toBe('Test Location 001');
    expect(data.get('properties[detail_decription]')).toBe('Svietidlo bliká');
    expect(data.get('properties[lokalizacia_blok]')).toBe('Q10');
    expect(data.get('properties[typ_poruchy]')).toBe('Q');
    expect(data.get('properties[iny_druh_poruchy]')).toBe('detail');
    expect(data.get('properties[tel_cislo]')).toBe('+421000000000');
    expect(data.get('email')).toBe('resident@example.test');
    expect(data.get('locale')).toBe('sk');
    expect(data.get('properties[typ_poruchy_css]')).toBe('');
    expect(data.get('properties[porucha_na_prechode_pre_chodcov]')).toBe('');
    expect(data.get('properties[porucha_na_cestnej_svetelnej_signalizacii]')).toBe('');
    expect(data.has('consent')).toBe(false);
    expect(data.has('lightPointId')).toBe(false);
  });

  it('appends each file using the current repeated file key', () => {
    const first = new File(['one'], 'one.png', { type: 'image/png' });
    const second = new File(['two'], 'two.png', { type: 'image/png' });
    const data = buildReportFormData(validValues, [first, second], 'en');

    expect(data.getAll('files[]')).toHaveLength(2);
    expect((data.getAll('files[]')[0] as File).name).toBe('one.png');
    expect((data.getAll('files[]')[1] as File).name).toBe('two.png');
    expect(data.get('locale')).toBe('en');
  });
});
