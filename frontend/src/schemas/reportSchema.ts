import { z } from 'zod';

export const reportFormSchema = z.object({
  lightPointId: z.coerce.number().int().positive('Vyberte svetelný bod'),
  faultType: z.string().min(1, 'Vyberte typ poruchy'),
  description: z
    .string()
    .min(10, 'Popis musí mať aspoň 10 znakov')
    .max(2000, 'Popis je príliš dlhý'),
  reporterName: z.string().optional(),
  reporterEmail: z
    .string()
    .email('Neplatný e-mail')
    .optional()
    .or(z.literal('')),
  reporterPhone: z.string().optional(),
});

export type ReportFormValues = z.infer<typeof reportFormSchema>;
