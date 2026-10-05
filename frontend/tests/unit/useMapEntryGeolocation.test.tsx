// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMapEntryGeolocation,
  type MapEntryGeolocationState,
} from '../../src/hooks/useMapEntryGeolocation';

type SuccessCallback = PositionCallback;
type ErrorCallback = PositionErrorCallback;

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

function setGeolocation(value: Geolocation | undefined) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value,
  });
}

function Harness({ onState }: { onState: (state: MapEntryGeolocationState) => void }) {
  const state = useMapEntryGeolocation();
  useEffect(() => onState(state), [onState, state]);
  return <output aria-label="Geolocation status">{state.status}</output>;
}

function position(latitude = 48.7, longitude = 21.25): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 1_791_200_000_000,
    toJSON: () => ({}),
  };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, 'geolocation');
  }
});

describe('useMapEntryGeolocation', () => {
  it('requests one high-accuracy fresh position on map entry, including under StrictMode', async () => {
    let success: SuccessCallback | undefined;
    const getCurrentPosition = vi.fn((onSuccess: SuccessCallback) => {
      success = onSuccess;
    });
    setGeolocation({ getCurrentPosition } as unknown as Geolocation);
    const onState = vi.fn();

    render(<StrictMode><Harness onState={onState} /></StrictMode>);
    await act(async () => { vi.runOnlyPendingTimers(); });

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );

    await act(async () => success?.(position()));
    expect(screen.getByLabelText('Geolocation status').textContent).toBe('available');
    expect(onState.mock.calls.at(-1)?.[0].position).toMatchObject({
      latitude: 48.7,
      longitude: 21.25,
      accuracy: 12,
    });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('maps browser error %i to %s', async (code, expectedStatus) => {
    const getCurrentPosition = vi.fn((_success: SuccessCallback, error: ErrorCallback) => {
      error({ code, message: 'Synthetic browser error' } as GeolocationPositionError);
    });
    setGeolocation({ getCurrentPosition } as unknown as Geolocation);
    const onState = vi.fn();
    render(<Harness onState={onState} />);

    await act(async () => { vi.runOnlyPendingTimers(); });

    expect(screen.getByLabelText('Geolocation status').textContent).toBe(expectedStatus);
  });

  it('falls back when geolocation is unsupported or returns unusable coordinates', async () => {
    setGeolocation(undefined);
    const onState = vi.fn();
    const view = render(<Harness onState={onState} />);
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(screen.getByLabelText('Geolocation status').textContent).toBe('unsupported');

    view.unmount();
    let success: SuccessCallback | undefined;
    setGeolocation({ getCurrentPosition: vi.fn((callback: SuccessCallback) => { success = callback; }) } as unknown as Geolocation);
    render(<Harness onState={onState} />);
    await act(async () => { vi.runOnlyPendingTimers(); });
    await act(async () => success?.(position(91, 21.25)));
    expect(screen.getByLabelText('Geolocation status').textContent).toBe('unavailable');
  });

  it('falls back when the browser geolocation call throws synchronously', async () => {
    setGeolocation({
      getCurrentPosition: vi.fn(() => { throw new Error('Synthetic insecure-context failure'); }),
    } as unknown as Geolocation);
    const onState = vi.fn();
    render(<Harness onState={onState} />);

    await act(async () => { vi.runOnlyPendingTimers(); });

    expect(screen.getByLabelText('Geolocation status').textContent).toBe('unavailable');
    expect(onState.mock.calls.at(-1)?.[0].position).toBeNull();
  });

  it('ignores a late success callback after the map owner has unmounted', async () => {
    let success: SuccessCallback | undefined;
    const getCurrentPosition = vi.fn((callback: SuccessCallback) => { success = callback; });
    setGeolocation({ getCurrentPosition } as unknown as Geolocation);
    const onState = vi.fn();
    const view = render(<Harness onState={onState} />);
    await act(async () => { vi.runOnlyPendingTimers(); });
    const callsBeforeUnmount = onState.mock.calls.length;

    view.unmount();
    await act(async () => success?.(position()));

    expect(onState).toHaveBeenCalledTimes(callsBeforeUnmount);
  });
});
