/** Shared session advisory-lock identities. Keep migration and backup purposes distinct. */
export const MIGRATION_ADVISORY_LOCK = Object.freeze({ namespace: 1_701_669_235, key: 3 });

/** Serializes only backup producers; it is not the migration/schema-state barrier. */
export const BACKUP_ADVISORY_LOCK = Object.freeze({ namespace: 1_701_669_235, key: 4 });

/** Serializes bounded operational retention; it is independent of backup and migration locks. */
export const RETENTION_ADVISORY_LOCK = Object.freeze({ namespace: 1_701_669_235, key: 5 });

/** Serializes scheduler state transitions on the single approved database instance. */
export const SCHEDULER_ADVISORY_LOCK = Object.freeze({ namespace: 1_701_669_235, key: 6 });
