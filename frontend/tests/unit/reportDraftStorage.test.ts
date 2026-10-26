// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupExpiredReportDraftData,
  createReportDraftId,
  getReportDraftId,
  getReportDraftStep,
  readReportDraft,
  readReportVerification,
  removeReportDraft,
  removeReportVerification,
  saveReportDraft,
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
    expect(readReportDraft(draftId, 1001)).toEqual({ ...draft, updatedAt: 1000 });
    const serialized = localStorage.getItem(`plfr:public-report-draft:v1:${draftId}`) ?? '';
    expect(serialized).toContain('User supplied detail');
    expect(serialized).not.toContain('verificationToken');
    expect(serialized).not.toContain('verificationCode');
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
    removeReportDraft('bad-id');
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
