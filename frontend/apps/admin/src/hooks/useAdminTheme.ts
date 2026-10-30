import { useCallback, useEffect, useState } from 'react';

export type AdminTheme = 'light' | 'dark';
const STORAGE_KEY = 'plfr-admin-theme';

function getSystemTheme(): AdminTheme {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function readTheme(): AdminTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* Continue with the device preference. */ }
  return getSystemTheme();
}

export function initializeAdminTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.dataset.theme = stored;
      document.documentElement.style.colorScheme = stored;
    }
  } catch { /* CSS follows the device preference when storage is unavailable. */ }
}

export function useAdminTheme(): [AdminTheme, (theme: AdminTheme) => void] {
  const [theme, setTheme] = useState<AdminTheme>(readTheme);
  const [explicit, setExplicit] = useState(() => {
    try { const stored = localStorage.getItem(STORAGE_KEY); return stored === 'light' || stored === 'dark'; }
    catch { return false; }
  });

  const chooseTheme = useCallback((next: AdminTheme) => {
    setTheme(next);
    setExplicit(true);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* in-memory preference remains active */ }
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (explicit) return;
      const next = event.matches ? 'dark' : 'light';
      setTheme(next);
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = next;
    };
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, [explicit]);

  return [theme, chooseTheme];
}
