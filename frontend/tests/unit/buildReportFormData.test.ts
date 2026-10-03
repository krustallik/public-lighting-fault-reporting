import { describe, expect, it } from 'vitest';
import { AUSEMIO_FIELDS } from '../../src/config/ausemioForm';
import { buildReportFormData } from '../../src/utils/buildReportFormData';
import type { ReportFormValues } from '../../src/schemas/reportSchema';

const validValues: ReportFormValues = {
  streetOrLocation: '  Hlavná 1  ',
  detailDescription: '  Svietidlo bliká  ',
  locationBlock: '',
  faultType: '',
  otherFaultText: '  detail  ',
  phone: '0951449039',
  email: ' resident@example.test ',
  consent: true,
};

describe('buildReportFormData', () => {
  it('uses current AUSEMIO keys, trims values, applies defaults, and omits app-only consent', () => {
    const data = buildReportFormData(validValues, [], 'sk');

    expect(data.get(AUSEMIO_FIELDS.service)).toBe('2');
    expect(data.get(AUSEMIO_FIELDS.location)).toBe('Hlavná 1');
    expect(data.get(AUSEMIO_FIELDS.detailDescription)).toBe('Svietidlo bliká');
    expect(data.get(AUSEMIO_FIELDS.locationBlock)).toBe('Q10');
    expect(data.get(AUSEMIO_FIELDS.faultType)).toBe('Q');
    expect(data.get(AUSEMIO_FIELDS.otherFault)).toBe('detail');
    expect(data.get(AUSEMIO_FIELDS.phone)).toBe('+421951449039');
    expect(data.get(AUSEMIO_FIELDS.email)).toBe('resident@example.test');
    expect(data.get(AUSEMIO_FIELDS.locale)).toBe('sk');
    expect(data.get(AUSEMIO_FIELDS.faultTypeCss)).toBe('');
    expect(data.get(AUSEMIO_FIELDS.pedestrianCrossing)).toBe('');
    expect(data.get(AUSEMIO_FIELDS.trafficSignal)).toBe('');
    expect(data.has('consent')).toBe(false);
    expect(data.has('lightPointId')).toBe(false);
  });

  it('appends each file using the current repeated file key', () => {
    const first = new File(['one'], 'one.png', { type: 'image/png' });
    const second = new File(['two'], 'two.png', { type: 'image/png' });
    const data = buildReportFormData(validValues, [first, second], 'en');

    expect(data.getAll(AUSEMIO_FIELDS.files)).toHaveLength(2);
    expect((data.getAll(AUSEMIO_FIELDS.files)[0] as File).name).toBe('one.png');
    expect((data.getAll(AUSEMIO_FIELDS.files)[1] as File).name).toBe('two.png');
    expect(data.get(AUSEMIO_FIELDS.locale)).toBe('en');
  });
});
