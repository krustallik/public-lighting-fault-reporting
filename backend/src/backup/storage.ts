import type { Writable } from 'node:stream';

export interface BackupStorageOperationContext {
  /** Adapters must stop work and prevent late publication when this signal aborts. */
  signal: AbortSignal;
}

export interface ExactObjectIdentity {
  storageNamespaceId: string;
  key: string;
  providerVersionId: string;
}

export interface ObjectIntegrity {
  identity: ExactObjectIdentity;
  bytes: number;
  checksum: { algorithm: 'sha256'; value: string };
}

export interface ImmutableUpload {
  writable: Writable;
  finalize(context: BackupStorageOperationContext): Promise<ExactObjectIdentity>;
  abort(): Promise<void>;
}

/** Narrow writer-only interface; deliberately has no list/read/delete/lifecycle operations. */
export interface BackupStorageAdapter {
  createImmutableObject(key: string, contentType: string, context: BackupStorageOperationContext): Promise<ImmutableUpload>;
  verifyExactObject(identity: ExactObjectIdentity, context: BackupStorageOperationContext): Promise<ObjectIntegrity>;
  publishManifestCreateOnly(key: string, bytes: Buffer, context: BackupStorageOperationContext): Promise<ExactObjectIdentity>;
  abortIncompleteUpload(upload: ImmutableUpload): Promise<void>;
}
