import type { ReportFormValues } from '@/schemas/reportSchema';
import { readReportTarget, type ReportTarget } from './reportNavigationTarget';

const REPORT_DRAFT_PREFIX = 'plfr:public-report-draft:v1:';
const REPORT_VERIFICATION_PREFIX = 'plfr:public-report-verification:v1:';
const REPORT_ATTACHMENT_DATABASE = 'plfr-public-report-attachments';
const REPORT_ATTACHMENT_STORE = 'draft-attachments';
const REPORT_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredReportDraft {
  target: ReportTarget;
  formValues: ReportFormValues;
  step: 1 | 2 | 3;
  attachmentCount: number;
  userEditedFields: Array<'locality' | 'detailDescription'>;
  updatedAt: number;
}

export interface StoredReportVerification {
  intentId: string;
  email: string;
  expiresAt: number;
  retryAt: number | null;
  verificationToken: string | null;
}

function isDraftId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createReportDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('Secure browser randomness is unavailable.');
}

export function getReportDraftId(search: string): string | null {
  const candidate = new URLSearchParams(search).get('draft');
  return isDraftId(candidate) ? candidate : null;
}

export function getReportDraftStep(search: string): 1 | 2 | 3 | null {
  const candidate = Number(new URLSearchParams(search).get('step'));
  return candidate === 1 || candidate === 2 || candidate === 3 ? candidate : null;
}

function parseFormValues(value: unknown): ReportFormValues | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const stringFields = [
    'locality', 'detailDescription', 'locationBlock', 'faultType',
    'otherFaultText', 'phone', 'email',
  ] as const;
  if (!stringFields.every((field) => typeof candidate[field] === 'string') || typeof candidate.consent !== 'boolean') {
    return null;
  }

  return {
    locality: candidate.locality as string,
    detailDescription: candidate.detailDescription as string,
    locationBlock: candidate.locationBlock as string,
    faultType: candidate.faultType as string,
    otherFaultText: candidate.otherFaultText as string,
    phone: candidate.phone as string,
    email: candidate.email as string,
    consent: candidate.consent,
  };
}

function parseReportDraft(value: unknown, now: number): StoredReportDraft | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const target = readReportTarget({ reportTarget: candidate.target });
  const formValues = parseFormValues(candidate.formValues);
  if (!target || !formValues || !Number.isSafeInteger(candidate.updatedAt) ||
    typeof candidate.updatedAt !== 'number' || candidate.updatedAt > now ||
    now - candidate.updatedAt > REPORT_DRAFT_TTL_MS ||
    !Number.isSafeInteger(candidate.attachmentCount) || typeof candidate.attachmentCount !== 'number' ||
    candidate.attachmentCount < 0 || candidate.attachmentCount > 20 ||
    !Array.isArray(candidate.userEditedFields) ||
    candidate.userEditedFields.some((field) => field !== 'locality' && field !== 'detailDescription') ||
    (candidate.step !== 1 && candidate.step !== 2 && candidate.step !== 3)) {
    return null;
  }

  return {
    target,
    formValues,
    step: candidate.step,
    attachmentCount: candidate.attachmentCount,
    userEditedFields: candidate.userEditedFields as StoredReportDraft['userEditedFields'],
    updatedAt: candidate.updatedAt,
  };
}

function hasCurrentAttachmentDraft(id: string): boolean {
  try {
    const serialized = window.localStorage.getItem(`${REPORT_DRAFT_PREFIX}${id}`);
    if (!serialized) return false;
    return (parseReportDraft(JSON.parse(serialized) as unknown, Date.now())?.attachmentCount ?? 0) > 0;
  } catch {
    // If draft storage becomes unavailable during cleanup, preserve the attachment record.
    return true;
  }
}

export function readReportDraft(id: string | null, now = Date.now()): StoredReportDraft | null {
  if (!isDraftId(id)) return null;
  try {
    const serialized = window.localStorage.getItem(`${REPORT_DRAFT_PREFIX}${id}`);
    if (!serialized) return null;
    const draft = parseReportDraft(JSON.parse(serialized) as unknown, now);
    if (!draft) window.localStorage.removeItem(`${REPORT_DRAFT_PREFIX}${id}`);
    return draft;
  } catch {
    return null;
  }
}

export function saveReportDraft(
  id: string | null,
  draft: Omit<StoredReportDraft, 'updatedAt'>,
  now = Date.now()
): boolean {
  if (!isDraftId(id)) return false;
  try {
    window.localStorage.setItem(`${REPORT_DRAFT_PREFIX}${id}`, JSON.stringify({ ...draft, updatedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function removeReportDraft(id: string | null): void {
  if (!isDraftId(id)) return;
  try {
    window.localStorage.removeItem(`${REPORT_DRAFT_PREFIX}${id}`);
  } catch {
    // Storage can be disabled by the browser; there is no safer fallback for this local draft.
  }
}

export async function cleanupExpiredReportDraftData(now = Date.now()): Promise<void> {
  const activeDraftIds = new Set<string>();
  const activeAttachmentDraftIds = new Set<string>();
  let localKeys: string[];
  try {
    const storage = window.localStorage;
    localKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
      .filter((key) => key.startsWith(REPORT_DRAFT_PREFIX));
    for (const key of localKeys) {
      const id = key.slice(REPORT_DRAFT_PREFIX.length);
      const draft = readReportDraft(id, now);
      if (draft) {
        activeDraftIds.add(id);
        if (draft.attachmentCount > 0) activeAttachmentDraftIds.add(id);
      } else removeReportVerification(id);
    }
  } catch {
    // If local storage is unavailable, keep attachments rather than risk deleting valid drafts.
    return;
  }

  try {
    const storage = window.sessionStorage;
    const verificationKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
      .filter((key) => key.startsWith(REPORT_VERIFICATION_PREFIX));
    for (const key of verificationKeys) {
      const id = key.slice(REPORT_VERIFICATION_PREFIX.length);
      if (!activeDraftIds.has(id) || !readReportVerification(id, now)) removeReportVerification(id);
    }
  } catch {
    // A session storage failure must not block loading a report draft.
  }

  if (typeof indexedDB === 'undefined') return;
  const database = await openAttachmentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(REPORT_ATTACHMENT_STORE, 'readwrite');
      const store = transaction.objectStore(REPORT_ATTACHMENT_STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const draftId = (cursor.value as { draftId?: unknown } | null)?.draftId;
        if (typeof draftId !== 'string' ||
          (!activeAttachmentDraftIds.has(draftId) && !hasCurrentAttachmentDraft(draftId))) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not inspect expired browser attachments.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean expired browser attachments.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not clean expired browser attachments.'));
    });
  } finally {
    database.close();
  }
}

export function readReportVerification(id: string | null, now = Date.now()): StoredReportVerification | null {
  if (!isDraftId(id)) return null;
  try {
    const serialized = window.sessionStorage.getItem(`${REPORT_VERIFICATION_PREFIX}${id}`);
    if (!serialized) return null;
    const value = JSON.parse(serialized) as Partial<StoredReportVerification>;
    if (typeof value.intentId !== 'string' || typeof value.email !== 'string' ||
      typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
      (value.retryAt !== null && (typeof value.retryAt !== 'number' || !Number.isFinite(value.retryAt))) ||
      (value.verificationToken !== null && typeof value.verificationToken !== 'string') ||
      value.expiresAt <= now) {
      window.sessionStorage.removeItem(`${REPORT_VERIFICATION_PREFIX}${id}`);
      return null;
    }
    return value as StoredReportVerification;
  } catch {
    return null;
  }
}

export function saveReportVerification(id: string | null, value: StoredReportVerification | null): void {
  if (!isDraftId(id)) return;
  try {
    if (!value || value.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(`${REPORT_VERIFICATION_PREFIX}${id}`);
      return;
    }
    window.sessionStorage.setItem(`${REPORT_VERIFICATION_PREFIX}${id}`, JSON.stringify(value));
  } catch {
    // Verification can still proceed in memory; the API remains authoritative after a reload.
  }
}

export function removeReportVerification(id: string | null): void {
  if (!isDraftId(id)) return;
  try {
    window.sessionStorage.removeItem(`${REPORT_VERIFICATION_PREFIX}${id}`);
  } catch {
    // Storage can be disabled by the browser.
  }
}

function openAttachmentDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Browser attachment storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPORT_ATTACHMENT_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REPORT_ATTACHMENT_STORE)) {
        database.createObjectStore(REPORT_ATTACHMENT_STORE, { keyPath: 'draftId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser attachment storage.'));
    request.onblocked = () => reject(new Error('Browser attachment storage is blocked by another tab.'));
  });
}

export async function saveReportAttachments(id: string | null, files: readonly File[]): Promise<void> {
  if (!isDraftId(id)) return;
  const database = await openAttachmentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(REPORT_ATTACHMENT_STORE, 'readwrite');
      const storedFiles = files.map((file) => ({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        content: file.slice(0, file.size, file.type),
      }));
      transaction.objectStore(REPORT_ATTACHMENT_STORE).put({ draftId: id, files: storedFiles });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save attachments.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save attachments.'));
    });
  } finally {
    database.close();
  }
}

export async function readReportAttachments(id: string | null): Promise<File[]> {
  if (!isDraftId(id)) return [];
  const database = await openAttachmentDatabase();
  try {
    const record = await new Promise<{ files?: unknown } | undefined>((resolve, reject) => {
      const transaction = database.transaction(REPORT_ATTACHMENT_STORE, 'readonly');
      const request = transaction.objectStore(REPORT_ATTACHMENT_STORE).get(id);
      request.onsuccess = () => resolve(request.result as { files?: unknown } | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not restore attachments.'));
    });
    if (!Array.isArray(record?.files)) return [];
    const restoredFiles: File[] = [];
    for (const entry of record.files) {
      if (typeof File !== 'undefined' && entry instanceof File) {
        restoredFiles.push(entry);
        continue;
      }
      if (!entry || typeof entry !== 'object' || typeof File === 'undefined') continue;
      const fileMetadata = entry as { name?: unknown; type?: unknown; lastModified?: unknown; content?: unknown };
      if (typeof fileMetadata.name !== 'string' || typeof fileMetadata.type !== 'string' ||
        typeof fileMetadata.lastModified !== 'number' || typeof Blob === 'undefined' ||
        !(fileMetadata.content instanceof Blob)) continue;
      restoredFiles.push(new File([fileMetadata.content], fileMetadata.name, {
        type: fileMetadata.type,
        lastModified: fileMetadata.lastModified,
      }));
    }
    return restoredFiles;
  } finally {
    database.close();
  }
}

export async function removeReportAttachments(id: string | null): Promise<void> {
  if (!isDraftId(id) || typeof indexedDB === 'undefined') return;
  const database = await openAttachmentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(REPORT_ATTACHMENT_STORE, 'readwrite');
      transaction.objectStore(REPORT_ATTACHMENT_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove attachments.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not remove attachments.'));
    });
  } finally {
    database.close();
  }
}
