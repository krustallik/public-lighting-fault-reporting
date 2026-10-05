// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { api } from '@/services/api';
import { getLightPoint } from '@/services/lightPointsApi';
import type { LightPoint } from '@/types/lightPoint';
import type { LocalTestSubmitResponse } from '@/types/localTestSubmit';

vi.mock('@/services/lightPointsApi', () => ({
  getLightPoint: vi.fn(),
}));

const getLightPointMock = vi.mocked(getLightPoint);
const sendLocalTestMock = vi.spyOn(api, 'sendLocalTestSubmission');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TargetControls() {
  const navigate = useNavigate();

  return (
    <nav aria-label="Synthetic test targets">
      <button type="button" onClick={() => navigate('/report?lightPointId=1')}>Target A</button>
      <button type="button" onClick={() => navigate('/report?lightPointId=2')}>Target B</button>
      <button type="button" onClick={() => navigate('/report?lat=48.7&lng=21.25')}>Custom map target</button>
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
        <Route path="/result" element={<ResultPage />} />
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
  sessionStorage.clear();
  getLightPointMock.mockReset();
  sendLocalTestMock.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
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
    expect(oldFileInput.files?.length).toBe(0);

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
      fields: {},
      files: [],
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

    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
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
  });

  it('shows step-one required errors without moving focus from Next to the first invalid field', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    const next = screen.getByRole('button', { name: 'Ďalej' });
    await user.selectOptions(screen.getByLabelText(/Ulica \/ Miesto poruchy/), '');
    await user.click(next);

    expect(await screen.findByText('Ulica / miesto poruchy / lokalita je povinná')).not.toBeNull();
    expect(screen.getByText('Tel. kontakt je povinný')).not.toBeNull();
    expect(screen.getByText('Krok 1 z 2')).not.toBeNull();
    const locality = screen.getByLabelText(/Ulica \/ Miesto poruchy/) as HTMLSelectElement;
    const phone = screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement;
    expect(locality.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(locality.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Ulica / miesto poruchy / lokalita je povinná');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(phone.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Tel. kontakt je povinný');
    expect(document.activeElement).toBe(next);
  });

  it('preserves step-one selections on Back/Next and keeps submit disabled until consent', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');

    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));

    const submit = screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect((screen.getByRole('radio', { name: 'Pred blokom' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Tel\. kontakt na Vás/) as HTMLInputElement).value).toBe('synthetic contact');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();
    expect(submit.disabled).toBe(true);
  });

  it('keeps invalid email on the contact step and requires explicit consent before local submit', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
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
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();
    expect(sendLocalTestMock).not.toHaveBeenCalled();
  });

  it('submits synthetic VO data only to the mocked local seam and renders local receipt semantics', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const response: LocalTestSubmitResponse = {
      success: true,
      status: 'local_test_received',
      fields: { 'properties[vyber_sluzby]': '2' },
      files: [{ filename: 'synthetic.txt', mimeType: 'text/plain', size: 9 }],
    };
    const pendingSubmit = deferred<LocalTestSubmitResponse>();
    sendLocalTestMock.mockReturnValue(pendingSubmit.promise);
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'EN' }));
    await waitForLocality('Jarná');

    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
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
    expect(screen.getByText(/does not establish external acceptance/i)).not.toBeNull();
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

  it('renders a local failure result without attempting an alternate report transport', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockRejectedValue(Object.assign(new Error('Synthetic local endpoint unavailable'), {
      code: 'LOCAL_TEST_TRANSPORT_UNAVAILABLE',
    }));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('Local test submission endpoint unavailable')).not.toBeNull();
    expect(screen.getByText('LOCAL_TEST_TRANSPORT_UNAVAILABLE')).not.toBeNull();
    expect(screen.getByText('No alternate report transport was attempted.')).not.toBeNull();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);
  });

  it('appends the selected synthetic map coordinates to detail text before local submission', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      fields: {},
      files: [],
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    expect(await screen.findByText(/mimo evidovaných stĺpov/)).not.toBeNull();

    await user.selectOptions(screen.getByLabelText(/Ulica \/ Miesto poruchy/), 'Hlavná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic map landmark');
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), 'synthetic contact');
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
});
