import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BackupStorageAdapter, ExactObjectIdentity, ImmutableUpload, ObjectIntegrity } from './storage.js';

export interface LocalFakeStorageHooks {
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
  private archiveWriteHookUsed = false;
  private archiveFinalizedHookUsed = false;
  private archiveCorrupted = false;

  constructor(
    private readonly root: string,
    private readonly storageNamespaceId: string,
    private readonly hooks: LocalFakeStorageHooks = {},
  ) {
    if (process.env.NODE_ENV === 'production') throw new Error('local_fake_storage_test_only');
  }

  async createImmutableObject(key: string, contentType: string): Promise<ImmutableUpload> {
    if (!/^[a-z0-9._/-]+$/.test(key) || key.startsWith('/') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('invalid_object_key');
    }
    if (contentType !== 'application/octet-stream' && contentType !== 'application/json') throw new Error('invalid_object_content_type');
    const finalPath = this.objectPath(key);
    const partialPath = path.join(this.root, '.incoming', `${randomUUID()}.part`);
    await mkdir(path.dirname(partialPath), { recursive: true, mode: 0o700 });
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    const source = new PassThrough({ highWaterMark: 64 * 1024 });
    const sink = createWriteStream(partialPath, { flags: 'wx', mode: 0o600, highWaterMark: 64 * 1024 });
    let bytes = 0;
    let finalized = false;
    const faultTransform = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        const archive = key.endsWith('.pgdump.age');
        const nextBytes = bytes + chunk.length;
        if (archive && this.hooks.failArchiveAfterBytes !== undefined && nextBytes > this.hooks.failArchiveAfterBytes) {
          callback(new Error('synthetic_upload_write_failure'));
          return;
        }
        const beforeWrite = archive && !this.archiveWriteHookUsed ? this.hooks.beforeFirstArchiveWrite : undefined;
        if (beforeWrite) this.archiveWriteHookUsed = true;
        void Promise.resolve(beforeWrite?.()).then(() => {
          bytes = nextBytes;
          callback(null, chunk);
        }, () => callback(new Error('synthetic_upload_write_failure')));
      },
    });
    const sinkDone = pipeline(source, faultTransform, sink);
    void sinkDone.catch(() => undefined);

    const upload: ImmutableUpload = {
      writable: source,
      finalize: async () => {
        if (finalized) throw new Error('upload_already_finalized');
        await sinkDone;
        if (sink.destroyed && sink.errored) throw new Error('upload_write_failed');
        const archive = key.endsWith('.pgdump.age');
        if (archive && !this.archiveFinalizedHookUsed && this.hooks.beforeArchiveFinalize) {
          this.archiveFinalizedHookUsed = true;
          await this.hooks.beforeArchiveFinalize();
        }
        if (archive && this.hooks.failArchiveFinalize) throw new Error('synthetic_finalize_failure');
        await link(partialPath, finalPath);
        await rm(partialPath, { force: true });
        finalized = true;
        const providerVersionId = randomUUID();
        this.finalizedObjectVersions.set(key, providerVersionId);
        const identity = { storageNamespaceId: this.storageNamespaceId, key, providerVersionId };
        this.events.push(`finalized:${key}`);
        if (archive && this.hooks.afterArchiveFinalize) await this.hooks.afterArchiveFinalize();
        if (archive && this.hooks.failAfterArchiveFinalize) throw new Error('synthetic_ambiguous_finalize');
        return identity;
      },
      abort: async () => {
        if (!source.destroyed) source.destroy(new Error('upload_aborted'));
        if (!sink.destroyed) sink.destroy();
        await sinkDone.catch(() => undefined);
        if (!finalized) await rm(partialPath, { force: true }).catch(() => undefined);
      },
    };
    this.events.push(`created:${key}`);
    return upload;
  }

  async verifyExactObject(identity: ExactObjectIdentity): Promise<ObjectIntegrity> {
    this.assertNamespace(identity);
    if (this.finalizedObjectVersions.get(identity.key) !== identity.providerVersionId) {
      throw new Error('object_version_mismatch');
    }
    const file = this.objectPath(identity.key);
    if (identity.key.endsWith('.pgdump.age') && this.hooks.corruptBeforeArchiveVerify && !this.archiveCorrupted) {
      this.archiveCorrupted = true;
      const handle = await open(file, 'r+');
      try {
        const byte = Buffer.alloc(1);
        const { bytesRead } = await handle.read(byte, 0, 1, 0);
        if (bytesRead) {
          byte[0] ^= 0xff;
          await handle.write(byte, 0, 1, 0);
        }
      } finally { await handle.close(); }
    }
    const info = await stat(file);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    this.events.push(`verified:${identity.key}`);
    return { identity, bytes: info.size, checksum: { algorithm: 'sha256', value: hash.digest('hex') } };
  }

  async publishManifestCreateOnly(key: string, bytes: Buffer): Promise<ExactObjectIdentity> {
    if (this.hooks.failManifestPublish) throw new Error('synthetic_manifest_publish_failure');
    await this.hooks.beforeManifestPublish?.();
    const upload = await this.createImmutableObject(key, 'application/json');
    try {
      await new Promise<void>((resolve, reject) => {
        upload.writable.once('error', reject);
        upload.writable.end(bytes, () => resolve());
      });
      const identity = await upload.finalize();
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
    const root = path.resolve(this.root);
    const full = path.resolve(root, ...key.split('/'));
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error('invalid_object_key');
    return full;
  }

  private assertNamespace(identity: ExactObjectIdentity): void {
    if (identity.storageNamespaceId !== this.storageNamespaceId) throw new Error('object_namespace_mismatch');
  }
}
