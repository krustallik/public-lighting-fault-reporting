import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';

export interface LightPointAddressSnapshot {
  latitude: number;
  longitude: number;
  address: string | null;
}

export type PersistLightPointAddressResult =
  | { status: 'stored' | 'existing'; address: string }
  | { status: 'coordinates_changed'; address: string | null }
  | { status: 'missing' };

export interface LightPointAddressRepository {
  findById(id: number): Promise<LightPointAddressSnapshot | null>;
  persistIfMissing(input: {
    id: number;
    latitude: number;
    longitude: number;
    address: string;
  }): Promise<PersistLightPointAddressResult>;
}

function presentAddress(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

export const postgresLightPointAddressRepository: LightPointAddressRepository = {
  async findById(id) {
    const { rows } = await pool.query<{
      latitude: string;
      longitude: string;
      address: string | null;
    }>(
      `SELECT ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude, address
         FROM light_points WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    return row ? {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      address: presentAddress(row.address),
    } : null;
  },

  async persistIfMissing(input) {
    const address = presentAddress(input.address);
    if (!address || address.length > 500) throw new Error('Invalid geocoded light-point address');

    return withTransaction(async (client) => {
      const { rows } = await client.query<{
        inventory_number: string;
        latitude: string;
        longitude: string;
        address: string | null;
      }>(
        `SELECT inventory_number, ST_Y(geom)::text AS latitude,
                ST_X(geom)::text AS longitude, address
           FROM light_points WHERE id = $1 FOR UPDATE`,
        [input.id]
      );
      const row = rows[0];
      if (!row) return { status: 'missing' };

      const currentAddress = presentAddress(row.address);
      if (Number(row.latitude) !== input.latitude || Number(row.longitude) !== input.longitude) {
        return { status: 'coordinates_changed', address: currentAddress };
      }
      if (currentAddress) return { status: 'existing', address: currentAddress };

      const updated = await client.query(
        `UPDATE light_points
            SET address = $1, address_geocoded_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $2`,
        [address, input.id]
      );
      if (updated.rowCount !== 1) return { status: 'missing' };

      await client.query(
        `INSERT INTO inventory_audit_events
           (actor_admin_id, actor_username_snapshot, entity_id_snapshot,
            inventory_number_snapshot, action, changed_fields)
         VALUES (NULL, 'system:report-geocoding', $1, $2, 'update', $3::jsonb)`,
        [input.id, row.inventory_number, JSON.stringify({
          address: { before: row.address, after: address },
        })]
      );
      return { status: 'stored', address };
    });
  },
};
