import type { Writable } from 'node:stream';

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
  finalize(): Promise<ExactObjectIdentity>;
  abort(): Promise<void>;
}

/** Narrow writer-only interface; deliberately has no list/read/delete/lifecycle operations. */
export interface BackupStorageAdapter {
  createImmutableObject(key: string, contentType: string): Promise<ImmutableUpload>;
  verifyExactObject(identity: ExactObjectIdentity): Promise<ObjectIntegrity>;
  publishManifestCreateOnly(key: string, bytes: Buffer): Promise<ExactObjectIdentity>;
  abortIncompleteUpload(upload: ImmutableUpload): Promise<void>;
}
