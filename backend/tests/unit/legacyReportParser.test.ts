import { describe, expect, it, vi } from 'vitest';
import { parseAusemioMultipartBody } from '../../src/utils/parseAusemioMultipartBody.js';
import { sendFaultReport } from '../../src/services/reports.service.js';
import { sendReportToExternalSystem } from '../../src/services/aussemio.service.js';

vi.mock('../../src/services/aussemio.service.js', () => ({
  sendReportToExternalSystem: vi.fn().mockResolvedValue({
    referenceCode: 'RPT-LEGACY-TEST',
    ausemioPayload: { fields: [], files: [] },
  }),
}));
vi.mock('../../src/services/lightPoints.service.js', () => ({
  getLightPointById: vi.fn(),
}));

describe('legacy report parser and service semantics', () => {
  it('preserves pre-P4a defaults and legacy CSS placeholder fields', () => {
    expect(parseAusemioMultipartBody({})).toMatchObject({
      'properties[vyber_sluzby]': '2',
      'properties[lokalizacia_blok]': 'Q10',
      'properties[typ_poruchy]': 'Q',
      'properties[typ_poruchy_css]': '',
      'properties[porucha_na_prechode_pre_chodcov]': '',
      'properties[porucha_na_cestnej_svetelnej_signalizacii]': '',
      locale: 'sk',
    });
  });

  it('keeps legacy optional-code defaults, historic code validation, and optional phone behavior', async () => {
    const result = await sendFaultReport({
      'properties[vyber_sluzby]': '2',
      'properties[ulica_miesto_poruchy_lokalita]': 'Synthetic locality',
      email: 'synthetic@example.test',
      locale: 'sk',
    }, []);

    expect(result.status).toBe('simulated');
    expect(vi.mocked(sendReportToExternalSystem)).toHaveBeenCalledWith(
      expect.objectContaining({
        'properties[lokalizacia_blok]': 'Q10',
        'properties[typ_poruchy]': 'Q',
      }),
      0,
      null,
      expect.anything()
    );

    await expect(sendFaultReport({
      'properties[vyber_sluzby]': '2',
      'properties[ulica_miesto_poruchy_lokalita]': 'Synthetic locality',
      'properties[lokalizacia_blok]': 'Q9',
      'properties[typ_poruchy]': 'Q5',
      email: 'synthetic@example.test',
      locale: 'sk',
    }, [])).resolves.toMatchObject({ status: 'simulated' });
  });
});
