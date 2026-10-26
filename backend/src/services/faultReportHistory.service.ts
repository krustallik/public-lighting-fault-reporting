import type { Pool, PoolClient } from 'pg';
import { AUSEMIO_FAULT_TYPE_VALUES, AUSEMIO_LOCATION_BLOCK_VALUES } from '../config/ausemioFormOptions.js';
import { AUSEMIO_VO_LOCALITIES } from '../config/data/ausemioVoLocalities.generated.js';
import {
  resolveAndValidateReportTarget,
  type ResolvedReportTarget,
} from '../domain/reportTarget.js';
import { kosiceServiceAreaClassifier, type ServiceAreaClassification } from '../domain/serviceArea.js';

export const FAULT_RECURRENCE_THRESHOLDS = {
  recentDays: 3,
  recentMinimum: 2,
  recurringDays: 30,
  recurringMinimum: 5,
  previousDays: 7,
} as const;

export const FAULT_HISTORY_SUMMARY_SQL = `SELECT
             COUNT(*) FILTER (WHERE submitted_at >= $2::timestamptz - interval '72 hours')::text AS recent_count,
             COUNT(*) FILTER (WHERE submitted_at >= $2::timestamptz - interval '720 hours')::text AS recurring_count,
             MAX(submitted_at) AS latest_previous_at,
             MAX(submitted_at) >= $2::timestamptz - interval '168 hours' AS latest_previous_within_days
           FROM fault_report_history
           WHERE light_point_id = $1 AND submitted_at < $2::timestamptz`;

export interface FaultHistorySubmissionInput {
  locality: string;
  detailDescription?: string;
  locationBlockCode?: string;
  faultTypeCode?: string;
  reportTarget: unknown;
}

export interface PreviousFaultSummary {
  recentCount: number;
  recurringCount: number;
  latestPreviousAt: Date | string | null;
  latestPreviousWithinDays?: boolean | null;
}

export interface OperatorReportPayload {
  serviceCode: 2;
  locality: string;
  locationBlockCode?: string;
  faultTypeCode?: string;
  reportTarget: ResolvedReportTarget | { kind: 'manual' };
  additionalInfo: string;
}

export interface FaultHistoryRecordResult {
  authorized: boolean;
  id?: string;
  submittedAt?: string;
  automaticNotes?: string[];
  /** Built in memory for the operator boundary and deliberately omitted from HTTP responses/storage. */
  operatorPayload?: OperatorReportPayload;
}

export interface FaultHistoryStore {
  recordSubmission(
    input: FaultHistorySubmissionInput,
    authorize?: (client: PoolClient) => Promise<boolean>
  ): Promise<FaultHistoryRecordResult>;
  listHistory(input: { limit: number; offset: number }): Promise<{
    items: FaultHistoryAdminRow[];
    total: number;
  }>;
}

export interface FaultHistoryAdminRow {
  id: string;
  submitted_at: string;
  service_code: 2;
  locality: string;
  location_block_code: string | null;
  fault_type_code: string | null;
  target_kind: 'light-point' | 'custom' | 'device' | 'manual';
  light_point_id: number | null;
  latitude: number | null;
  longitude: number | null;
  automatic_notes: string[];
}

export class FaultHistoryInputError extends Error {
  constructor(readonly code: 'invalid_locality' | 'invalid_fault_code' | 'invalid_report_target') {
    super(code);
    this.name = 'FaultHistoryInputError';
  }
}

function validateSubmission(input: FaultHistorySubmissionInput): void {
  if (!AUSEMIO_VO_LOCALITIES.some(({ value }) => value === input.locality)) {
    throw new FaultHistoryInputError('invalid_locality');
  }
  if (input.faultTypeCode && !(AUSEMIO_FAULT_TYPE_VALUES as readonly string[]).includes(input.faultTypeCode)) {
    throw new FaultHistoryInputError('invalid_fault_code');
  }
  if (input.locationBlockCode && !(AUSEMIO_LOCATION_BLOCK_VALUES as readonly string[]).includes(input.locationBlockCode)) {
    throw new FaultHistoryInputError('invalid_fault_code');
  }
  if (!input.reportTarget || typeof input.reportTarget !== 'object' || Array.isArray(input.reportTarget)) {
    throw new FaultHistoryInputError('invalid_report_target');
  }
}

function formatPreviousCount(count: number): string {
  return `${count} predchádzajúcich hlásení`;
}

export function buildAutomaticFaultNotes(
  summary: PreviousFaultSummary,
  submittedAt: Date
): string[] {
  const { recentDays, recentMinimum, recurringDays, recurringMinimum, previousDays } = FAULT_RECURRENCE_THRESHOLDS;
  const notes: string[] = [];
  if (summary.recurringCount >= recurringMinimum) {
    const recentClause = summary.recentCount >= recentMinimum
      ? `, z toho ${summary.recentCount} za posledné ${recentDays} dni`
      : '';
    notes.push(`Opakované hlásenia: ${summary.recurringCount} predchádzajúcich hlásení za posledných ${recurringDays} dní${recentClause}.`);
  } else if (summary.recentCount >= recentMinimum) {
    notes.push(`${formatPreviousCount(summary.recentCount)} za posledné ${recentDays} dni.`);
  } else if (summary.latestPreviousAt) {
    const latestPreviousAt = summary.latestPreviousAt instanceof Date
      ? summary.latestPreviousAt
      : new Date(summary.latestPreviousAt);
    const ageMs = submittedAt.getTime() - latestPreviousAt.getTime();
    const isWithinPreviousDays = summary.latestPreviousWithinDays ??
      (ageMs >= 0 && ageMs <= previousDays * 24 * 60 * 60 * 1000);
    if (isWithinPreviousDays) {
      const utc = latestPreviousAt.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
      notes.push(`Posledné predchádzajúce hlásenie: ${utc}.`);
    }
  }
  return notes;
}

export function buildOperatorAdditionalInfo(
  originalDescription: string | undefined,
  automaticNotes: readonly string[]
): string {
  const original = originalDescription?.trim() ?? '';
  const generated = automaticNotes.length
    ? `Automatické poznámky pre operátora: ${automaticNotes.join(' ')}`
    : '';
  return [original, generated].filter(Boolean).join('\n\n');
}

type HistoryTarget =
  | { kind: 'light-point'; lightPointId: number }
  | { kind: 'custom' | 'device'; latitude: number; longitude: number }
  | { kind: 'manual' };

function parseTarget(input: unknown): HistoryTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input)) {
    throw new FaultHistoryInputError('invalid_report_target');
  }
  const value = input as Record<string, unknown>;
  if (value.kind === 'light-point' && typeof value.lightPointId === 'number') {
    return { kind: 'light-point', lightPointId: value.lightPointId };
  }
  if ((value.kind === 'custom' || value.kind === 'device') &&
    typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { kind: value.kind, latitude: value.latitude, longitude: value.longitude };
  }
  if (value.kind === 'manual') return { kind: 'manual' };
  throw new FaultHistoryInputError('invalid_report_target');
}

export class PostgresFaultHistoryStore implements FaultHistoryStore {
  constructor(
    private readonly pool: Pick<Pool, 'connect' | 'query'>,
    private readonly classifyArea: (point: unknown) => ServiceAreaClassification = kosiceServiceAreaClassifier
  ) {}

  async recordSubmission(
    input: FaultHistorySubmissionInput,
    authorize?: (client: PoolClient) => Promise<boolean>
  ): Promise<FaultHistoryRecordResult> {
    validateSubmission(input);
    const targetInput = parseTarget(input.reportTarget);
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const target = targetInput.kind === 'manual'
        ? targetInput
        : await resolveAndValidateReportTarget(targetInput, {
          async findCoordinates(id) {
            const result = await client.query<{ latitude: string; longitude: string }>(
              `SELECT ST_Y(geom)::text AS latitude, ST_X(geom)::text AS longitude
                 FROM light_points WHERE id = $1 FOR UPDATE`, [id]
            );
            const row = result.rows[0];
            return row ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
          },
        }, this.classifyArea);

      if (authorize && !await authorize(client)) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { authorized: false };
      }

      const timestampResult = await client.query<{ submitted_at: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at`
      );
      const submittedAt = timestampResult.rows[0]?.submitted_at;
      const submittedAtDate = submittedAt ? new Date(submittedAt) : null;
      if (!submittedAtDate || Number.isNaN(submittedAtDate.getTime())) {
        throw new Error('Database submission timestamp unavailable.');
      }

      let automaticNotes: string[] = [];
      if (target.kind === 'light-point') {
        const summaryResult = await client.query<{
          recent_count: string;
          recurring_count: string;
          latest_previous_at: Date | null;
          latest_previous_within_days: boolean | null;
        }>(
          FAULT_HISTORY_SUMMARY_SQL,
          [target.lightPointId, submittedAt]
        );
        const summary = summaryResult.rows[0];
        automaticNotes = buildAutomaticFaultNotes({
          recentCount: Number(summary?.recent_count ?? 0),
          recurringCount: Number(summary?.recurring_count ?? 0),
          latestPreviousAt: summary?.latest_previous_at ?? null,
          latestPreviousWithinDays: summary?.latest_previous_within_days ?? null,
        }, submittedAtDate);
      }

      const operatorPayload: OperatorReportPayload = {
        serviceCode: 2,
        locality: input.locality,
        ...(input.locationBlockCode ? { locationBlockCode: input.locationBlockCode } : {}),
        ...(input.faultTypeCode ? { faultTypeCode: input.faultTypeCode } : {}),
        reportTarget: target,
        additionalInfo: buildOperatorAdditionalInfo(input.detailDescription, automaticNotes),
      };

      const latitude = 'latitude' in target ? target.latitude : null;
      const longitude = 'longitude' in target ? target.longitude : null;
      const inserted = await client.query<{ id: string; submitted_at: string }>(
        `INSERT INTO fault_report_history
           (submitted_at, service_code, locality, location_block_code, fault_type_code,
            target_kind, light_point_id, target_geom, automatic_notes)
         VALUES ($1, 2, $2, $3, $4, $5, $6,
                 CASE WHEN $7::double precision IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($8::double precision, $7::double precision), 4326)
                  END,
                 $9::text[])
         RETURNING id::text,
                   to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at`,
        [submittedAt, input.locality, input.locationBlockCode ?? null, input.faultTypeCode ?? null,
          target.kind, target.kind === 'light-point' ? target.lightPointId : null,
          latitude, longitude, automaticNotes]
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        authorized: true,
        id: inserted.rows[0]?.id,
        submittedAt: inserted.rows[0]?.submitted_at,
        automaticNotes,
        operatorPayload,
      };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listHistory(input: { limit: number; offset: number }): Promise<{ items: FaultHistoryAdminRow[]; total: number }> {
    const client = await this.pool.connect();
    try {
      const count = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM fault_report_history');
      const rows = await client.query<FaultHistoryAdminRow>(
        `SELECT id::text, submitted_at, service_code, locality, location_block_code,
                fault_type_code, target_kind, light_point_id,
                ST_Y(target_geom)::float8 AS latitude, ST_X(target_geom)::float8 AS longitude,
                automatic_notes
           FROM fault_report_history
          ORDER BY submitted_at DESC, id DESC
          LIMIT $1 OFFSET $2`, [input.limit, input.offset]
      );
      return { items: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
    } finally {
      client.release();
    }
  }
}
