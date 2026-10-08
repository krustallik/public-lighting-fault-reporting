import { z } from 'zod';

export const adminLoginSchema = z.object({
  username: z.string().min(1, 'Zadajte používateľské meno'),
  password: z.string().min(1, 'Zadajte heslo'),
});

export type AdminLoginValues = z.infer<typeof adminLoginSchema>;
