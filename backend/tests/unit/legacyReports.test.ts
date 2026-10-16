import { afterEach, describe, expect, it, vi } from 'vitest';

const { poolQuery, getLightPointById } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getLightPointById: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({ pool: { query: poolQuery } }));
vi.mock('../../src/services/lightPoints.service.js', () => ({ getLightPointById }));

import { AUSEMIO_FIELDS } from '../../src/config/ausemioMapping.js';
import { sendFaultReport } from '../../src/services/reports.service.js';

function reportBody(overrides: Record<string, string> = {}) {
  return {
    email: 'resident@example.test',
    locale: 'en',
    properties: {
      vyber_sluzby: '2',
      ulica_miesto_poruchy_lokalita: 'Map selected location',
      detail_decription: '  damaged lamp  ',
      lokalizacia_blok: 'Q10',
      typ_poruchy: 'Q1',
      tel_cislo: '+421911222333',
      ...overrides,
    },
  };
}

function appError(status: number, message: string) {
  return { status, message };
}

afterEach(() => {
  poolQuery.mockReset().mockResolvedValue({ rows: [] });
  getLightPointById.mockReset().mockResolvedValue(null);
  vi.restoreAllMocks();
});

describe('disabled legacy report service local simulation', () => {
  it('validates VO fields, uses the selected inventory address, normalizes phone, and stores only technical metadata', async () => {
    getLightPointById.mockResolvedValue({ id: 12, address: 'Database street 4' });
    const upload = {
      originalname: 'lamp.png', size: 21, mimetype: 'image/png',
    } as Express.Multer.File;

    const result = await sendFaultReport(reportBody(), [upload], 12);

    expect(result).toMatchObject({ status: 'simulated', ausemioPayload: {
      testMode: true,
      fields: {
        [AUSEMIO_FIELDS.location]: 'Database street 4',
        [AUSEMIO_FIELDS.phone]: '+421911222333',
        [AUSEMIO_FIELDS.detailDescription]: expect.stringContaining('damaged lamp'),
      },
      files: [{ fieldName: 'files[]', originalName: 'lamp.png', size: 21, mimeType: 'image/png' }],
    } });
    expect(poolQuery).toHaveBeenCalledOnce();
    const parameters = poolQuery.mock.calls[0][1] as unknown[];
    const technicalLog = JSON.parse(String(parameters[2]));
    expect(technicalLog).toMatchObject({ service: '2', faultType: 'Q1', fileCount: 1, testMode: true, lightPointId: 12 });
    expect(JSON.stringify(technicalLog)).not.toContain('resident@example.test');
    expect(JSON.stringify(technicalLog)).not.toContain('Database street 4');
    expect(JSON.stringify(technicalLog)).not.toContain('+421911222333');
  });

  it.each([
    ['CSS service is outside scope', { vyber_sluzby: '16' }, 'Invalid service — only VO (2) is supported'],
    ['unknown location block', { lokalizacia_blok: 'Q1' }, 'Invalid location block'],
    ['unknown fault type', { typ_poruchy: 'CSS1' }, 'Invalid fault type'],
    ['invalid phone', { tel_cislo: 'not a phone' }, 'Invalid phone number — use +421XXXXXXXXX, 421XXXXXXXXX, or 0XXXXXXXXX'],
    ['missing email', { email: '' }, 'Email is required'],
    ['invalid email', { email: 'not-an-email' }, 'Invalid email address'],
    ['unsupported locale', { locale: 'de' }, 'Invalid locale — only "sk" and "en" are supported'],
  ])('rejects %s before attempting the local integration sink', async (_scenario, values, message) => {
    const { email, locale, ...properties } = values as Record<string, string>;
    await expect(sendFaultReport({ ...reportBody(properties), ...(email === undefined ? {} : { email }), ...(locale === undefined ? {} : { locale }) }, []))
      .rejects.toMatchObject(appError(400, message));
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('rejects missing selected inventory rows, missing free-text location, and more than five attachments', async () => {
    await expect(sendFaultReport(reportBody(), [], 999)).rejects.toMatchObject(appError(400, 'Selected light point not found'));
    await expect(sendFaultReport(reportBody({ ulica_miesto_poruchy_lokalita: '' }), []))
      .rejects.toMatchObject(appError(400, 'Street or location is required'));
    await expect(sendFaultReport(reportBody(), Array.from({ length: 6 }, () => ({} as Express.Multer.File))))
      .rejects.toMatchObject(appError(400, 'Maximum 5 files allowed'));
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('keeps the local simulated response available when optional technical logging fails', async () => {
    poolQuery.mockRejectedValueOnce(new Error('synthetic database logging failure'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(sendFaultReport(reportBody(), [])).resolves.toMatchObject({ status: 'simulated' });
    expect(warning).toHaveBeenCalledWith('Could not write the simulated integration log');
  });
});
