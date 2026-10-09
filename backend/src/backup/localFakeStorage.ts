import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  BackupStorageAdapter,
  BackupStorageOperationContext,
  ExactObjectIdentity,
  ImmutableUpload,
  ObjectIntegrity,
} from './storage.js';
import { ensureFakeStorageDirectories, resolveFakeStorageRoot } from './fakeStoragePath.js';

export interface LocalFakeStorageHooks {
  beforeArchiveCreate?: () => Promise<void> | void;
  beforeFirstArchiveWrite?: () => Promise<void> | void;
  beforeArchiveFinalize?: () => Promise<void> | void;
  afterArchiveFinalize?: () => Promise<void> | void;
  beforeManifestPublish?: () => Promise<void> | void;
  failArchiveAfterBytes?: number;
  failArchiveFinalize?: boolean;
  failAfterArchiveFinalize?: boolean;
  corruptBeforeArchiveVerify?: boolean;
  failManifestPublish?: boolean;
}

/** Test-only local fake. It stores ciphertext/manifest bytes and re-hashes the stored object on verification. */
export class LocalFakeStorageAdapter implements BackupStorageAdapter {
  readonly events: string[] = [];
  private readonly finalizedObjectVersions = new Map<string, string>();
  private archiveCreateHookUsed = false;
  private archiveWriteHookUsed = false;
  private archiveFinalizedHookUsed = false;
  private archiveCorrupted = false;
  private readonly root: string;

  constructor(root: string, private readonly storageNamespaceId: string, private readonly hooks: LocalFakeStorageHooks = {}) {
    if (process.env.NODE_ENV === 'production') throw new Error('local_fake_storage_test_only');
    this.root = resolveFakeStorageRoot(root);
  }

  async createImmutableObject(key: string, contentType: string, context: BackupStorageOperationContext): Promise<ImmutableUpload> {
    const { signal } = context;
    throwIfAborted(signal);
    if (!/^[a-z0-9._/-]+$/.test(key) || key.startsWith('/') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('invalid_object_key');
    }
    if (contentType !== 'application/octet-stream' && contentType !== 'application/json') throw new Error('invalid_object_content_type');

    const finalPath = this.objectPath(key);
    const partialPath = path.join(this.root, '.incoming', `${randomUUID()}.part`);
    try {
      ensureFakeStorageDirectories(this.root, [path.dirname(partialPath), path.dirname(finalPath)]);
      if (key.endsWith('.pgdump.age') && !this.archiveCreateHookUsed && this.hooks.beforeArchiveCreate) {
        this.archiveCreateHookUsed = true;
        await waitForOperation(Promise.resolve(this.hooks.beforeArchiveCreate()), signal);
      }
      throwIfAborted(signal);
      // Revalidate after asynchronous hooks and immediately before opening files.
      ensureFakeStorageDirectories(this.root, [path.dirname(partialPath), path.dirname(finalPath)]);
    } catch (error) {
      await rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }

    const source = new PassThrough({ highWaterMark: 64 * 1024 });
    const sink = createWriteStream(partialPath, { flags: 'wx', mode: 0o600, highWaterMark: 64 * 1024 });
    let bytes = 0;
    let finalized = false;
    let linkedByThisUpload = false;
    let abortPromise: Promise<void> | undefined;
    let finalizeTask: Promise<ExactObjectIdentity> | undefined;
    const sinkDone = pipeline(source, new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        const archive = key.endsWith('.pgdump.age');
        const nextBytes = bytes + chunk.length;
        if (archive && this.hooks.failArchiveAfterBytes !== undefined && nextBytes > this.hooks.failArchiveAfterBytes) {
          callback(new Error('synthetic_upload_write_failure'));
          return;
        }
        const beforeWrite = archive && !this.archiveWriteHookUsed ? this.hooks.beforeFirstArchiveWrite : undefined;
        if (beforeWrite) this.archiveWriteHookUsed = true;
        void waitForOperation(Promise.resolve(beforeWrite?.()), signal).then(() => {
          bytes = nextBytes;
          callback(null, chunk);
        }, () => callback(new Error('synthetic_upload_write_failure')));
      },
    }), sink, { signal });
    void sinkDone.catch(() => undefined);

    const abort = (): Promise<void> => {
      if (abortPromise) return abortPromise;
      abortPromise = (async () => {
        if (!source.destroyed) source.destroy(new Error('upload_aborted'));
        if (!sink.destroyed) sink.destroy();
        await sinkDone.catch(() => undefined);
        await rm(partialPath, { force: true }).catch(() => undefined);
        if (!finalized && linkedByThisUpload) await rm(finalPath, { force: true }).catch(() => undefined);
        if (linkedByThisUpload && !finalized) this.finalizedObjectVersions.delete(key);
      })();
      return abortPromise;
    };

    const upload: ImmutableUpload = {
      writable: source,
      finalize: ({ signal: finalizeSignal }) => {
        if (finalizeTask) return waitForOperation(finalizeTask, finalizeSignal);
        finalizeTask = (async () => {
          throwIfAborted(finalizeSignal);
          await waitForOperation(sinkDone, finalizeSignal);
          if (sink.destroyed && sink.errored) throw new Error('upload_write_failed');
          const archive = key.endsWith('.pgdump.age');
          if (archive && !this.archiveFinalizedHookUsed && this.hooks.beforeArchiveFinalize) {
            this.archiveFinalizedHookUsed = true;
            await waitForOperation(Promise.resolve(this.hooks.beforeArchiveFinalize()), finalizeSignal);
          }
          throwIfAborted(finalizeSignal);
          if (archive && this.hooks.failArchiveFinalize) throw new Error('synthetic_finalize_failure');
          ensureFakeStorageDirectories(this.root, [path.dirname(finalPath)]);
          try {
            await link(partialPath, finalPath);
            linkedByThisUpload = true;
            throwIfAborted(finalizeSignal);
            await rm(partialPath, { force: true });
            throwIfAborted(finalizeSignal);
            finalized = true;
            const providerVersionId = randomUUID();
            this.finalizedObjectVersions.set(key, providerVersionId);
            const identity = { storageNamespaceId: this.storageNamespaceId, key, providerVersionId };
            this.events.push(`finalized:${key}`);
            if (archive && this.hooks.afterArchiveFinalize) {
              await waitForOperation(Promise.resolve(this.hooks.afterArchiveFinalize()), finalizeSignal);
            }
            throwIfAborted(finalizeSignal);
            if (archive && this.hooks.failAfterArchiveFinalize) throw new Error('synthetic_ambiguous_finalize');
            return identity;
          } catch (error) {
            if (linkedByThisUpload && !finalized) {
              await rm(finalPath, { force: true }).catch(() => undefined);
              this.finalizedObjectVersions.delete(key);
              linkedByThisUpload = false;
            }
            throw error;
          }
        })();
        void finalizeTask.catch(() => undefined);
        return waitForOperation(finalizeTask, finalizeSignal);
      },
      abort,
    };
    this.events.push(`created:${key}`);
    return upload;
  }

  async verifyExactObject(identity: ExactObjectIdentity, context: BackupStorageOperationContext): Promise<ObjectIntegrity> {
    const { signal } = context;
    throwIfAborted(signal);
    this.assertNamespace(identity);
    if (this.finalizedObjectVersions.get(identity.key) !== identity.providerVersionId) {
      throw new Error('object_version_mismatch');
    }
    const file = this.objectPath(identity.key);
    if (identity.key.endsWith('.pgdump.age') && this.hooks.corruptBeforeArchiveVerify && !this.archiveCorrupted) {
      this.archiveCorrupted = true;
      const handle = await waitForOperation(open(file, 'r+'), signal);
      try {
        const byte = Buffer.alloc(1);
        const { bytesRead } = await waitForOperation(handle.read(byte, 0, 1, 0), signal);
        if (bytesRead) {
          byte[0] ^= 0xff;
          await waitForOperation(handle.write(byte, 0, 1, 0), signal);
        }
      } finally { await handle.close(); }
    }
    const info = await waitForOperation(stat(file), signal);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) {
      throwIfAborted(signal);
      hash.update(chunk as Buffer);
    }
    throwIfAborted(signal);
    this.events.push(`verified:${identity.key}`);
    return { identity, bytes: info.size, checksum: { algorithm: 'sha256', value: hash.digest('hex') } };
  }

  async publishManifestCreateOnly(key: string, bytes: Buffer, context: BackupStorageOperationContext): Promise<ExactObjectIdentity> {
    const { signal } = context;
    throwIfAborted(signal);
    if (this.hooks.failManifestPublish) throw new Error('synthetic_manifest_publish_failure');
    await waitForOperation(Promise.resolve(this.hooks.beforeManifestPublish?.()), signal);
    const upload = await this.createImmutableObject(key, 'application/json', context);
    try {
      await waitForOperation(pipeline(Readable.from([bytes]), upload.writable, { signal }), signal);
      const identity = await upload.finalize(context);
      throwIfAborted(signal);
      this.events.push(`published-manifest:${key}`);
      return identity;
    } catch (error) {
      await upload.abort();
      throw error;
    }
  }

  async abortIncompleteUpload(upload: ImmutableUpload): Promise<void> {
    this.events.push('abort-incomplete-upload');
    await upload.abort();
  }

  private objectPath(key: string): string {
    const full = path.resolve(this.root, ...key.split('/'));
    if (!full.startsWith(`${this.root}${path.sep}`)) throw new Error('invalid_object_key');
    return full;
  }

  private assertNamespace(identity: ExactObjectIdentity): void {
    if (identity.storageNamespaceId !== this.storageNamespaceId) throw new Error('object_namespace_mismatch');
  }

  /** Test-only exact-key read surface; it is not part of the production writer interface. */
  async getExactIdentityForRestore(key: string): Promise<ExactObjectIdentity> {
    if (process.env.NODE_ENV === 'production') throw new Error('local_fake_restore_reader_test_only');
    const version = this.finalizedObjectVersions.get(key);
    if (!version) throw new Error('object_not_finalized');
    const identity = { storageNamespaceId: this.storageNamespaceId, key, providerVersionId: version };
    await this.verifyExactObject(identity, { signal: new AbortController().signal });
    return identity;
  }

  /** Test-only bounded manifest read for the controlled restore verifier. */
  async readManifestForRestore(identity: ExactObjectIdentity): Promise<Buffer> {
    if (process.env.NODE_ENV === 'production') throw new Error('local_fake_restore_reader_test_only');
    this.assertNamespace(identity);
    if (!identity.key.endsWith('/manifest.json') || this.finalizedObjectVersions.get(identity.key) !== identity.providerVersionId) {
      throw new Error('manifest_identity_mismatch');
    }
    const filePath = this.objectPath(identity.key);
    const before = await lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 1024 * 1024) throw new Error('manifest_size_limit_exceeded');
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    const handle = await open(filePath, constants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > 1024 * 1024) throw new Error('manifest_size_limit_exceeded');
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > 1024 * 1024) throw new Error('manifest_size_limit_exceeded');
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }

  /** Test-only exact archive stream after identity and bytes are re-verified. */
  async openArchiveForRestore(identity: ExactObjectIdentity): Promise<Readable> {
    if (process.env.NODE_ENV === 'production') throw new Error('local_fake_restore_reader_test_only');
    if (!identity.key.endsWith('.pgdump.age')) throw new Error('restore_archive_key_invalid');
    await this.verifyExactObject(identity, { signal: new AbortController().signal });
    return createReadStream(this.objectPath(identity.key));
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('storage_operation_aborted');
}

function waitForOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('storage_operation_aborted'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('storage_operation_aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}
