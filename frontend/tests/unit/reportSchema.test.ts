import { describe, expect, it } from 'vitest';
import { createReportFilesSchema, createReportFormSchema } from '../../src/schemas/reportSchema';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';

const messages = getReportFormMessages('en');

const validForm = {
  streetOrLocation: 'Hlavná 1',
  detailDescription: '',
  locationBlock: '',
  faultType: '',
  otherFaultText: '',
  phone: '',
  email: 'resident@example.test',
  consent: true,
};

describe('current public report schemas', () => {
  it('accepts the current valid form with an omitted optional phone', () => {
    expect(createReportFormSchema(messages).safeParse(validForm).success).toBe(true);
  });

  it('requires location, a valid email, and consent', () => {
    const schema = createReportFormSchema(messages);
    expect(schema.safeParse({ ...validForm, streetOrLocation: '  ' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, consent: false }).success).toBe(false);
  });

  it('allows an empty optional phone but rejects an invalid non-empty phone', () => {
    const schema = createReportFormSchema(messages);
    expect(schema.safeParse({ ...validForm, phone: '' }).success).toBe(true);
    expect(schema.safeParse({ ...validForm, phone: '12345' }).success).toBe(false);
  });

  it('enforces the current five-file limit', () => {
    const file = () => new File(['x'], 'fault.png', { type: 'image/png' });
    const schema = createReportFilesSchema(messages);
    expect(schema.safeParse([file(), file(), file(), file(), file()]).success).toBe(true);
    expect(schema.safeParse([file(), file(), file(), file(), file(), file()]).success).toBe(false);
  });
});
