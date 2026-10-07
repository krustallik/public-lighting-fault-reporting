// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { ReportFormLocaleProvider } from '@/context/ReportFormLocaleContext';
import { api } from '@/services/api';
import { getReportAddressAssistanceCapability, suggestReportAddress } from '@/services/geocodingApi';
import { getLightPoint } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import type { LocalTestSubmitResponse } from '@/types/localTestSubmit';

vi.mock('@/services/lightPointsApi', () => ({
  getLightPoint: vi.fn(),
}));

vi.mock('@/services/geocodingApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/geocodingApi')>()),
  getReportAddressAssistanceCapability: vi.fn(),
  suggestReportAddress: vi.fn(),
}));

const getLightPointMock = vi.mocked(getLightPoint);
const getAddressCapabilityMock = vi.mocked(getReportAddressAssistanceCapability);
const suggestReportAddressMock = vi.mocked(suggestReportAddress);
const sendLocalTestMock = vi.spyOn(api, 'sendLocalTestSubmission');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TargetControls() {
  const navigate = useNavigate();

  return (
    <nav aria-label="Synthetic test targets">
      <button type="button" onClick={() => navigate('/report', { state: { reportTarget: { kind: 'light-point', lightPointId: 1 } } })}>Target A</button>
      <button type="button" onClick={() => navigate('/report', { state: { reportTarget: { kind: 'light-point', lightPointId: 2 } } })}>Target B</button>
      <button type="button" onClick={() => navigate('/report', { state: { reportTarget: { kind: 'custom', latitude: 48.7, longitude: 21.25 } } })}>Custom map target</button>
      <button type="button" onClick={() => navigate('/report', { state: { reportTarget: { kind: 'device', latitude: 48.7, longitude: 21.25 } } })}>Device target</button>
    </nav>
  );
}

function ReportFormTestRouter() {
  return (
    <ReportFormLocaleProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/report', state: { reportTarget: { kind: 'light-point', lightPointId: 1 } } }]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <TargetControls />
        <Routes>
          <Route path="/report" element={<ReportFormPage />} />
          <Route path="/result" element={<ResultPage />} />
        </Routes>
      </MemoryRouter>
    </ReportFormLocaleProvider>
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
    expect((screen.getByRole('combobox', { name: /Ulica|Street/ }) as HTMLInputElement).value).toBe(value);
  });
}

async function chooseLocality(user: ReturnType<typeof userEvent.setup>, value: string) {
  const locality = screen.getByRole('combobox', { name: /Ulica|Street/ });
  await user.clear(locality);
  await user.type(locality, value);
  await user.click(await screen.findByRole('option', { name: value }));
  return locality as HTMLInputElement;
}

async function clearLocality(user: ReturnType<typeof userEvent.setup>) {
  const locality = screen.getByRole('combobox', { name: /Ulica|Street/ });
  await user.clear(locality);
  return locality as HTMLInputElement;
}

async function advanceToContactStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
  await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
  await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
  await user.click(screen.getByRole('button', { name: /^(Ďalej|Next)$/ }));
  expect(screen.getByText(/^(Krok 2 z 2|Step 2 of 2)$/)).not.toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  getLightPointMock.mockReset();
  getAddressCapabilityMock.mockReset();
  getAddressCapabilityMock.mockResolvedValue(false);
  suggestReportAddressMock.mockReset();
  sendLocalTestMock.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('ReportFormPage mounted target and interaction behavior', () => {
  it('keeps detailDescription ordinary free text with no address requests or suggestion UI', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await waitFor(() => expect(getAddressCapabilityMock).toHaveBeenCalledTimes(1));

    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    for (const value of ['x', 'abc', 'videl som poruchu pri stožiari 12']) {
      await user.clear(detail);
      await user.type(detail, value);
      expect(detail.value).toBe(value);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggestReportAddressMock).not.toHaveBeenCalled();
    expect(getAddressCapabilityMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/text suggestion|textov.{0,10}n.{0,10}vrh/i)).toBeNull();
    expect((screen.getByRole('combobox', { name: /Ulica/ }) as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('coordinate-tools').textContent).toContain('48.700000, 21.250000');
  });

  it('hides reverse assistance when the backend capability is disabled', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await waitFor(() => expect(getAddressCapabilityMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('address-suggestion-controls')).toBeNull();
    expect(screen.queryByText(/Geoapify|address suggestion.*unavailable|návrh adresy.*nedostupn/i)).toBeNull();
    expect(suggestReportAddressMock).not.toHaveBeenCalled();
  });

  it('requests an address only after an explicit action for a custom/device target', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getAddressCapabilityMock.mockResolvedValue(true);
    suggestReportAddressMock.mockResolvedValue({ address: 'Jarná 12, Košice', locality: 'Jarná' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);

    await waitForLocality('Jarná');
    expect(screen.queryByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await screen.findByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' });
    expect(screen.getByTestId('locality-field').contains(
      screen.getByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' })
    )).toBe(true);
    await user.type(screen.getByLabelText(/Bližší popis/), 'ručný popis');
    expect(suggestReportAddressMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));
    await waitFor(() => expect(suggestReportAddressMock).toHaveBeenCalledTimes(1));
    expect(suggestReportAddressMock).toHaveBeenCalledWith({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'custom',
      language: 'sk',
    }, expect.any(AbortSignal));
    expect((screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement).value).toBe('ručný popis');

    await user.click(screen.getByRole('button', { name: 'Device target' }));
    await screen.findByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' });
    expect(suggestReportAddressMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));
    await waitFor(() => expect(suggestReportAddressMock).toHaveBeenCalledTimes(2));
    expect(suggestReportAddressMock).toHaveBeenLastCalledWith({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'device',
      language: 'sk',
    }, expect.any(AbortSignal));
  });

  it('shows an editable suggestion for the selected coordinates and never overwrites a manual edit made while lookup is pending', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getAddressCapabilityMock.mockResolvedValue(true);
    const response = deferred<{ address: string; locality?: string }>();
    const laterResponse = deferred<{ address: string; locality?: string }>();
    suggestReportAddressMock
      .mockReturnValueOnce(response.promise)
      .mockReturnValueOnce(laterResponse.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await user.click(await screen.findByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));

    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    await user.clear(detail);
    await user.type(detail, 'Manuálne overená adresa');
    await act(async () => response.resolve({ address: 'Jarná 12, Košice', locality: 'Jarná' }));

    expect((await screen.findByRole('status')).textContent).toContain('navrhnutá pre zvolené súradnice');
    expect(detail.value).toBe('Manuálne overená adresa');
    const locality = screen.getByRole('combobox', { name: /Ulica|Street/ }) as HTMLInputElement;
    expect(locality.value).toBe('Jarná');

    await chooseLocality(user, 'Letná');
    await user.click(screen.getByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));
    await act(async () => laterResponse.resolve({ address: 'Nová adresa 5', locality: 'Nová' }));
    expect(detail.value).toBe('Manuálne overená adresa');
    expect(locality.value).toBe('Letná');
  });

  it('ignores a late address response after the selected target changes', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getAddressCapabilityMock.mockResolvedValue(true);
    const response = deferred<{ address: string; locality?: string }>();
    suggestReportAddressMock.mockReturnValue(response.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await user.click(await screen.findByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));
    await user.click(screen.getByRole('button', { name: 'Device target' }));
    await act(async () => response.resolve({ address: 'Stará adresa 1', locality: 'Jarná' }));

    expect((screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps manual address entry usable when suggestions are unavailable and offers local coordinate copy', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getAddressCapabilityMock.mockResolvedValue(true);
    suggestReportAddressMock.mockRejectedValue(new Error('Unavailable'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    expect(window.navigator.clipboard.writeText).toBe(writeText);
    expect(navigator.clipboard?.writeText).toBe(writeText);
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await user.click(await screen.findByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/zadať ručne/i);
    const locality = screen.getByRole('combobox', { name: /Ulica/ }) as HTMLInputElement;
    expect(locality.disabled).toBe(false);
    await chooseLocality(user, 'Jarná');
    await user.click(screen.getByRole('button', { name: 'Kopírovať súradnice' }));
    expect((await screen.findAllByRole('status')).map((status) => status.textContent)).toContain(
      'Súradnice boli skopírované.'
    );
    expect(writeText).toHaveBeenCalledWith('48.700000, 21.250000');
    expect(screen.getByText(/48\.700000, 21\.250000/)).not.toBeNull();
  });

  it('clears a stale manually injected phone error as soon as a valid value is entered and still rejects a later invalid value', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await chooseLocality(user, 'Jarná');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));

    const phone = screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement;
    await user.type(phone, '0901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    expect(await screen.findByText(/medzinárodnom formáte/)).not.toBeNull();

    await user.clear(phone);
    await user.type(phone, '+421951449039');
    await waitFor(() => expect(screen.queryByText(/medzinárodnom formáte/)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Späť' }));
    const phoneAfterBack = screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement;
    await user.clear(phoneAfterBack);
    await user.type(phoneAfterBack, '0901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    expect(await screen.findByText(/medzinárodnom formáte/)).not.toBeNull();
    expect(screen.getByText('Krok 1 z 2')).not.toBeNull();
  });

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
    const locality = screen.getByRole('combobox', { name: /Ulica/ }) as HTMLInputElement;
    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    await chooseLocality(user, 'Letná');
    await user.clear(detail);
    await user.type(detail, 'Manual target detail');

    await user.click(screen.getByRole('button', { name: 'Angličtina' }));
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(2));
    await act(async () => secondFetch.resolve(point(1, 'Letná', 'LP-1-updated')));
    await waitFor(() => {
      expect(locality.value).toBe('Letná');
      expect(detail.value).toBe('Manual target detail');
    });

    await clearLocality(user);
    await user.clear(detail);
    await user.click(screen.getByRole('button', { name: 'Slovak' }));
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
    expect(oldFileInput.files?.length).toBe(0);
    expect(oldFileInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(oldFileInput.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Súbor môže mať najviac 30 MiB');

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
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0,
    });
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

    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    const submitted = sendLocalTestMock.mock.calls[0][0];
    expect(submitted.get('properties[typ_poruchy]')).toBe('Q99');
    expect(submitted.has('properties[iny_druh_poruchy]')).toBe(false);
  });

  it('renders the VO-only field order and keeps equal Q10 codes in separate named groups', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    expect(screen.queryByLabelText(/service|slu.bu/i)).toBeNull();
    expect(screen.queryByLabelText('Prílohy')).toBeNull();
    expect(screen.getByLabelText(/Ulica \/ Miesto poruchy \/ Lokalita/)).not.toBeNull();
    expect(screen.getByLabelText(/Bližší popis \/ orientačný bod \/ číslo stožiara/)).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Lokalizácia - Blok' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Typ poruchy' })).not.toBeNull();
    expect(screen.getByLabelText(/Tel\. kontakt na Vás/)).not.toBeNull();

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    const stepOneControls = Array.from(form!.querySelectorAll('label, legend'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter((text) => /^(Ulica \/ Miesto poruchy \/ Lokalita|Bližší popis \/ orientačný bod \/ číslo stožiara|Lokalizácia - Blok|Typ poruchy|Tel\. kontakt na Vás)( \*)?$/.test(text));
    expect(stepOneControls).toEqual([
      'Ulica / Miesto poruchy / Lokalita *',
      'Bližší popis / orientačný bod / číslo stožiara',
      'Lokalizácia - Blok',
      'Typ poruchy',
      'Tel. kontakt na Vás *',
    ]);

    const blockQ10 = screen.getByRole('radio', { name: 'Pred blokom' }) as HTMLInputElement;
    const faultQ10 = screen.getByRole('radio', {
      name: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
    }) as HTMLInputElement;
    expect(blockQ10.value).toBe('Q10');
    expect(faultQ10.value).toBe('Q10');
    expect(blockQ10.checked).toBe(false);
    expect(faultQ10.checked).toBe(false);

    const user = userEvent.setup();
    blockQ10.focus();
    await user.keyboard(' ');
    expect(blockQ10.checked).toBe(true);
    expect(faultQ10.checked).toBe(false);
    await user.click(faultQ10);
    expect(blockQ10.checked).toBe(true);
    expect(faultQ10.checked).toBe(true);
  });

  it('announces step-one required errors and focuses the first invalid field', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    const next = screen.getByRole('button', { name: 'Ďalej' });
    await clearLocality(user);
    await user.click(next);

    const localityError = 'Napíšte názov a vyberte ho z návrhov ako platnú lokalitu.';
    const phoneError = 'Zadajte číslo v medzinárodnom formáte, napr. +421901234567 (8 až 15 číslic).';
    expect(await screen.findByText(localityError, { selector: '#locality-error' })).not.toBeNull();
    expect(screen.getByText(phoneError)).not.toBeNull();
    expect(screen.getByText('Krok 1 z 2')).not.toBeNull();
    const locality = screen.getByRole('combobox', { name: /Ulica \/ Miesto poruchy/ }) as HTMLInputElement;
    const phone = screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement;
    expect(locality.getAttribute('aria-invalid')).toBe('true');
    expect(locality.getAttribute('aria-describedby')?.split(/\s+/)).toContain('locality-error');
    expect(document.getElementById('locality-error')?.textContent).toBe(localityError);
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')?.split(/\s+/)).toContain('phone-error');
    expect(document.getElementById('phone-error')?.textContent).toBe(phoneError);
    expect(document.activeElement).toBe(locality);
    expect(screen.getAllByRole('alert').some((alert) =>
      alert.textContent?.includes('Skontrolujte označené polia')
    )).toBe(true);
  });

  it('preserves step-one selections on Back/Next and keeps submit disabled until consent', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));

    const submit = screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const attachment = new File(['synthetic'], 'back-next.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Prílohy'), attachment);
    expect(screen.getByText(/back-next\.txt/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect((screen.getByRole('radio', { name: 'Pred blokom' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement).value).toBe('+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();
    expect(screen.getByText(/back-next\.txt/)).not.toBeNull();
    const submitAfterNext = screen.getByRole('button', {
      name: 'Odoslať na lokálny testovací endpoint',
    }) as HTMLButtonElement;
    expect(submitAfterNext.disabled).toBe(true);

    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 1,
    });
    await user.type(screen.getByLabelText(/E-mail/), 'synthetic@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(submitAfterNext);
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(1));
    const formData = sendLocalTestMock.mock.calls[0][0];
    expect((formData.get('files[]') as File).name).toBe('back-next.txt');
  });

  it('keeps invalid email on the contact step and requires explicit consent before local submit', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'bad-address');

    const submit = screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    await user.click(submit);

    expect(await screen.findByText('Neplatný e-mail')).not.toBeNull();
    const email = screen.getByLabelText(/E-mail/) as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(email.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Neplatný e-mail');
    expect(document.activeElement).toBe(email);
    expect(screen.getByRole('alert').textContent).toContain('Skontrolujte označené polia');
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();
    expect(sendLocalTestMock).not.toHaveBeenCalled();
  });

  it('submits synthetic VO data only to the mocked local seam and renders local receipt semantics', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const response: LocalTestSubmitResponse = {
      success: true,
      status: 'local_test_received',
      filesReceived: 1,
    };
    const pendingSubmit = deferred<LocalTestSubmitResponse>();
    sendLocalTestMock.mockReturnValue(pendingSubmit.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'Angličtina' }));
    await waitForLocality('Jarná');
    await chooseLocality(user, 'Jarná');

    await user.click(screen.getByRole('radio', { name: 'In front of the block' }));
    await user.click(screen.getByRole('radio', { name: 'Street light does not turn on' }));
    await user.type(screen.getByLabelText(/Phone number/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/Email/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));

    const attachment = new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Attachments'), attachment);
    await user.click(screen.getByRole('button', { name: 'Send to local test endpoint' }));

    const submitting = await screen.findByRole('button', { name: 'Submitting…' }) as HTMLButtonElement;
    expect(submitting.disabled).toBe(true);
    expect(screen.queryByText('LOCAL TEST / SIMULATED')).toBeNull();
    await act(async () => pendingSubmit.resolve(response));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(screen.getByText(/does not establish acceptance by an external system/i)).not.toBeNull();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);

    const submitted = sendLocalTestMock.mock.calls[0][0];
    expect(Array.from(submitted.keys())).toEqual([
      'properties[vyber_sluzby]',
      'properties[ulica_miesto_poruchy_lokalita]',
      'properties[detail_decription]',
      'properties[lokalizacia_blok]',
      'properties[typ_poruchy]',
      'properties[tel_cislo]',
      'files[]',
      'email',
      'locale',
    ]);
    expect(submitted.get('properties[vyber_sluzby]')).toBe('2');
    expect(submitted.get('properties[ulica_miesto_poruchy_lokalita]')).toBe('Jarná');
    expect(submitted.get('properties[detail_decription]')).toBe('Inventory number: LP-1');
    expect(submitted.get('properties[lokalizacia_blok]')).toBe('Q10');
    expect(submitted.get('properties[typ_poruchy]')).toBe('Q');
    expect(submitted.get('email')).toBe('reporter@example.test');
    expect(submitted.get('locale')).toBe('en');
    expect((submitted.get('files[]') as File).name).toBe('synthetic.txt');
    expect(Array.from(submitted.keys()).some((key) => /css|service.?16/i.test(key))).toBe(false);
    expect(submitted.has('consent')).toBe(false);
    expect(submitted.has('lightPointId')).toBe(false);
  });

  it('sends exactly one local request after rapid double activation', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const pendingSubmit = deferred<LocalTestSubmitResponse>();
    sendLocalTestMock.mockReturnValue(pendingSubmit.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText(/E-mail/), 'rapid-activation@example.test');
    await user.click(screen.getByRole('checkbox'));

    const submit = screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' });
    await user.dblClick(submit);

    const submitting = await screen.findByRole('button', { name: 'Odosiela sa…' }) as HTMLButtonElement;
    expect(submitting.disabled).toBe(true);
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);

    await act(async () => pendingSubmit.resolve({
      success: true,
      status: 'local_test_received',
      filesReceived: 0,
    }));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
  });

  it('renders a local failure result without attempting an alternate report transport', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockRejectedValue(Object.assign(new Error('Synthetic local endpoint unavailable'), {
      code: 'LOCAL_TEST_TRANSPORT_UNAVAILABLE',
    }));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('Lokálny testovací endpoint nie je dostupný')).not.toBeNull();
    expect(screen.queryByText('LOCAL_TEST_TRANSPORT_UNAVAILABLE')).toBeNull();
    expect(screen.getByText('Nepoužil sa žiadny náhradný spôsob odoslania.')).not.toBeNull();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);
  });

  it('appends the selected synthetic map coordinates to detail text before local submission', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0,
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    expect(await screen.findByText(/mimo evidovaných stĺpov/)).not.toBeNull();

    await chooseLocality(user, 'Hlavná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic map landmark');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    const submitted = sendLocalTestMock.mock.calls[0][0];
    const detail = submitted.get('properties[detail_decription]');
    expect(detail).toContain('Synthetic map landmark');
    expect(detail).toContain('48.700000, 21.250000');
    expect(detail).toContain('Vybraný stĺp nie je evidovaný v databáze');
    expect(detail).toContain('Súradnice:');
  });

  it('keeps a confirmed device-derived target distinct from a known light point', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0,
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(1));
    getLightPointMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'Device target' }));

    expect(await screen.findByText('Výslovne ste vybrali polohu zariadenia ako cieľ hlásenia.')).not.toBeNull();
    expect(screen.queryByText(/mimo evidovaných stĺpov/)).toBeNull();
    expect(getLightPointMock).not.toHaveBeenCalled();
  });

  it('redirects a refreshed report route without ephemeral target state to the map recovery path', async () => {
    render(
      <ReportFormLocaleProvider>
        <MemoryRouter initialEntries={['/report']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/report" element={<ReportFormPage />} />
            <Route path="/map" element={<h1>Map recovery</h1>} />
          </Routes>
        </MemoryRouter>
      </ReportFormLocaleProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Map recovery' })).not.toBeNull();
  });
});
