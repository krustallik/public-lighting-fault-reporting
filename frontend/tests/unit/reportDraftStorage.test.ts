// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupExpiredReportDraftData,
  createReportDraftId,
  getReportDraftId,
  getReportDraftStep,
  markReportAttachmentCleanupPending,
  readReportAttachments,
  readReportDraft,
  readReportVerification,
  removeReportDraft,
  removeReportVerification,
  retryPendingReportAttachmentCleanup,
  saveReportDraft,
  saveReportAttachments,
  saveReportVerification,
} from '@/utils/reportDraftStorage';

const draftId = '294f7192-4f29-4cfb-a181-dc0c06d2a7a1';
const values = {
  locality: 'Jarná',
  detailDescription: 'User supplied detail',
  locationBlock: 'Q10',
  faultType: 'Q',
  otherFaultText: '',
  phone: '+421901234567',
  email: 'resident@example.test',
  consent: true,
};
const draft = {
  target: { kind: 'light-point' as const, lightPointId: 42 },
  formValues: values,
  step: 2 as const,
  attachmentCount: 0,
  userEditedFields: ['locality', 'detailDescription'] as Array<'locality' | 'detailDescription'>,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('report draft browser persistence', () => {
  it('creates opaque draft IDs and validates URL parameters', () => {
    expect(createReportDraftId()).toMatch(/^[0-9a-f-]{36}$/i);
    expect(getReportDraftId(`?draft=${draftId}&step=2`)).toBe(draftId);
    expect(getReportDraftId('?draft=not-an-id')).toBeNull();
    expect(getReportDraftStep('?draft=x&step=3')).toBe(3);
    expect(getReportDraftStep('?step=4')).toBeNull();
  });

  it('round-trips report fields, selected target and user-edited autofill fields', () => {
    expect(saveReportDraft(draftId, draft, 1000)).toBe(true);
    expect(readReportDraft(draftId, 1001)).toEqual({
      ...draft, submissionPending: false, submissionPendingSince: null,
      submissionRetryBlocked: false, preparedSubmission: null, updatedAt: 1000,
    });
    const serialized = localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`) ?? '';
    expect(serialized).toContain('User supplied detail');
    expect(serialized).not.toContain('verificationToken');
    expect(serialized).not.toContain('verificationCode');
  });

  it('round-trips a prepared retry payload without storing an OTP code or capability', () => {
    const preparedSubmission = {
      formValues: { ...values, detailDescription: 'User detail\nAddress: Jarná 12, Košice' },
      locale: 'sk' as const,
      addressEnrichmentStatus: 'not-found' as const,
    };
    expect(saveReportDraft(draftId, { ...draft, submissionPending: true, preparedSubmission })).toBe(true);
    const saved = readReportDraft(draftId);
    expect(saved?.preparedSubmission).toEqual(preparedSubmission);
    expect(saved?.submissionPendingSince).toEqual(expect.any(Number));
    expect(saved?.submissionRetryBlocked).toBe(false);
    const serialized = localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`) ?? '';
    expect(serialized).toContain('Address: Jarná 12, Košice');
    expect(serialized).not.toContain('verificationToken');
    expect(serialized).not.toContain('verificationCode');
  });

  it('anchors the retry deadline to the first pending attempt despite draft refreshes', () => {
    const ttl = 30 * 24 * 60 * 60 * 1000;
    const startedAt = 1_000;
    const preparedSubmission = { formValues: values, locale: 'sk' as const };
    saveReportDraft(draftId, { ...draft, submissionPending: true, preparedSubmission }, startedAt);
    const pending = readReportDraft(draftId, startedAt + ttl - 1_000);
    expect(pending?.submissionPendingSince).toBe(startedAt);

    saveReportDraft(draftId, {
      ...draft,
      submissionPending: true,
      preparedSubmission,
      submissionPendingSince: pending?.submissionPendingSince,
    }, startedAt + ttl - 1_000);

    const expired = readReportDraft(draftId, startedAt + ttl + 1);
    expect(expired?.submissionPending).toBe(true);
    expect(expired?.submissionRetryBlocked).toBe(true);
    expect(expired?.preparedSubmission).toEqual(preparedSubmission);
    expect(localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`)).not.toBeNull();
  });

  it('fails closed for pending drafts with corrupt prepared retry data', () => {
    const now = Date.now();
    localStorage.setItem(`plfr:public-report-draft:v1:${draftId}`, JSON.stringify({
      ...draft,
      submissionPending: true,
      submissionPendingSince: now,
      preparedSubmission: { formValues: { email: 'incomplete' }, locale: 'sk' },
      updatedAt: now,
    }));

    const restored = readReportDraft(draftId, now + 1);
    expect(restored?.submissionPending).toBe(true);
    expect(restored?.preparedSubmission).toBeNull();
    expect(restored?.submissionRetryBlocked).toBe(true);
  });

  it('blocks legacy pending drafts without an immutable retry deadline or prepared snapshot', () => {
    const now = Date.now();
    localStorage.setItem(`plfr:public-report-draft:v1:${draftId}`, JSON.stringify({
      ...draft,
      submissionPending: true,
      updatedAt: now,
    }));

    const restored = readReportDraft(draftId, now + 1);
    expect(restored?.submissionPending).toBe(true);
    expect(restored?.submissionRetryBlocked).toBe(true);
    expect(saveReportDraft(draftId, restored!, now + 2)).toBe(true);
    expect(readReportDraft(draftId, now + 3)?.submissionRetryBlocked).toBe(true);
  });

  it('removes an expired or malformed local draft rather than restoring it', () => {
    saveReportDraft(draftId, draft, 1000);
    expect(readReportDraft(draftId, 1000 + 30 * 24 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`)).toBeNull();

    localStorage.setItem(`plfr:public-report-draft:v1:${draftId}`, '{not-json');
    expect(readReportDraft(draftId)).toBeNull();
  });

  it('cleans expired report and verification records on the next application visit', async () => {
    const now = Date.now();
    saveReportDraft(draftId, draft, now - 30 * 24 * 60 * 60 * 1000 - 1);
    sessionStorage.setItem(`plfr:public-report-verification:v1:${draftId}`, JSON.stringify({
      intentId: 'expired-intent',
      email: 'resident@example.test',
      expiresAt: now + 60_000,
      retryAt: null,
      verificationToken: null,
    }));

    await cleanupExpiredReportDraftData(now);

    expect(localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`)).toBeNull();
    expect(sessionStorage.getItem(`plfr:public-report-verification:v1:${draftId}`)).toBeNull();
  });

  it('retries failed attachment cleanup using only an opaque draft ID', async () => {
    expect(markReportAttachmentCleanupPending(draftId)).toBe(true);
    const cleanupKey = `plfr:public-report-attachment-cleanup:v1:${draftId}`;
    expect(localStorage.getItem(cleanupKey)).toBe('1');
    expect(localStorage.getItem(cleanupKey)).not.toContain(values.email);

    const failedAttempt = vi.fn().mockRejectedValueOnce(new Error('Synthetic IndexedDB failure'));
    await retryPendingReportAttachmentCleanup(failedAttempt);
    expect(failedAttempt).toHaveBeenCalledWith(draftId);
    expect(localStorage.getItem(cleanupKey)).toBe('1');

    const successfulRetry = vi.fn().mockResolvedValue(undefined);
    await retryPendingReportAttachmentCleanup(successfulRetry);
    expect(successfulRetry).toHaveBeenCalledWith(draftId);
    expect(localStorage.getItem(cleanupKey)).toBeNull();
  });

  it('preserves attachments for a draft created while startup cleanup is waiting on IndexedDB', async () => {
    let transaction!: IDBTransaction;
    let cursorRequest!: IDBRequest<IDBCursorWithValue | null>;
    const deleteCursor = vi.fn();
    const cursor = {
      value: { draftId },
      delete: deleteCursor,
      continue: () => queueMicrotask(() => {
        Object.defineProperty(cursorRequest, 'result', { configurable: true, value: null });
        cursorRequest.onsuccess?.(new Event('success'));
        transaction.oncomplete?.(new Event('complete'));
      }),
    } as unknown as IDBCursorWithValue;
    const store = {
      openCursor: () => {
        cursorRequest = { onsuccess: null, onerror: null } as unknown as IDBRequest<IDBCursorWithValue | null>;
        queueMicrotask(() => {
          Object.defineProperty(cursorRequest, 'result', { configurable: true, value: cursor });
          cursorRequest.onsuccess?.(new Event('success'));
        });
        return cursorRequest;
      },
    } as unknown as IDBObjectStore;
    const database = {
      transaction: () => {
        transaction = {
          objectStore: () => store,
          oncomplete: null,
          onerror: null,
          onabort: null,
        } as unknown as IDBTransaction;
        return transaction;
      },
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const openRequest = {
      result: database,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
    } as unknown as IDBOpenDBRequest;
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => openRequest.onsuccess?.(new Event('success')));
        return openRequest;
      },
    } as unknown as IDBFactory);

    try {
      const cleanup = cleanupExpiredReportDraftData();
      saveReportDraft(draftId, { ...draft, attachmentCount: 1 });
      await cleanup;

      expect(deleteCursor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects tampered target, form and attachment metadata', () => {
    const key = `plfr:public-report-draft:v1:${draftId}`;
    for (const invalid of [
      { ...draft, target: { kind: 'light-point', lightPointId: -1 }, updatedAt: Date.now() },
      { ...draft, formValues: { ...values, consent: 'yes' }, updatedAt: Date.now() },
      { ...draft, attachmentCount: 21, updatedAt: Date.now() },
      { ...draft, userEditedFields: ['email'], updatedAt: Date.now() },
    ]) {
      localStorage.setItem(key, JSON.stringify(invalid));
      expect(readReportDraft(draftId)).toBeNull();
    }
  });

  it('fails closed when storage writes fail and tolerates disabled browser storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked'); });
    expect(saveReportDraft(draftId, draft)).toBe(false);
    expect(saveReportDraft('bad-id', draft)).toBe(false);
    expect(readReportDraft('bad-id')).toBeNull();
    expect(removeReportDraft('bad-id')).toBe(false);
  });

  it('keeps OTP capability in tab session storage, never stores the typed code, and expires it', () => {
    const now = Date.now();
    const verification = {
      intentId: 'intent-123',
      email: 'resident@example.test',
      expiresAt: now + 60_000,
      retryAt: now + 5_000,
      verificationToken: 'opaque-capability',
    };
    saveReportVerification(draftId, verification);
    expect(readReportVerification(draftId, now)).toEqual(verification);
    const serialized = sessionStorage.getItem(`plfr:public-report-verification:v1:${draftId}`) ?? '';
    expect(serialized).toContain('opaque-capability');
    expect(serialized).not.toContain('123456');
    expect(readReportVerification(draftId, now + 60_001)).toBeNull();
    expect(sessionStorage.getItem(`plfr:public-report-verification:v1:${draftId}`)).toBeNull();
  });

  it('rejects malformed verification metadata and removes the unusable session record', () => {
    const key = `plfr:public-report-verification:v1:${draftId}`;
    const now = 50_000;
    const valid = { intentId: 'intent', email: 'resident@example.test', expiresAt: now + 1000, retryAt: null, verificationToken: null };
    for (const invalid of [
      { ...valid, intentId: 4 },
      { ...valid, expiresAt: Number.POSITIVE_INFINITY },
      { ...valid, retryAt: 'later' },
      { ...valid, verificationToken: 6 },
      { ...valid, expiresAt: now },
    ]) {
      sessionStorage.setItem(key, JSON.stringify(invalid));
      expect(readReportVerification(draftId, now)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it('clears expired or explicitly removed verification state and tolerates unavailable session storage', () => {
    const key = `plfr:public-report-verification:v1:${draftId}`;
    const expired = { intentId: 'old', email: 'resident@example.test', expiresAt: Date.now() - 1, retryAt: null, verificationToken: null };
    sessionStorage.setItem(key, JSON.stringify(expired));
    saveReportVerification(draftId, expired);
    expect(sessionStorage.getItem(key)).toBeNull();
    saveReportVerification(draftId, {
      intentId: 'current', email: 'resident@example.test', expiresAt: Date.now() + 60_000, retryAt: null, verificationToken: null,
    });
    saveReportVerification(draftId, null);
    expect(sessionStorage.getItem(key)).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked'); });
    saveReportVerification(draftId, { ...expired, expiresAt: Date.now() + 60_000 });
    expect(readReportVerification(draftId)).toBeNull();
  });

  it('restores only valid attachment entries and closes IndexedDB after reading', async () => {
    const storedBlob = new Blob(['saved image'], { type: 'image/png' });
    const existingFile = new File(['already a file'], 'existing.txt', { type: 'text/plain' });
    const record = { files: [
      existingFile,
      { name: 'broken.png', type: 'image/png', lastModified: 1, content: 'not a Blob' },
      { name: 'saved.png', type: 'image/png', lastModified: 123, content: storedBlob },
    ] };
    const database = {
      transaction: () => ({ objectStore: () => ({ get: () => {
        const request = { onsuccess: null as null | ((event: Event) => void), onerror: null };
        queueMicrotask(() => {
          Object.defineProperty(request, 'result', { configurable: true, value: record });
          request.onsuccess?.(new Event('success'));
        });
        return request;
      } }) }),
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const openRequest = { result: database, onsuccess: null as null | ((event: Event) => void), onerror: null, onblocked: null, onupgradeneeded: null };
    vi.stubGlobal('indexedDB', { open: () => {
      queueMicrotask(() => openRequest.onsuccess?.(new Event('success')));
      return openRequest;
    } } as unknown as IDBFactory);

    const restored = await readReportAttachments(draftId);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBe(existingFile);
    expect(restored[1]).toMatchObject({ name: 'saved.png', type: 'image/png', lastModified: 123 });
    const restoredText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(restored[1]);
    });
    expect(restoredText).toBe('saved image');
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('rejects a failed attachment transaction and still closes its database handle', async () => {
    const database = {
      transaction: () => {
        const transaction = {
          oncomplete: null as null | ((event: Event) => void),
          onerror: null as null | ((event: Event) => void),
          onabort: null as null | ((event: Event) => void),
          objectStore: () => ({ put: vi.fn() }),
        };
        queueMicrotask(() => transaction.onabort?.(new Event('abort')));
        return transaction;
      },
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const openRequest = { result: database, onsuccess: null as null | ((event: Event) => void), onerror: null, onblocked: null, onupgradeneeded: null };
    vi.stubGlobal('indexedDB', { open: () => {
      queueMicrotask(() => openRequest.onsuccess?.(new Event('success')));
      return openRequest;
    } } as unknown as IDBFactory);

    await expect(saveReportAttachments(draftId, [new File(['payload'], 'image.png')])).rejects.toThrow('Could not save attachments.');
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('clears verification state after an explicit reset', () => {
    saveReportVerification(draftId, {
      intentId: 'intent-123',
      email: 'resident@example.test',
      expiresAt: Date.now() + 60_000,
      retryAt: null,
      verificationToken: null,
    });
    removeReportVerification(draftId);
    removeReportDraft(draftId);
    expect(readReportVerification(draftId)).toBeNull();
    expect(readReportDraft(draftId)).toBeNull();
  });

});
