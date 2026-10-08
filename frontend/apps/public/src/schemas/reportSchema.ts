import { z } from 'zod';
import {
  AUSEMIO_FAULT_TYPE_OTHER,
  AUSEMIO_PUBLIC_FILE_MAX_BYTES,
} from '@/config/ausemioForm';
import { AUSEMIO_VO_LOCALITIES } from '@/config/data/ausemioVoLocalities.generated';
import {
  REPORT_FAULT_TYPE_CODES,
  REPORT_LOCATION_BLOCK_CODES,
} from '@/config/reportFormOptions';
import type { ReportFormMessages } from '@/i18n/reportFormMessages';
import { isValidInternationalPhone } from '@/utils/slovakPhone';

const validLocalities = new Set<string>(AUSEMIO_VO_LOCALITIES.map(({ value }) => value));
const validBlockCodes = new Set<string>(REPORT_LOCATION_BLOCK_CODES);
const validFaultCodes = new Set<string>(REPORT_FAULT_TYPE_CODES);

export function createReportFormStep1Schema(messages: ReportFormMessages) {
  return z.object({
    locality: z
      .string()
      .trim()
      .min(1, messages.validation.localityChooseCanonical)
      .refine((value) => validLocalities.has(value), messages.validation.localityChooseCanonical),
    detailDescription: z.string().trim().optional(),
    locationBlock: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || validBlockCodes.has(value), messages.validation.invalidOption),
    faultType: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || validFaultCodes.has(value), messages.validation.invalidOption),
    otherFaultText: z.string().trim().optional(),
    phone: z
      .string()
      .trim()
      .min(1, messages.validation.invalidPhone)
      .refine(isValidInternationalPhone, messages.validation.invalidPhone),
  });
}

export function createReportFormStep2Schema(messages: ReportFormMessages) {
  return z.object({
    email: z.string().trim().email(messages.validation.invalidEmail),
    consent: z.boolean().refine((value) => value, {
      message: messages.validation.consentRequired,
    }),
  });
}

export function createReportFormSchema(messages: ReportFormMessages) {
  return createReportFormStep1Schema(messages).extend(createReportFormStep2Schema(messages).shape);
}

export function createReportFilesSchema(messages: ReportFormMessages) {
  return z
    .array(z.custom<File>((value) => typeof File !== 'undefined' && value instanceof File, messages.validation.invalidFile))
    .superRefine((files, context) => {
      for (const [index, file] of files.entries()) {
        if (file.size > AUSEMIO_PUBLIC_FILE_MAX_BYTES) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: messages.validation.maxFileSize(30),
          });
        }
      }
    });
}

export type ReportFormValues = z.infer<ReturnType<typeof createReportFormSchema>>;
export type ReportFiles = z.infer<ReturnType<typeof createReportFilesSchema>>;

export function shouldShowOtherFault(value: string | undefined): boolean {
  return value === AUSEMIO_FAULT_TYPE_OTHER;
}
