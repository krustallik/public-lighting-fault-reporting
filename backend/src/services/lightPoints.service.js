import { pool } from '../db/pool.js';

export async function getAllLightPoints() {
  const { rows } = await pool.query(
    `SELECT id, external_id, latitude, longitude, address, district, lamp_type, status
     FROM light_points
     ORDER BY id`
  );
  return rows;
}

export async function getLightPointById(id) {
  const { rows } = await pool.query(
    `SELECT id, external_id, latitude, longitude, address, district, lamp_type, status
     FROM light_points WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}
