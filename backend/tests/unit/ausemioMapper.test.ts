import { describe, expect, it } from 'vitest';
import { mapReportToTechnicalLog } from '../../src/config/ausemioMapping.js';
import { buildAusemioDebugPayload, mapMulterFilesToAusemioMetadata } from '../../src/services/ausemioMapper.js';

describe('disabled legacy report mapping defaults', () => {
  it('keeps technical defaults explicit and does not invent an inventory association', () => {
    const log = mapReportToTechnicalLog({}, 0, 'RPT-synthetic', '2026-10-16T00:00:00.000Z', null);
    expect(log).toMatchObject({
      service: '2', faultType: '', locationBlock: '', fileCount: 0, locale: 'sk',
      testMode: true, referenceCode: 'RPT-synthetic', simulatedStatus: 201,
    });
    expect(log).not.toHaveProperty('lightPointId');
    expect(buildAusemioDebugPayload({}, []).files).toEqual([]);
  });

  it('uses a safe media type when a legacy multipart item omits it', () => {
    expect(mapMulterFilesToAusemioMetadata([
      { originalname: 'attachment.bin', size: 3, mimetype: '' } as Express.Multer.File,
    ])).toEqual([{ fieldName: 'files[]', originalName: 'attachment.bin', size: 3, mimeType: 'application/octet-stream' }]);
  });
});
