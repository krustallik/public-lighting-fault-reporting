import { z } from 'zod';

export const streetLightSchema = z.object({
  inventoryNumber: z.string().min(1, 'Inventárne číslo je povinné'),
  latitude: z.coerce
    .number({ invalid_type_error: 'Zadajte platnú zemepisnú šírku' })
    .min(-90, 'Min -90')
    .max(90, 'Max 90'),
  longitude: z.coerce
    .number({ invalid_type_error: 'Zadajte platnú zemepisnú dĺžku' })
    .min(-180, 'Min -180')
    .max(180, 'Max 180'),
  address: z.string().optional(),
  district: z.string().optional(),
  lampType: z.string().optional(),
  status: z.enum(['active', 'inactive', 'maintenance']),
});

export type StreetLightFormValues = z.infer<typeof streetLightSchema>;
