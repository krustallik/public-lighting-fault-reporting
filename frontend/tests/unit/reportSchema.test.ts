import { describe, expect, it } from 'vitest';
import {
  createReportFilesSchema,
  createReportFormSchema,
  createReportFormStep1Schema,
} from '@/schemas/reportSchema';
import { getReportFormMessages } from '@/i18n/reportFormMessages';

const messages = getReportFormMessages('en');

const validForm = {
  locality: 'Hlavná',
  detailDescription: '',
  locationBlock: '',
  faultType: '',
  otherFaultText: '',
  phone: '+421901234567',
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

  it('requires explicit international digits and rejects malformed or non-canonical locality input', () => {
    const schema = createReportFormStep1Schema(messages);
    const longDescription = 'd'.repeat(2501);
    const longOtherFault = 'o'.repeat(2501);

    expect(schema.safeParse({ ...validForm, detailDescription: longDescription }).success)
      .toBe(true);
    expect(schema.safeParse({
      ...validForm,
      faultType: 'Q99',
      otherFaultText: longOtherFault,
    }).success).toBe(true);
    expect(schema.safeParse({ ...validForm, phone: '0901234567' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, phone: '+421 901234567' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, locality: 'type something' }).success).toBe(false);
  });

  it('accepts only the public VO codes when optional values are selected', () => {
    const schema = createReportFormSchema(messages);
    expect(schema.safeParse({ ...validForm, locationBlock: 'Q10', faultType: 'Q99' }).success)
      .toBe(true);
    expect(schema.safeParse({ ...validForm, locationBlock: 'Q8' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, faultType: 'Q5' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, faultType: 'Q20' }).success).toBe(false);
  });

  it.each(['Q10', 'Q11', 'Q12'])('accepts each public location-block code %s', (locationBlock) => {
    expect(createReportFormStep1Schema(messages).safeParse({ ...validForm, locationBlock }).success)
      .toBe(true);
  });

  it.each(['Q', 'Q1', 'Q2', 'Q3', 'Q4', 'Q6', 'Q10', 'Q61', 'Q99'])
    ('accepts each public fault code %s, including the independent Q10 and Q99 choices', (faultType) => {
      expect(createReportFormStep1Schema(messages).safeParse({ ...validForm, faultType }).success)
        .toBe(true);
    });

  it.each(['Q5', 'Q8', 'Q20', '16', 'CSS', 'q10', 'Q 10'])
    ('rejects a non-public VO option value %s', (faultType) => {
      expect(createReportFormStep1Schema(messages).safeParse({ ...validForm, faultType }).success)
        .toBe(false);
    });

  it('trims required inputs and preserves arbitrary Unicode, newline, and markup-like descriptions', () => {
    const schema = createReportFormSchema(messages);
    const result = schema.safeParse({
      ...validForm,
      locality: '  Hlavná  ',
      phone: '  +421901234567  ',
      email: '  resident@example.test  ',
      detailDescription: 'Poznámka 🟡 e\u0301\n<script>synthetic</script>',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locality).toBe('Hlavná');
      expect(result.data.phone).toBe('+421901234567');
      expect(result.data.email).toBe('resident@example.test');
      expect(result.data.detailDescription).toBe('Poznámka 🟡 e\u0301\n<script>synthetic</script>');
    }
  });

  it('allows multiple files without a client-side count cap and enforces the public 30 MiB/file hint', () => {
    const schema = createReportFilesSchema(messages);
    const exactLimit = fileWithSize(30 * 1024 * 1024);
    const overLimit = fileWithSize(30 * 1024 * 1024 + 1);

    expect(schema.safeParse([exactLimit]).success).toBe(true);
    expect(schema.safeParse([overLimit]).success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 6 }, () => fileWithSize(1))).success).toBe(true);
    expect(schema.safeParse([new File([], 'empty.unknown', { type: 'application/x-synthetic' })]).success)
      .toBe(true);
  });
});
