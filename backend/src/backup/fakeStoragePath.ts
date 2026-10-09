import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class FakeStoragePathError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FakeStoragePathError';
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function physicalDirectory(pathname: string, boundary: string): string {
  let info;
  try {
    info = lstatSync(pathname);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new FakeStoragePathError('backup_fake_storage_path_component_missing');
    }
    throw new FakeStoragePathError('backup_fake_storage_path_unavailable');
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new FakeStoragePathError('backup_fake_storage_symlink_or_non_directory');
  }
  let physical: string;
  try {
    physical = realpathSync.native(pathname);
  } catch {
    throw new FakeStoragePathError('backup_fake_storage_path_unavailable');
  }
  if (!isWithin(boundary, physical)) {
    throw new FakeStoragePathError('backup_fake_storage_must_be_under_system_temp');
  }
  return physical;
}

/**
 * Resolve a fake-storage root under the physical OS temp directory. Existing
 * path components are checked individually so a symlink cannot redirect the
 * test artifact tree outside that boundary. Missing descendants are permitted.
 */
export function resolveFakeStorageRoot(candidate: string, temporaryRoot = os.tmpdir()): string {
  const lexicalTemp = path.resolve(temporaryRoot);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(lexicalTemp, resolvedCandidate);
  if (!isWithin(lexicalTemp, resolvedCandidate)) {
    throw new FakeStoragePathError('backup_fake_storage_must_be_under_system_temp');
  }

  let physicalTemp: string;
  try {
    physicalTemp = realpathSync.native(lexicalTemp);
  } catch {
    throw new FakeStoragePathError('backup_fake_storage_path_unavailable');
  }

  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new FakeStoragePathError('backup_fake_storage_must_be_under_system_temp');
  }

  let current = physicalTemp;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      current = physicalDirectory(current, physicalTemp);
    } catch (error) {
      if (error instanceof FakeStoragePathError && error.code === 'backup_fake_storage_path_component_missing') {
        // Once a component is absent, the remaining descendants cannot yet be
        // redirected through an existing link. Creation rechecks each segment.
        break;
      }
      throw error;
    }
  }

  return path.resolve(physicalTemp, ...segments);
}

/** Create fake-storage directories one component at a time and recheck each. */
export function ensureFakeStorageDirectories(root: string, directories: string[]): string {
  const canonicalRoot = resolveFakeStorageRoot(root);
  const physicalTemp = realpathSync.native(path.resolve(os.tmpdir()));

  const ensurePath = (target: string, allowedRoot: string): void => {
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== allowedRoot && !isWithin(allowedRoot, resolvedTarget)) {
      throw new FakeStoragePathError('backup_fake_storage_path_escape');
    }
    const relative = path.relative(physicalTemp, resolvedTarget);
    if (!isWithin(physicalTemp, resolvedTarget)) {
      throw new FakeStoragePathError('backup_fake_storage_must_be_under_system_temp');
    }

    let current = physicalTemp;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) {
          throw new FakeStoragePathError('backup_fake_storage_directory_create_failed');
        }
      }
      current = physicalDirectory(current, physicalTemp);
    }
  };

  ensurePath(canonicalRoot, physicalTemp);
  for (const directory of directories) ensurePath(directory, canonicalRoot);
  return canonicalRoot;
}
