import { z } from 'zod';

function coordinateSchema(label: string, minimum: number, maximum: number) {
  return z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce
      .number({ error: `Zadajte platnú zemepisnú ${label}` })
      .min(minimum, `Min ${minimum}`)
      .max(maximum, `Max ${maximum}`)
  );
}

export const streetLightSchema = z.object({
  inventoryNumber: z.string().min(1, 'Inventárne číslo je povinné'),
  externalId: z.string().optional(),
  latitude: coordinateSchema('šírku', -90, 90),
  longitude: coordinateSchema('dĺžku', -180, 180),
  address: z.string().optional(),
  district: z.string().optional(),
  lampType: z.string().optional(),
  status: z.enum(['active', 'inactive', 'maintenance']),
});

export type StreetLightFormValues = z.infer<typeof streetLightSchema>;
export type StreetLightFormInput = z.input<typeof streetLightSchema>;
