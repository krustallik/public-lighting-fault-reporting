import { describe, expect, it } from 'vitest';
import { streetLightSchema } from '../../apps/admin/src/schemas/streetLightSchema';

describe('streetLightSchema', () => {
  it('coerces admin coordinate input strings into numeric values', () => {
    const result = streetLightSchema.safeParse({
      inventoryNumber: 'SYNTHETIC-1',
      latitude: '48.7164',
      longitude: '21.2611',
      status: 'active',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(48.7164);
      expect(result.data.longitude).toBe(21.2611);
    }
  });

  it('keeps localized validation messages for non-numeric coordinates', () => {
    const result = streetLightSchema.safeParse({
      inventoryNumber: 'SYNTHETIC-1',
      latitude: 'north',
      longitude: 'east',
      status: 'active',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find(({ path }) => path[0] === 'latitude')?.message).toBe(
        'Zadajte platnú zemepisnú šírku'
      );
      expect(result.error.issues.find(({ path }) => path[0] === 'longitude')?.message).toBe(
        'Zadajte platnú zemepisnú dĺžku'
      );
    }
  });
});
