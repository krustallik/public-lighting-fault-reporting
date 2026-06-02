import { z } from 'zod';
import { MAX_REPORT_FILES } from '@/config/ausemioForm';

const reportFormStep1BaseSchema = z.object({
  streetOrLocation: z
    .string()
    .trim()
    .min(1, 'Ulica / miesto poruchy / lokalita je povinná'),
  detailDescription: z.string().trim().max(2000, 'Popis je príliš dlhý').optional(),
  locationBlock: z.string().trim().optional(),
  faultType: z.string().trim().optional(),
  otherFaultText: z.string().trim().max(2000, 'Text je príliš dlhý').optional(),
  failureOn: z.string().trim().max(500, 'Hodnota je príliš dlhá').optional(),
});

export const reportFormStep1Schema = reportFormStep1BaseSchema;

export const reportFormStep2Schema = z.object({
  phone: z.string().trim().optional(),
  email: z.string().trim().email('Neplatný e-mail'),
  consent: z.boolean().refine((value) => value, {
    message: 'Musíte súhlasiť so spracovaním osobných údajov',
  }),
});

export const reportFormSchema = reportFormStep1BaseSchema.extend(reportFormStep2Schema.shape);

export type ReportFormStep1Values = z.infer<typeof reportFormStep1BaseSchema>;
export type ReportFormStep2Values = z.infer<typeof reportFormStep2Schema>;
export type ReportFormValues = z.infer<typeof reportFormSchema>;

export const reportFilesSchema = z
  .array(z.custom<File>((value) => value instanceof File, 'Neplatný súbor'))
  .max(MAX_REPORT_FILES, `Maximálne ${MAX_REPORT_FILES} súborov`);

export type ReportFiles = z.infer<typeof reportFilesSchema>;
