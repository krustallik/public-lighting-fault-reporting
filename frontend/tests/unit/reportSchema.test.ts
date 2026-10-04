import { describe, expect, it } from 'vitest';
import {
  createReportFilesSchema,
  createReportFormSchema,
  createReportFormStep1Schema,
} from '../../src/schemas/reportSchema';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';

const messages = getReportFormMessages('en');

const validForm = {
  locality: 'Hlavná',
  detailDescription: '',
  locationBlock: '',
  faultType: '',
  otherFaultText: '',
  phone: '+421951449039',
  email: 'resident@example.test',
  consent: true,
};

function fileWithSize(size: number): File {
  const file = new File(['x'], 'synthetic.bin', { type: 'application/octet-stream' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('service-2 VO report schemas', () => {
  it('accepts a valid locality and preserves blank optional VO choices', () => {
    expect(createReportFormSchema(messages).safeParse(validForm).success).toBe(true);
  });

  it('requires a locality, a valid email, consent, and a phone contact', () => {
    const schema = createReportFormSchema(messages);
    expect(schema.safeParse({ ...validForm, locality: '  ' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, consent: false }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, phone: '' }).success).toBe(false);
  });

  it('requires the public telephone contact before leaving the VO form step', () => {
    const step1 = createReportFormStep1Schema(messages);
    expect(step1.safeParse(validForm).success).toBe(true);
    expect(step1.safeParse({ ...validForm, phone: '' }).success).toBe(false);
  });

  it('accepts only the public VO codes when optional values are selected', () => {
    const schema = createReportFormSchema(messages);
    expect(schema.safeParse({ ...validForm, locationBlock: 'Q10', faultType: 'Q99' }).success)
      .toBe(true);
    expect(schema.safeParse({ ...validForm, locationBlock: 'Q8' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, faultType: 'Q5' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, faultType: 'Q20' }).success).toBe(false);
  });

  it('allows multiple files without a client-side count cap and enforces the public 30 MiB/file hint', () => {
    const schema = createReportFilesSchema(messages);
    const exactLimit = fileWithSize(30 * 1024 * 1024);
    const overLimit = fileWithSize(30 * 1024 * 1024 + 1);

    expect(schema.safeParse([exactLimit]).success).toBe(true);
    expect(schema.safeParse([overLimit]).success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 6 }, () => fileWithSize(1))).success).toBe(true);
  });
});
