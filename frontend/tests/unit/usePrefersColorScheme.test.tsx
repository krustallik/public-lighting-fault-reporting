// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_THEME_STORAGE_KEY, usePrefersColorScheme } from '../../src/hooks/usePrefersColorScheme';

let systemMatchesDark = false;
const listeners = new Set<EventListenerOrEventListenerObject>();
const mediaQuery = {
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener)),
  removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener)),
} as unknown as MediaQueryList;

Object.defineProperty(mediaQuery, 'matches', {
  configurable: true,
  get: () => systemMatchesDark,
});

const originalMatchMedia = window.matchMedia;

function dispatchSystemPreference(matches: boolean) {
  systemMatchesDark = matches;
  const event = new Event('change') as MediaQueryListEvent;
  Object.defineProperty(event, 'matches', { value: matches });
  for (const listener of listeners) {
    if (typeof listener === 'function') listener(event);
    else listener.handleEvent(event);
  }
}

beforeEach(() => {
  systemMatchesDark = false;
  listeners.clear();
  localStorage.clear();
  window.matchMedia = vi.fn(() => mediaQuery);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('usePrefersColorScheme', () => {
  it('tracks system changes until an explicit theme choice is stored', () => {
    const { result } = renderHook(() => usePrefersColorScheme());
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => dispatchSystemPreference(true));
    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current[1]('light'));
    act(() => dispatchSystemPreference(true));
    expect(result.current[0]).toBe('light');
    expect(localStorage.getItem(MAP_THEME_STORAGE_KEY)).toBe('light');
  });

  it('prefers a previously selected theme over the current system preference', () => {
    localStorage.setItem(MAP_THEME_STORAGE_KEY, 'dark');
    systemMatchesDark = false;

    const { result } = renderHook(() => usePrefersColorScheme());
    expect(result.current[0]).toBe('dark');
    act(() => dispatchSystemPreference(false));
    expect(result.current[0]).toBe('dark');
  });
});
