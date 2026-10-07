import type { PoolClient } from 'pg';

const TRIM_CHARACTERS = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`;
const READ_ONLY_CANDIDATE = `normalize(btrim(external_id::text, ${TRIM_CHARACTERS}), NFC)`;

const LEGACY_TABLES: Record<string, Record<string, string>> = {
  admin_activity_logs: {
    id: 'int4:NO', admin_id: 'int4:YES', action: 'varchar:NO:100', entity_type: 'varchar:YES:50',
    entity_id: 'int4:YES', details: 'jsonb:YES', created_at: 'timestamptz:NO',
  },
  admin_refresh_sessions: {
    id: 'uuid:NO', admin_id: 'int4:NO', token_hash: 'varchar:NO:255', expires_at: 'timestamptz:NO',
    revoked_at: 'timestamptz:YES', created_at: 'timestamptz:NO',
  },
  admins: {
    id: 'int4:NO', username: 'varchar:NO:100', password_hash: 'varchar:NO:255', full_name: 'varchar:YES:200',
    is_active: 'bool:NO', created_at: 'timestamptz:NO',
  },
  import_batches: {
    id: 'int4:NO', filename: 'varchar:NO:255', uploaded_by_admin_id: 'int4:YES', total_rows: 'int4:NO',
    created_rows: 'int4:NO', updated_rows: 'int4:NO', skipped_rows: 'int4:NO', failed_rows: 'int4:NO',
    created_at: 'timestamptz:NO',
  },
  integration_logs: {
    id: 'int4:NO', reference_code: 'varchar:YES:100', integration_type: 'varchar:NO:50',
    request_payload: 'jsonb:YES', response_payload: 'jsonb:YES', status: 'varchar:NO:50',
    error_message: 'text:YES', created_at: 'timestamptz:NO',
  },
  light_points: {
    id: 'int4:NO', external_id: 'varchar:YES:50', latitude: 'numeric:NO:10:8', longitude: 'numeric:NO:11:8',
    address: 'text:YES', address_geocoded_at: 'timestamptz:YES', district: 'varchar:YES:100',
    lamp_type: 'varchar:YES:100', status: 'varchar:NO:20', created_at: 'timestamptz:NO',
    updated_at: 'timestamptz:NO',
  },
};

const LEGACY_DEFAULTS: Record<string, string> = {
  'admin_activity_logs.id': "nextval('admin_activity_logs_id_seq'::regclass)",
  'admin_activity_logs.created_at': 'now()',
  'admin_refresh_sessions.id': 'gen_random_uuid()',
  'admin_refresh_sessions.created_at': 'now()',
  'admins.id': "nextval('admins_id_seq'::regclass)",
  'admins.is_active': 'true',
  'admins.created_at': 'now()',
  'import_batches.id': "nextval('import_batches_id_seq'::regclass)",
  'import_batches.total_rows': '0',
  'import_batches.created_rows': '0',
  'import_batches.updated_rows': '0',
  'import_batches.skipped_rows': '0',
  'import_batches.failed_rows': '0',
  'import_batches.created_at': 'now()',
  'integration_logs.id': "nextval('integration_logs_id_seq'::regclass)",
  'integration_logs.status': "'pending'::character varying",
  'integration_logs.created_at': 'now()',
  'light_points.id': "nextval('light_points_id_seq'::regclass)",
  'light_points.status': "'active'::character varying",
  'light_points.created_at': 'now()',
  'light_points.updated_at': 'now()',
};

const LEGACY_CONSTRAINTS = [
  'admin_activity_logs.admin_activity_logs_admin_id_fkey|f|FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL',
  'admin_activity_logs.admin_activity_logs_pkey|p|PRIMARY KEY (id)',
  'admin_refresh_sessions.admin_refresh_sessions_admin_id_fkey|f|FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE',
  'admin_refresh_sessions.admin_refresh_sessions_pkey|p|PRIMARY KEY (id)',
  'admins.admins_pkey|p|PRIMARY KEY (id)',
  'admins.admins_username_key|u|UNIQUE (username)',
  'import_batches.import_batches_pkey|p|PRIMARY KEY (id)',
  'import_batches.import_batches_uploaded_by_admin_id_fkey|f|FOREIGN KEY (uploaded_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL',
  'integration_logs.integration_logs_pkey|p|PRIMARY KEY (id)',
  'light_points.light_points_pkey|p|PRIMARY KEY (id)',
  "light_points.light_points_status_check|c|CHECK (status::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying, 'maintenance'::character varying]::text[]))",
].sort();

const LEGACY_INDEXES = [
  'admin_activity_logs.idx_admin_activity_created|CREATE INDEX idx_admin_activity_created ON public.admin_activity_logs USING btree (created_at DESC)',
  'admin_refresh_sessions.idx_admin_refresh_sessions_admin|CREATE INDEX idx_admin_refresh_sessions_admin ON public.admin_refresh_sessions USING btree (admin_id)',
  'admin_refresh_sessions.idx_admin_refresh_sessions_hash|CREATE INDEX idx_admin_refresh_sessions_hash ON public.admin_refresh_sessions USING btree (token_hash)',
  'integration_logs.idx_integration_logs_created|CREATE INDEX idx_integration_logs_created ON public.integration_logs USING btree (created_at DESC)',
  'integration_logs.idx_integration_logs_type|CREATE INDEX idx_integration_logs_type ON public.integration_logs USING btree (integration_type)',
  'light_points.idx_light_points_coords|CREATE INDEX idx_light_points_coords ON public.light_points USING btree (latitude, longitude)',
  'light_points.idx_light_points_status|CREATE INDEX idx_light_points_status ON public.light_points USING btree (status)',
].sort();

export interface PreflightSummary {
  state: 'empty' | 'recognized-pre-p3';
  serverEncoding: string;
  tables: number;
  rows: number;
  nullIdentity: number;
  emptyCanonicalIdentity: number;
  nonCanonicalIdentity: number;
  canonicalCollisions: number;
  invalidCoordinates: number;
  postgisInstalled: boolean;
  geometryColumnPresent: boolean;
}

export class MigrationPreflightError extends Error {
  constructor(message: string, readonly summary?: PreflightSummary) {
    super(message);
    this.name = 'MigrationPreflightError';
  }
}

/** Shared fail-closed encoding prerequisite used before any migration DDL and in adoption preflight. */
export async function assertP3MigrationPreflightEncoding(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ server_encoding: string }>(
    'SELECT current_setting(\'server_encoding\') AS server_encoding'
  );
  const serverEncoding = rows[0].server_encoding;
  if (serverEncoding.toUpperCase() !== 'UTF8') {
    throw new MigrationPreflightError(`P3 requires UTF8 server_encoding; found ${serverEncoding}. No changes were made.`);
  }
  return serverEncoding;
}

async function currentSchemaTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND c.relname <> 'schema_migrations'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
           JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
             AND e.extname IN ('postgis', 'postgis_topology', 'postgis_tiger_geocoder', 'fuzzystrmatch', 'plpgsql')
        )
      ORDER BY c.relname`
  );
  return rows.map((row) => row.table_name);
}

async function assertRecognizedLegacySchema(client: PoolClient, tables: string[]): Promise<void> {
  const expectedNames = Object.keys(LEGACY_TABLES).sort();
  if (JSON.stringify(tables) !== JSON.stringify(expectedNames)) {
    throw new MigrationPreflightError('Database schema is not the recognized pre-P3 schema. No changes were made.');
  }

  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    udt_name: string;
    is_nullable: 'YES' | 'NO';
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, udt_name, is_nullable, character_maximum_length,
            numeric_precision, numeric_scale, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`
    , [expectedNames]
  );
  const actual: Record<string, string> = {};
  const defaults: string[] = [];
  for (const column of rows) {
    const length = column.character_maximum_length == null ? '' : `:${column.character_maximum_length}`;
    const numeric = column.numeric_precision == null || column.udt_name !== 'numeric'
      ? '' : `:${column.numeric_precision}:${column.numeric_scale}`;
    const qualified = `${column.table_name}.${column.column_name}`;
    actual[qualified] = `${column.udt_name}:${column.is_nullable}${length}${numeric}`;
    if (column.column_default !== null) defaults.push(`${qualified}|${column.column_default}`);
  }
  const expected: Record<string, string> = {};
  for (const [table, columns] of Object.entries(LEGACY_TABLES)) {
    for (const [column, signature] of Object.entries(columns)) expected[`${table}.${column}`] = signature;
  }
  if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort())) {
    throw new MigrationPreflightError('Pre-P3 schema fingerprint did not match the recognized baseline. No changes were made.');
  }

  if (JSON.stringify(defaults.sort()) !== JSON.stringify(Object.entries(LEGACY_DEFAULTS).map(([column, value]) => `${column}|${value}`).sort())) {
    throw new MigrationPreflightError('Pre-P3 column defaults did not match the recognized baseline. No changes were made.');
  }

  const { rows: constraintRows } = await client.query<{ table_name: string; constraint_name: string; constraint_type: string; definition: string }>(
    `SELECT table_name, constraint_name, constraint_type, pg_get_constraintdef(c.oid, true) AS definition
       FROM information_schema.table_constraints t
       JOIN pg_constraint c ON c.conname = t.constraint_name
         AND c.conrelid = (quote_ident(t.table_schema)||'.'||quote_ident(t.table_name))::regclass
      WHERE t.table_schema = 'public' AND t.table_name = ANY($1::text[])
      ORDER BY table_name, constraint_name`, [expectedNames]
  );
  const constraints = constraintRows.map((row) => `${row.table_name}.${row.constraint_name}|${row.constraint_type === 'PRIMARY KEY' ? 'p' : row.constraint_type === 'FOREIGN KEY' ? 'f' : row.constraint_type === 'UNIQUE' ? 'u' : 'c'}|${row.definition}`).sort();
  if (JSON.stringify(constraints) !== JSON.stringify(LEGACY_CONSTRAINTS)) {
    throw new MigrationPreflightError('Pre-P3 constraints did not match the recognized baseline. No changes were made.');
  }

  const { rows: indexRows } = await client.query<{ table_name: string; index_name: string; index_definition: string }>(
    `SELECT tablename AS table_name, indexname AS index_name, indexdef AS index_definition
       FROM pg_indexes i
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint c WHERE c.conindid = (quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))::regclass
        )
      ORDER BY tablename, indexname`, [expectedNames]
  );
  const indexes = indexRows.map((row) => `${row.table_name}.${row.index_name}|${row.index_definition}`).sort();
  if (JSON.stringify(indexes) !== JSON.stringify(LEGACY_INDEXES)) {
    throw new MigrationPreflightError('Pre-P3 indexes did not match the recognized baseline. No changes were made.');
  }

  const { rows: triggerRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_trigger tr
       JOIN pg_class r ON r.oid = tr.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND r.relname = ANY($1::text[]) AND NOT tr.tgisinternal`, [expectedNames]
  );
  if (Number(triggerRows[0].count) !== 0) {
    throw new MigrationPreflightError('Pre-P3 database has unrecognized user triggers. No changes were made.');
  }

  const { rows: geometryRows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'light_points' AND column_name = 'geom'
     ) AS exists`
  );
  if (geometryRows[0].exists) {
    throw new MigrationPreflightError('Unexpected geometry column in pre-P3 database. No changes were made.');
  }
}

/** Read-only check of empty/current legacy schema and candidate identity/coordinate data. */
export async function inspectP3MigrationPreflight(client: PoolClient): Promise<PreflightSummary> {
  const serverEncoding = await assertP3MigrationPreflightEncoding(client);

  const tables = await currentSchemaTables(client);
  if (tables.length === 0) {
    const { rows: extensionRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS exists`
    );
    return {
      state: 'empty', serverEncoding, tables: 0, rows: 0, nullIdentity: 0,
      emptyCanonicalIdentity: 0, nonCanonicalIdentity: 0, canonicalCollisions: 0,
      invalidCoordinates: 0, postgisInstalled: extensionRows[0].exists, geometryColumnPresent: false,
    };
  }

  await assertRecognizedLegacySchema(client, tables);
  const { rows: extensionRows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS exists`
  );
  const { rows: countRows } = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM light_points');
  const { rows: statsRows } = await client.query<{
    null_identity: string;
    empty_canonical: string;
    non_canonical: string;
    invalid_coordinates: string;
  }>(
    `WITH candidates AS (
       SELECT id, external_id, ${READ_ONLY_CANDIDATE} AS candidate, latitude, longitude
         FROM light_points
     )
     SELECT COUNT(*) FILTER (WHERE external_id IS NULL)::text AS null_identity,
            COUNT(*) FILTER (WHERE candidate COLLATE "C" = '' COLLATE "C")::text AS empty_canonical,
            COUNT(*) FILTER (
              WHERE external_id IS NOT NULL AND external_id::text COLLATE "C" <> candidate COLLATE "C"
            )::text AS non_canonical,
            COUNT(*) FILTER (
              WHERE NOT (latitude BETWEEN -90 AND 90) OR NOT (longitude BETWEEN -180 AND 180)
            )::text AS invalid_coordinates
       FROM candidates`
  );
  const { rows: collisionRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM (
         SELECT ${READ_ONLY_CANDIDATE} COLLATE "C" AS candidate
           FROM light_points
          WHERE external_id IS NOT NULL
          GROUP BY ${READ_ONLY_CANDIDATE} COLLATE "C"
         HAVING COUNT(*) > 1
       ) collisions`
  );
  const stats = statsRows[0];
  const summary: PreflightSummary = {
    state: 'recognized-pre-p3', serverEncoding, tables: tables.length,
    rows: Number(countRows[0].count), nullIdentity: Number(stats.null_identity),
    emptyCanonicalIdentity: Number(stats.empty_canonical), nonCanonicalIdentity: Number(stats.non_canonical),
    canonicalCollisions: Number(collisionRows[0].count), invalidCoordinates: Number(stats.invalid_coordinates),
    postgisInstalled: extensionRows[0].exists, geometryColumnPresent: false,
  };
  if (summary.nullIdentity || summary.emptyCanonicalIdentity || summary.nonCanonicalIdentity || summary.canonicalCollisions || summary.invalidCoordinates) {
    throw new MigrationPreflightError('P3 read-only data preflight found unsafe identity or coordinate rows. No changes were made.', summary);
  }
  return summary;
}

export async function assertP3MigrationPreflight(client: PoolClient): Promise<PreflightSummary> {
  return inspectP3MigrationPreflight(client);
}
