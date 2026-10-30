import type { SetURLSearchParams } from 'react-router-dom';

export function readPageParam(params: URLSearchParams, key = 'page'): number {
  const raw = params.get(key);
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function updateAdminQuery(
  setSearchParams: SetURLSearchParams,
  updates: Record<string, string | number | null | undefined>,
  replace = false
): void {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    return next;
  }, { replace });
}

export function normalizePageParam(
  params: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  totalPages: number,
  key = 'page'
): void {
  const page = readPageParam(params, key);
  const safePage = Math.max(1, Math.min(page, Math.max(1, totalPages)));
  const raw = params.get(key);
  if (raw !== null && raw !== String(safePage)) {
    updateAdminQuery(setSearchParams, { [key]: safePage === 1 ? null : safePage }, true);
  }
}
