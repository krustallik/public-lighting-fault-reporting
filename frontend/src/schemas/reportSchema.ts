import { z } from 'zod';
import { MAX_REPORT_FILES } from '@/config/ausemioForm';
import type { ReportFormMessages } from '@/i18n/reportFormMessages';
import { isValidSlovakPhone } from '@/utils/slovakPhone';

export function createReportFormStep1Schema(messages: ReportFormMessages) {
  return z.object({
    streetOrLocation: z.string().trim().min(1, messages.validation.streetRequired),
    detailDescription: z.string().trim().max(2000, messages.validation.detailTooLong).optional(),
    locationBlock: z.string().trim().optional(),
    faultType: z.string().trim().optional(),
    otherFaultText: z
      .string()
      .trim()
      .max(2000, messages.validation.otherFaultTooLong)
      .optional(),
  });
}

export function createReportFormStep2Schema(messages: ReportFormMessages) {
  return z.object({
    phone: z
      .string()
      .trim()
      .optional()
      .refine((value) => isValidSlovakPhone(value ?? ''), {
        message: messages.validation.invalidPhone,
      }),
    email: z.string().trim().email(messages.validation.invalidEmail),
    consent: z.boolean().refine((value) => value, {
      message: messages.validation.consentRequired,
    }),
  });
}

export function createReportFormSchema(messages: ReportFormMessages) {
  return createReportFormStep1Schema(messages).extend(
    createReportFormStep2Schema(messages).shape
  );
}

export function createReportFilesSchema(messages: ReportFormMessages) {
  return z
    .array(z.custom<File>((value) => value instanceof File, messages.validation.invalidFile))
    .max(MAX_REPORT_FILES, messages.validation.maxFiles(MAX_REPORT_FILES));
}

export type ReportFormValues = z.infer<ReturnType<typeof createReportFormSchema>>;
export type ReportFiles = z.infer<ReturnType<typeof createReportFilesSchema>>;
