import { useCallback, useEffect, useState } from 'react';

export type ColorScheme = 'light' | 'dark';
export const MAP_THEME_STORAGE_KEY = 'public-map-theme';

function readStoredScheme(): ColorScheme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(MAP_THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function getSystemScheme(): ColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Uses the system preference until the user explicitly chooses a map theme. */
export function usePrefersColorScheme(): [ColorScheme, (scheme: ColorScheme) => void] {
  const [scheme, setScheme] = useState<ColorScheme>(() => readStoredScheme() ?? getSystemScheme());
  const [explicitlyChosen, setExplicitlyChosen] = useState(() => readStoredScheme() !== null);

  const chooseScheme = useCallback((next: ColorScheme) => {
    setScheme(next);
    setExplicitlyChosen(true);
    try {
      localStorage.setItem(MAP_THEME_STORAGE_KEY, next);
    } catch {
      // A browser with storage disabled can still use the in-memory theme.
    }
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (!explicitlyChosen && readStoredScheme() === null) setScheme(event.matches ? 'dark' : 'light');
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [explicitlyChosen]);

  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  return [scheme, chooseScheme];
}
