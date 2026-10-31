// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { initializeAdminTheme, useAdminTheme } from '@admin/hooks/useAdminTheme';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

function ThemeProbe() {
  const [theme, chooseTheme] = useAdminTheme();
  return <button aria-label="Theme" onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}>{theme}</button>;
}

function mediaQuery(matches: boolean) {
  let handler: ((event: MediaQueryListEvent) => void) | undefined;
  const addEventListener = vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => { handler = next; });
  const removeEventListener = vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => { if (handler === next) handler = undefined; });
  const list = { matches, addEventListener, removeEventListener } as unknown as MediaQueryList;
  return { list, addEventListener, removeEventListener, change: (next: boolean) => handler?.({ matches: next } as MediaQueryListEvent) };
}

function installMediaQuery(media: ReturnType<typeof mediaQuery>) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => media.list) });
}

describe('admin theme persistence and system preference', () => {
  it('uses the device preference until the operator chooses and persists a theme', () => {
    const media = mediaQuery(true);
    installMediaQuery(media);
    render(<ThemeProbe />);
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('dark');
    act(() => media.change(false));
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('dark');
    expect(localStorage.getItem('plfr-admin-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => media.change(false));
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('dark');
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('restores an explicit stored theme and applies it before the component renders', () => {
    localStorage.setItem('plfr-admin-theme', 'light');
    initializeAdminTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    const media = mediaQuery(true);
    installMediaQuery(media);
    render(<ThemeProbe />);
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('light');
    act(() => media.change(true));
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('light');
  });

  it('falls back to light when browser preference and storage are unavailable', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    initializeAdminTheme();
    render(<ThemeProbe />);
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('ignores invalid saved preferences and removes the media listener on unmount', () => {
    localStorage.setItem('plfr-admin-theme', 'sepia');
    const media = mediaQuery(false);
    installMediaQuery(media);
    const view = render(<ThemeProbe />);
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('light');
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
