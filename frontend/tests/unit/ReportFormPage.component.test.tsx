// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { getLightPoint } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';

vi.mock('@/services/lightPointsApi', () => ({
  getLightPoint: vi.fn(),
}));

const getLightPointMock = vi.mocked(getLightPoint);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TargetControls() {
  const navigate = useNavigate();

  return (
    <nav aria-label="Synthetic test targets">
      <button type="button" onClick={() => navigate('/report?lightPointId=1')}>Target A</button>
      <button type="button" onClick={() => navigate('/report?lightPointId=2')}>Target B</button>
    </nav>
  );
}

function ReportFormTestRouter() {
  return (
    <MemoryRouter
      initialEntries={['/report?lightPointId=1']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TargetControls />
      <Routes>
        <Route path="/report" element={<ReportFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function point(id: number, address: string, inventoryNumber: string): LightPoint {
  return {
    id,
    inventory_number: inventoryNumber,
    latitude: 48.7,
    longitude: 21.25,
    address,
    type: 'LED',
    status: 'active',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForLocality(value: string) {
  await waitFor(() => {
    expect((screen.getByLabelText(/Ulica/) as HTMLSelectElement).value).toBe(value);
  });
}

async function advanceToContactStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
  await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
  await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '0900123456');
  await user.click(screen.getByRole('button', { name: /^(Ďalej|Next)$/ }));
  expect(screen.getByText(/^(Krok 2 z 2|Step 2 of 2)$/)).not.toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  getLightPointMock.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ReportFormPage mounted target and interaction behavior', () => {
  it('keeps user edits and manual clears when the same target is fetched again after locale changes', async () => {
    const secondFetch = deferred<LightPoint>();
    const thirdFetch = deferred<LightPoint>();
    getLightPointMock
      .mockResolvedValueOnce(point(1, 'Jarná', 'LP-1'))
      .mockImplementationOnce(() => secondFetch.promise)
      .mockImplementationOnce(() => thirdFetch.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);

    await waitForLocality('Jarná');
    const locality = screen.getByLabelText(/Ulica/) as HTMLSelectElement;
    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    await user.selectOptions(locality, 'Letná');
    await user.clear(detail);
    await user.type(detail, 'Manual target detail');

    await user.click(screen.getByRole('button', { name: 'EN' }));
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(2));
    await act(async () => secondFetch.resolve(point(1, 'Letná', 'LP-1-updated')));
    await waitFor(() => {
      expect(locality.value).toBe('Letná');
      expect(detail.value).toBe('Manual target detail');
    });

    await user.selectOptions(locality, '');
    await user.clear(detail);
    await user.click(screen.getByRole('button', { name: 'SK' }));
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(3));
    await act(async () => thirdFetch.resolve(point(1, 'Jarná', 'LP-1')));
    await waitFor(() => {
      expect(locality.value).toBe('');
      expect(detail.value).toBe('');
    });
  });

  it('resets form values, step, validation errors, and selected files when target A changes to B', async () => {
    getLightPointMock.mockImplementation(async (id) =>
      id === 1 ? point(1, 'Jarná', 'LP-1') : point(2, 'Letná', 'LP-2')
    );
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await advanceToContactStep(user);

    const oldFileInput = screen.getByLabelText('Prílohy') as HTMLInputElement;
    const attachment = new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' });
    await user.upload(oldFileInput, attachment);
    expect(oldFileInput.files?.length).toBe(1);
    expect(screen.getByText(/synthetic\.txt/)).not.toBeNull();

    await user.type(screen.getByLabelText(/E-mail/), 'not-an-email');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));
    expect(await screen.findByText('Neplatný e-mail')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Target B' }));
    await waitForLocality('Letná');
    expect(screen.getByText(/^(Krok 1 z 2|Step 1 of 2)$/)).not.toBeNull();
    expect((screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement).value).toMatch(/^(Inventárne číslo|Inventory number): LP-2$/);
    expect((screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('radio', { name: 'Pred blokom' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/synthetic\.txt/)).toBeNull();

    await advanceToContactStep(user);
    expect((screen.getByLabelText(/E-mail/) as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Neplatný e-mail')).toBeNull();
    const newFileInput = screen.getByLabelText('Prílohy') as HTMLInputElement;
    expect(newFileInput).not.toBe(oldFileInput);
    expect(newFileInput.files?.length).toBe(0);
  });

  it('clears the visible file error and remounts the file input after a target change', async () => {
    getLightPointMock.mockImplementation(async (id) =>
      id === 1 ? point(1, 'Jarná', 'LP-1') : point(2, 'Letná', 'LP-2')
    );
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await advanceToContactStep(user);

    const oldFileInput = screen.getByLabelText('Prílohy') as HTMLInputElement;
    const tooLarge = new File(['x'], 'oversized.txt', { type: 'text/plain' });
    Object.defineProperty(tooLarge, 'size', { configurable: true, value: 30 * 1024 * 1024 + 1 });
    await user.upload(oldFileInput, tooLarge);
    expect(await screen.findByText('Súbor môže mať najviac 30 MiB')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Target B' }));
    await waitForLocality('Letná');
    await advanceToContactStep(user);

    const newFileInput = screen.getByLabelText('Prílohy') as HTMLInputElement;
    expect(newFileInput).not.toBe(oldFileInput);
    expect(newFileInput.files?.length).toBe(0);
    expect(screen.queryByText('Súbor môže mať najviac 30 MiB')).toBeNull();
  });

  it('does not let a stale target A response overwrite resolved target B data', async () => {
    const pendingA = deferred<LightPoint>();
    getLightPointMock
      .mockImplementationOnce(() => pendingA.promise)
      .mockResolvedValueOnce(point(2, 'Letná', 'LP-2'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Target B' }));
    await waitForLocality('Letná');
    await act(async () => pendingA.resolve(point(1, 'Jarná', 'LP-1')));
    await waitForLocality('Letná');
    expect((screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement).value).toBe('Inventárne číslo: LP-2');
  });

  it('ignores a rejected stale target A request after target B has loaded', async () => {
    const pendingA = deferred<LightPoint>();
    getLightPointMock
      .mockImplementationOnce(() => pendingA.promise)
      .mockResolvedValueOnce(point(2, 'Letná', 'LP-2'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Target B' }));
    await waitForLocality('Letná');
    await act(async () => pendingA.reject(new Error('Synthetic stale request failure')));
    await waitForLocality('Letná');
    expect((screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement).value).toBe('Inventárne číslo: LP-2');
  });

  it('shows the Q99 field, clears it on a non-Q99 choice, and does not restore stale text', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    await user.click(screen.getByRole('radio', { name: 'Iný druh poruchy' }));
    const otherFault = screen.getByRole('textbox', { name: 'Iný druh poruchy' }) as HTMLTextAreaElement;
    await user.type(otherFault, 'Synthetic custom fault');
    expect(otherFault.value).toBe('Synthetic custom fault');

    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    expect(screen.queryByRole('textbox', { name: 'Iný druh poruchy' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Iný druh poruchy' }));
    expect((screen.getByRole('textbox', { name: 'Iný druh poruchy' }) as HTMLTextAreaElement).value).toBe('');
  });
});
