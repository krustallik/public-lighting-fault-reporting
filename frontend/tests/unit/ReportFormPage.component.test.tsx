// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { ReportFormLocaleProvider } from '@/context/ReportFormLocaleContext';
import {
  api,
  EmailVerificationApiError,
  LocalTestEndpointError,
  LocalTestTransportUnavailableError,
} from '@/services/api';
import * as reportDraftStorage from '@/utils/reportDraftStorage';
import {
  ReportAddressSuggestionError,
  suggestReportAddress,
} from '@/services/geocodingApi';
import { getLightPoint } from '@/services/lightPointsApi';
import { saveReportDraft, saveReportVerification } from '@/utils/reportDraftStorage';
import type { LightPoint } from '@/types/lightPoint';
import type { LocalTestSubmitResponse } from '@/types/localTestSubmit';

vi.mock('@/services/lightPointsApi', () => ({
  getLightPoint: vi.fn(),
}));

vi.mock('@/services/geocodingApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/geocodingApi')>()),
  suggestReportAddress: vi.fn(),
}));

const getLightPointMock = vi.mocked(getLightPoint);
const suggestReportAddressMock = vi.mocked(suggestReportAddress);
const signedAddressProof = `v1.${'A'.repeat(43)}`;
const getEmailVerificationStatusMock = vi.spyOn(api, 'getEmailVerificationStatus');
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
      <button type="button" onClick={() => navigate('/report', { state: { reportTarget: { kind: 'manual' } } })}>Manual target</button>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
    </nav>
  );
}

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function ReportFormTestRouter({ withMapHistory = false }: { withMapHistory?: boolean }) {
  return (
    <ReportFormLocaleProvider>
      <MemoryRouter
        initialEntries={withMapHistory
          ? ['/map', { pathname: '/report', state: { reportTarget: { kind: 'light-point', lightPointId: 1 } } }]
          : [{ pathname: '/report', state: { reportTarget: { kind: 'light-point', lightPointId: 1 } } }]}
      >
        <TargetControls />
        <LocationSearchProbe />
        <Routes>
          <Route path="/report" element={<ReportFormPage />} />
          <Route path="/result" element={<ResultPage />} />
        </Routes>
      </MemoryRouter>
    </ReportFormLocaleProvider>
  );
}

function ReportDraftReloadRouter({ search, withTargetControls = false }: { search: string; withTargetControls?: boolean }) {
  return (
    <ReportFormLocaleProvider>
      <MemoryRouter initialEntries={[{ pathname: '/report', search }]}>
        {withTargetControls && <TargetControls />}
        <Routes>
          <Route path="/report" element={<ReportFormPage />} />
          <Route path="/result" element={<ResultPage />} />
        </Routes>
      </MemoryRouter>
    </ReportFormLocaleProvider>
  );
}

const persistedDraftId = '294f7192-4f29-4cfb-a181-dc0c06d2a7a1';
const persistedReportValues = {
  locality: 'Jarná',
  detailDescription: 'Saved report detail',
  locationBlock: 'Q10',
  faultType: 'Q',
  otherFaultText: '',
  phone: '+421901234567',
  email: 'resident@example.test',
  consent: true,
};

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
    const hiddenValue = screen.getByTestId('locality-field').querySelector<HTMLInputElement>('input[type="hidden"][name="locality"]');
    expect(hiddenValue?.value).toBe(value);
  });
}

async function getEditableLocality(user: ReturnType<typeof userEvent.setup>) {
  let locality = screen.queryByRole('combobox', { name: /Ulica|Street/ });
  if (!locality) {
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Upraviť lokalitu|Change locality/ }) ||
        screen.queryByRole('combobox', { name: /Ulica|Street/ })
      ).not.toBeNull();
    });
    const editButton = screen.queryByRole('button', { name: /Upraviť lokalitu|Change locality/ });
    if (editButton) await user.click(editButton);
    locality = await screen.findByRole('combobox', { name: /Ulica|Street/ });
  }
  return locality as HTMLInputElement;
}

async function chooseLocality(user: ReturnType<typeof userEvent.setup>, value: string) {
  const locality = await getEditableLocality(user);
  await user.clear(locality);
  await user.type(locality, value);
  await user.click(await screen.findByRole('option', { name: value }));
  return locality as HTMLInputElement;
}

async function clearLocality(user: ReturnType<typeof userEvent.setup>) {
  const locality = await getEditableLocality(user);
  await user.clear(locality);
  return locality as HTMLInputElement;
}

async function advanceToContactStep(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect((screen.getByRole('button', { name: /^(Ďalej|Next)$/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
  await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
  await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
  await user.click(screen.getByRole('button', { name: /^(Ďalej|Next)$/ }));
  expect(screen.getByText(/^(Krok 2 z [23]|Step 2 of [23])$/)).not.toBeNull();
}

async function submitValidReport(user: ReturnType<typeof userEvent.setup>, email = 'reporter@example.test') {
  await waitFor(() => {
    expect((screen.getByRole('button', { name: /^(Ďalej|Next)$/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  await chooseLocality(user, 'Jarná');
  await user.type(screen.getByLabelText(/Bližší popis/), 'ručný popis');
  await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
  await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
  await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
  await user.click(screen.getByRole('button', { name: 'Ďalej' }));
  await user.type(screen.getByLabelText(/E-mail/), email);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  getLightPointMock.mockReset();
  suggestReportAddressMock.mockReset();
  getEmailVerificationStatusMock.mockReset().mockResolvedValue({ enabled: false });
  sendLocalTestMock.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('ReportFormPage mounted target and interaction behavior', () => {
  it('requires a verified email before the review step and sends the bound token with final submission', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockResolvedValue(null);
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    const requestCodeMock = vi.spyOn(api, 'requestEmailVerificationCode').mockResolvedValue({
      success: true,
      intentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    });
    const verifyCodeMock = vi.spyOn(api, 'verifyEmailCode').mockResolvedValue({
      success: true,
      verificationToken: 'A'.repeat(43),
      expiresInSeconds: 570,
    });
    sendLocalTestMock
      .mockRejectedValueOnce(new LocalTestEndpointError('unavailable', 503, 'LOCAL_TEST_SUBMISSION_UNAVAILABLE'))
      .mockRejectedValueOnce(new LocalTestTransportUnavailableError())
      .mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');

    await user.click(screen.getByRole('button', { name: 'Poslať kód' }));
    await waitFor(() => expect(requestCodeMock).toHaveBeenCalledWith('resident@example.test', 'sk', undefined));
    expect(screen.queryByRole('button', { name: 'Odoslať na lokálny testovací endpoint' })).toBeNull();

    await user.type(screen.getByLabelText('Jednorazový kód'), '123456');
    await user.click(screen.getByRole('button', { name: 'Overiť e-mail' }));
    await waitFor(() => expect(verifyCodeMock).toHaveBeenCalledWith(
      '55c9af58-a37b-4f89-9039-bcc3737cd302',
      'resident@example.test',
      '123456'
    ));
    expect(screen.getByText('Krok 3 z 3')).toBeTruthy();
    expect(screen.getByText('Overený e-mail')).toBeTruthy();
    const reviewConsent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(reviewConsent.checked).toBe(false);
    const reviewSubmit = screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }) as HTMLButtonElement;
    expect(reviewSubmit.disabled).toBe(true);
    await user.click(reviewConsent);
    expect(reviewSubmit.disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect(screen.getByText('Krok 2 z 3')).toBeTruthy();
    expect(screen.getByText('E-mail je overený.')).toBeTruthy();
    const continueButton = screen.getByRole('button', { name: /Pokračovať/ });
    continueButton.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Krok 3 z 3')).toBeTruthy();
    expect(screen.getByText('Overený e-mail')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Overenie e-mailu je dočasne nedostupné.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' })).toBeTruthy();
    const pendingConsent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(pendingConsent.closest('fieldset')?.disabled).toBe(true);
    expect(pendingConsent.matches(':disabled')).toBe(true);
    expect(screen.getByText('Krok 3 z 3')).toBeTruthy();
    expect(screen.getByText('Jarná')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' }));
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Overenie e-mailu je dočasne nedostupné.')).toBeTruthy();
    expect(screen.getByText('Krok 3 z 3')).toBeTruthy();
    expect(screen.getByText('Jarná')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' }));
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).toBeTruthy();
    const formData = sendLocalTestMock.mock.calls[0][0];
    expect(sendLocalTestMock.mock.calls.map(([data]) => data.get('submissionAttemptId')))
      .toEqual([formData.get('submissionAttemptId'), formData.get('submissionAttemptId'), formData.get('submissionAttemptId')]);
    expect(formData.get('emailVerificationIntentId')).toBe('55c9af58-a37b-4f89-9039-bcc3737cd302');
    expect(formData.get('emailVerificationToken')).toBe('A'.repeat(43));
  });

  it('clears a verified capability when the email changes after returning from review', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    vi.spyOn(api, 'requestEmailVerificationCode').mockResolvedValue({
      success: true,
      intentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    });
    vi.spyOn(api, 'verifyEmailCode').mockResolvedValue({
      success: true,
      verificationToken: 'A'.repeat(43),
      expiresInSeconds: 570,
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');
    await user.click(screen.getByRole('button', { name: /Posla/ }));
    const codeInput = await screen.findByLabelText(/Jednoraz/);
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: /Overi/ }));
    await screen.findByText('Krok 3 z 3');
    await user.click(screen.getByRole('button', { name: /Sp/ }));
    expect(screen.getByText('E-mail je overený.')).toBeTruthy();

    await user.clear(screen.getByLabelText('E-mail *'));
    await user.type(screen.getByLabelText('E-mail *'), 'different@example.test');
    expect(screen.queryByLabelText(/Jednoraz/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Overi/ })).toBeNull();
    expect(screen.queryByText('E-mail je overený.')).toBeNull();
    expect(screen.queryByRole('button', { name: /kontrol/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Posla/ })).toBeTruthy();
  });
  it('shows a quiet retry countdown and blocks a first code request after rate limiting', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    const requestCodeMock = vi.spyOn(api, 'requestEmailVerificationCode')
      .mockRejectedValue(new EmailVerificationApiError(429, 'EMAIL_VERIFICATION_RATE_LIMITED', 60));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');

    const requestButton = screen.getByRole('button', { name: 'Poslať kód' });
    await user.click(requestButton);

    const countdown = await screen.findByRole('timer');
    expect(countdown.textContent).toContain('Kód si môžete vyžiadať o 60 s.');
    expect(countdown.getAttribute('aria-live')).toBe('off');
    expect(requestButton.hasAttribute('disabled')).toBe(true);
    expect(requestCodeMock).toHaveBeenCalledTimes(1);

    const email = screen.getByLabelText('E-mail *');
    await user.clear(email);
    await user.type(email, 'different@example.test');
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Poslať kód' }).hasAttribute('disabled')).toBe(false);
  });

  it('recomputes OTP expiry from wall time when the page resumes after device sleep', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    vi.spyOn(api, 'requestEmailVerificationCode').mockResolvedValue({
      success: true,
      intentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');
    await user.click(screen.getByRole('button', { name: 'Poslať kód' }));
    await screen.findByLabelText('Jednorazový kód');

    const originalNow = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(originalNow + 601_000);
    try {
      await act(async () => { window.dispatchEvent(new Event('focus')); });

      expect(screen.queryByLabelText('Jednorazový kód')).toBeNull();
      expect(screen.getByText('Platnosť kódu vypršala. Vyžiadajte si nový kód.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Poslať kód' }).hasAttribute('disabled')).toBe(false);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('does not allow continuing to review after the verification capability expires', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    vi.spyOn(api, 'requestEmailVerificationCode').mockResolvedValue({
      success: true,
      intentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    });
    vi.spyOn(api, 'verifyEmailCode').mockResolvedValue({
      success: true,
      verificationToken: 'A'.repeat(43),
      expiresInSeconds: 570,
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');
    await user.click(screen.getByRole('button', { name: /Posla/ }));
    await user.type(await screen.findByLabelText(/Jednoraz/), '123456');
    await user.click(screen.getByRole('button', { name: /Overi/ }));
    await screen.findByText('Krok 3 z 3');
    await user.click(screen.getByRole('button', { name: /Sp/ }));
    expect(screen.getByText('Krok 2 z 3')).toBeTruthy();
    const continueButton = screen.getByRole('button', { name: /kontrol/ });

    const originalNow = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(originalNow + 571_000);
    try {
      continueButton.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByText('Krok 2 z 3')).toBeTruthy();
      expect(screen.queryByText(/E-mail je overen/)).toBeNull();
      expect(screen.queryByRole('button', { name: /kontrol/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Posla/ })).toBeTruthy();
    } finally {
      dateNow.mockRestore();
    }
  });

  it('preserves the report and returns to verification when the server rejects an expired capability', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    vi.spyOn(api, 'requestEmailVerificationCode').mockResolvedValue({
      success: true,
      intentId: '55c9af58-a37b-4f89-9039-bcc3737cd302',
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
    });
    vi.spyOn(api, 'verifyEmailCode').mockResolvedValue({
      success: true,
      verificationToken: 'A'.repeat(43),
      expiresInSeconds: 570,
    });
    sendLocalTestMock.mockRejectedValue(new LocalTestEndpointError(
      'Verify the submitted email address before submitting this report.',
      403,
      'EMAIL_VERIFICATION_REQUIRED'
    ));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await advanceToContactStep(user);
    await user.type(screen.getByLabelText('E-mail *'), 'resident@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Poslať kód' }));
    await screen.findByLabelText('Jednorazový kód');
    await user.type(screen.getByLabelText('Jednorazový kód'), '123456');
    await user.click(screen.getByRole('button', { name: 'Overiť e-mail' }));
    await screen.findByText('Krok 3 z 3');

    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('Krok 2 z 3')).toBeTruthy();
    expect((screen.getByLabelText('E-mail *') as HTMLInputElement).value).toBe('resident@example.test');
    expect(screen.getByRole('button', { name: 'Poslať kód' })).toBeTruthy();
    expect(screen.getByText('Platnosť kódu vypršala. Vyžiadajte si nový kód.')).toBeTruthy();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);
  });

  it('keeps address lookup submit-only and groups approximate-address guidance with coordinates', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));

    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    for (const value of ['x', 'abc', 'videl som poruchu pri stožiari 12']) {
      await user.clear(detail);
      await user.type(detail, value);
      expect(detail.value).toBe(value);
    }
    expect(suggestReportAddressMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText(/text suggestion|textov.{0,10}n.{0,10}vrh/i)).toBeNull();
    expect((screen.getByRole('combobox', { name: /Ulica/ }) as HTMLInputElement).value).toBe('');
    const assistance = screen.getByTestId('location-assistance');
    expect(assistance.textContent).toContain('48.700000, 21.250000');
    expect(assistance.textContent).toContain('pri odoslaní automaticky doplní orientačná adresa');
    expect(assistance.textContent).toContain('* Automaticky určená adresa môže byť nepresná.');
    expect(screen.queryByRole('button', { name: 'Navrhnúť adresu pre vybrané súradnice' })).toBeNull();
    expect(assistance.contains(screen.getByRole('button', { name: 'Kopírovať súradnice' }))).toBe(true);
  });

  it('does one automatic lookup on custom-target submit, keeps operator notes out of public description, and never changes locality or textarea', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockResolvedValue({ address: 'Jarná 12, Košice', locality: 'Jarná', proof: signedAddressProof });
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await chooseLocality(user, 'Hlavná');
    const detailInput = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    await user.type(detailInput, 'ručný popis');
    expect(suggestReportAddressMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    await waitFor(() => expect(suggestReportAddressMock).toHaveBeenCalledTimes(1));
    expect(suggestReportAddressMock).toHaveBeenCalledWith({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'custom',
      language: 'sk',
    });
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(detailInput.value).toBe('ručný popis');
    const submitted = sendLocalTestMock.mock.calls[0][0];
    expect(submitted.get('properties[ulica_miesto_poruchy_lokalita]')).toBe('Hlavná');
    const detail = String(submitted.get('properties[detail_decription]'));
    expect(detail).toBe('ručný popis');
    expect(submitted.get('automaticAddress')).toBe('Jarná 12, Košice');
    expect(submitted.get('automaticAddressProof')).toBe(signedAddressProof);
    expect(detail).not.toContain('48.700000, 21.250000');
    expect(screen.queryByText('Jarná 12, Košice')).toBeNull();
  });

  it('waits for browser attachment cleanup before showing the successful submission result', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const cleanupPending = deferred<void>();
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic privacy cleanup check');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421900000001');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'uat-synthetic@example.invalid');
    await user.click(screen.getByRole('checkbox'));

    const removeAttachments = vi.spyOn(reportDraftStorage, 'removeReportAttachments')
      .mockReturnValueOnce(cleanupPending.promise);
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));
    await waitFor(() => expect(sendLocalTestMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(removeAttachments).toHaveBeenCalledOnce());
    expect(screen.queryByText('LOCAL TEST / SIMULATED')).toBeNull();

    await act(async () => cleanupPending.resolve());
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
  });

  it('shows local success and a safe notice when submitted attachment cleanup must be retried', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 1, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic cleanup failure check');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421900000001');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.upload(screen.getByLabelText('Prílohy'), new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' }));
    await user.type(screen.getByLabelText(/E-mail/), 'uat-synthetic@example.invalid');
    await user.click(screen.getByRole('checkbox'));
    const search = screen.getByTestId('location-search').textContent ?? '';
    const completedDraftId = new URLSearchParams(search).get('draft');

    const removeAttachments = vi.spyOn(reportDraftStorage, 'removeReportAttachments')
      .mockRejectedValueOnce(new Error('Synthetic IndexedDB failure'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Aplikácia sa ich pokúsi odstrániť pri ďalšom otvorení.');
    expect(removeAttachments).toHaveBeenCalledOnce();
    expect(completedDraftId).not.toBeNull();
    expect(localStorage.getItem(`plfr:public-report-attachment-cleanup:v1:${completedDraftId}`)).toBe('1');
    expect(localStorage.getItem(`plfr:public-report-draft:v1:${completedDraftId}`)).toBeNull();
  });

  it('does not promise a retry when browser storage rejects both cleanup marker and draft removal', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 1, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic cleanup storage failure');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421900000001');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.upload(screen.getByLabelText('Prílohy'), new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' }));
    await user.type(screen.getByLabelText(/E-mail/), 'uat-synthetic@example.invalid');
    await user.click(screen.getByRole('checkbox'));
    const search = screen.getByTestId('location-search').textContent ?? '';
    const completedDraftId = new URLSearchParams(search).get('draft');
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('plfr:public-report-attachment-cleanup:v1:')) throw new Error('Synthetic storage failure');
      return originalSetItem.call(this, key, value);
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (this === localStorage && key.startsWith('plfr:public-report-draft:v1:')) throw new Error('Synthetic storage failure');
      return originalRemoveItem.call(this, key);
    });
    vi.spyOn(reportDraftStorage, 'removeReportAttachments').mockRejectedValueOnce(new Error('Synthetic IndexedDB failure'));

    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Prehliadač nepotvrdil odstránenie príloh ani uloženie požiadavky na opakovanie.');
    expect(screen.getByRole('alert').textContent).not.toContain('pokúsi odstrániť pri ďalšom otvorení');
    expect(completedDraftId).not.toBeNull();
    expect(localStorage.getItem(`plfr:public-report-attachment-cleanup:v1:${completedDraftId}`)).toBeNull();
    expect(localStorage.getItem(`plfr:public-report-draft:v1:${completedDraftId}`)).not.toBeNull();
  });

  it('does one automatic lookup for a device target, but none for known-point or manual targets', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockResolvedValue({ address: 'Device address', proof: signedAddressProof });
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await submitValidReport(user);
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(suggestReportAddressMock).not.toHaveBeenCalled();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Device target' }));
    await submitValidReport(user);
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(suggestReportAddressMock).toHaveBeenCalledTimes(1);
    expect(suggestReportAddressMock).toHaveBeenCalledWith({
      latitude: 48.7,
      longitude: 21.25,
      targetKind: 'device',
      language: 'sk',
    });

    await user.click(screen.getByRole('button', { name: 'Manual target' }));
    await submitValidReport(user);
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect(suggestReportAddressMock).toHaveBeenCalledTimes(1);
    expect(sendLocalTestMock).toHaveBeenCalledTimes(3);
  });

  it('continues local submission after a validated provider failure and shows only the safe warning on success', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockRejectedValue(new ReportAddressSuggestionError('daily_budget_exceeded', true));
    sendLocalTestMock.mockResolvedValue({ success: true, status: 'local_test_received', filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf' });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await submitValidReport(user);

    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    expect((await screen.findByRole('status')).textContent)
      .toContain('Služba na automatické určenie adresy je momentálne nedostupná');
    expect(screen.queryByText(/daily_budget_exceeded|quota|provider|Geoapify/i)).toBeNull();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);
    expect(String(sendLocalTestMock.mock.calls[0][0].get('properties[detail_decription]')))
      .not.toContain('Automaticky určená adresa podľa zvolených súradníc');
  });

  it('does not show an address warning when the local report sink fails', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockRejectedValue(new ReportAddressSuggestionError('provider_unavailable', true));
    sendLocalTestMock.mockRejectedValue(Object.assign(new Error('Synthetic local endpoint unavailable'), {
      code: 'LOCAL_TEST_TRANSPORT_UNAVAILABLE',
    }));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    await submitValidReport(user);

    expect(await screen.findByText('Lokálny testovací endpoint nie je dostupný')).not.toBeNull();
    expect(screen.queryByText(/automatické určenie adresy je momentálne nedostupná/i)).toBeNull();
  });

  it('blocks local submit when target validation fails and keeps the detail text available', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockRejectedValue(new ReportAddressSuggestionError('outside_service_area', false));
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
    const locality = await getEditableLocality(user);
    await chooseLocality(user, 'Jarná');
    await user.click(screen.getByRole('button', { name: 'Kopírovať súradnice' }));
    expect((await screen.findByRole('status')).textContent).toContain('Súradnice boli skopírované.');
    expect(writeText).toHaveBeenCalledWith('48.700000, 21.250000');
    expect(screen.getByText(/48\.700000, 21\.250000/)).not.toBeNull();

    await user.type(screen.getByLabelText(/Bližší popis/), 'manual text');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Vybrané miesto nie je možné použiť');
    expect(locality.value).toBe('Jarná');
    expect(sendLocalTestMock).not.toHaveBeenCalled();
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

  it('keeps user edits and manual clears without refetching the same target after locale changes', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);

    await waitForLocality('Jarná');
    const locality = await getEditableLocality(user);
    const detail = screen.getByLabelText(/Bližší popis/) as HTMLTextAreaElement;
    await chooseLocality(user, 'Letná');
    await user.clear(detail);
    await user.type(detail, 'Manual target detail');

    await user.click(screen.getByRole('button', { name: 'Angličtina' }));
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(locality.value).toBe('Letná');
      expect(detail.value).toBe('Manual target detail');
    });

    await clearLocality(user);
    await user.clear(detail);
    await user.click(screen.getByRole('button', { name: 'Slovak' }));
    await waitFor(() => expect(getLightPointMock).toHaveBeenCalledTimes(1));
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
      filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
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
    expect(screen.getByText('Ulica / Miesto poruchy / Lokalita *')).not.toBeNull();
    expect(screen.getByText('Lokalita bola určená z adresy evidovaného svetelného bodu.')).not.toBeNull();
    expect(screen.getByLabelText(/Bližší popis \/ orientačný bod \/ číslo stožiara/)).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Lokalizácia - Blok' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Typ poruchy' })).not.toBeNull();
    expect(screen.getByLabelText(/Tel\. kontakt na Vás/)).not.toBeNull();

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    const stepOneControls = Array.from(form!.querySelectorAll('label, legend, [data-testid="locality-field"] p'))
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

  it('resolves a missing inventory address through the guarded address API and hides the locality input on a canonical match', async () => {
    getLightPointMock.mockResolvedValue(point(12, '', 'LP-12'));
    suggestReportAddressMock.mockResolvedValue({ address: 'Jarná 12, Košice', locality: 'Košice' });
    render(<ReportFormTestRouter />);

    await waitForLocality('Jarná');
    expect(suggestReportAddressMock).toHaveBeenCalledOnce();
    expect(suggestReportAddressMock).toHaveBeenCalledWith({
      targetKind: 'light-point',
      lightPointId: 1,
      language: 'sk',
    }, expect.any(AbortSignal));
    expect(screen.queryByRole('combobox', { name: /Ulica|Street/ })).toBeNull();
    expect(screen.getByText('Jarná 12, Košice')).not.toBeNull();
  });

  it('keeps a manual locality picker when the inventory address cannot be resolved', async () => {
    getLightPointMock.mockResolvedValue(point(12, '', 'LP-12'));
    suggestReportAddressMock.mockRejectedValue(new ReportAddressSuggestionError('provider_unavailable', true));
    render(<ReportFormTestRouter />);

    await screen.findByText('Adresu evidovaného bodu sa nepodarilo automaticky určiť. Vyberte lokalitu zo zoznamu.');
    expect(screen.getByRole('combobox', { name: /Ulica|Street/ })).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-testid="locality-field"] input[type="hidden"][name="locality"]')?.value).toBe('');
  });

  it('shows attachments first, then contact and verification, with consent after them', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));

    const attachments = screen.getByLabelText('Prílohy');
    const email = screen.getByLabelText('E-mail *');
    const verification = screen.getByRole('group', { name: 'Overenie e-mailu' });
    const consent = screen.getByRole('checkbox');
    expect(attachments.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(email.compareDocumentPosition(verification) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(verification.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
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
      filesReceived: 1, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
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
      filesReceived: 1, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
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
      'reportTarget',
      'submissionAttemptId',
    ]);
    expect(submitted.get('submissionAttemptId')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(JSON.parse(String(submitted.get('reportTarget')))).toEqual({ kind: 'light-point', lightPointId: 1 });
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

  it('starts a fresh submission attempt after success and browser Back', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0,
      receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter withMapHistory />);

    await submitValidReport(user);
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    const firstAttemptId = String(sendLocalTestMock.mock.calls[0][0].get('submissionAttemptId'));

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    await user.click(screen.getByRole('button', { name: 'Target A' }));
    await waitForLocality('Jarná');
    await submitValidReport(user, 'second-report@example.test');
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    const secondAttemptId = String(sendLocalTestMock.mock.calls[1][0].get('submissionAttemptId'));

    expect(sendLocalTestMock).toHaveBeenCalledTimes(2);
    expect(firstAttemptId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttemptId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttemptId).not.toBe(firstAttemptId);
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
    expect(screen.queryByText(/Výsledok predchádzajúceho pokusu nie je potvrdený/)).toBeNull();
    expect(sendLocalTestMock).toHaveBeenCalledTimes(1);

    await act(async () => pendingSubmit.resolve({
      success: true,
      status: 'local_test_received',
      filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
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

  it('restores an ambiguous submission as locked and retries the same attempt after browser Back', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock
      .mockRejectedValueOnce(new LocalTestTransportUnavailableError())
      .mockResolvedValueOnce({
        success: true,
        status: 'local_test_received',
        filesReceived: 0,
        receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
      });
    const user = userEvent.setup();
    render(<ReportFormTestRouter withMapHistory />);

    await submitValidReport(user);
    expect(await screen.findByText('Lokálny testovací endpoint nie je dostupný')).not.toBeNull();
    const firstFormData = sendLocalTestMock.mock.calls[0][0];
    const attemptId = String(firstFormData.get('submissionAttemptId'));
    expect(JSON.parse(localStorage.getItem(`plfr:public-report-draft:v1:${attemptId}`) ?? 'null')?.submissionPending).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByText(/Výsledok predchádzajúceho pokusu nie je potvrdený/)).toBeTruthy();
    const email = await screen.findByLabelText('E-mail *') as HTMLInputElement;
    expect(email.closest('fieldset[disabled]')).not.toBeNull();
    expect(email.matches(':disabled')).toBe(true);
    expect(email.value).toBe('reporter@example.test');
    const pendingConsent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(pendingConsent.closest('fieldset')?.disabled).toBe(true);
    expect(pendingConsent.matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' })).toBeTruthy();
    expect(email.value).toBe('reporter@example.test');

    await user.click(screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' }));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();
    const retryFormData = sendLocalTestMock.mock.calls[1][0];
    expect(retryFormData.get('submissionAttemptId')).toBe(attemptId);
    expect(retryFormData.get('email')).toBe(firstFormData.get('email'));
    expect(retryFormData.get('properties[ulica_miesto_poruchy_lokalita]'))
      .toBe(firstFormData.get('properties[ulica_miesto_poruchy_lokalita]'));
  });

  it('reuses the prepared Geoapify result and exact payload after a reload before retry', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    suggestReportAddressMock.mockResolvedValue({ address: 'Jarná 12, Košice', locality: 'Jarná', proof: signedAddressProof });
    sendLocalTestMock
      .mockRejectedValueOnce(new LocalTestTransportUnavailableError())
      .mockResolvedValueOnce({
        success: true,
        status: 'local_test_received',
        filesReceived: 0,
        receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
      });
    const user = userEvent.setup();
    const firstRender = render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    expect(await screen.findByText('Hlásenie sa týka vlastného miesta označeného na mape, nie konkrétneho bodu vybraného z evidencie.')).not.toBeNull();
    await chooseLocality(user, 'Hlavná');
    await user.type(screen.getByLabelText(/Bližší popis/), 'Synthetic landmark');
    await user.click(screen.getByRole('radio', { name: 'Pred blokom' }));
    await user.click(screen.getByRole('radio', { name: 'Svietidlo vôbec nesvieti' }));
    await user.type(screen.getByLabelText(/Tel\. kontakt na Vás/), '+421901234567');
    await user.click(screen.getByRole('button', { name: 'Ďalej' }));
    await user.type(screen.getByLabelText(/E-mail/), 'reporter@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odoslať na lokálny testovací endpoint' }));

    expect(await screen.findByText('Lokálny testovací endpoint nie je dostupný')).not.toBeNull();
    expect(suggestReportAddressMock).toHaveBeenCalledTimes(1);
    const firstFormData = sendLocalTestMock.mock.calls[0][0];
    const attemptId = String(firstFormData.get('submissionAttemptId'));
    const firstDetail = firstFormData.get('properties[detail_decription]');
    expect(firstDetail).toBe('Synthetic landmark');
    expect(firstFormData.get('automaticAddress')).toBe('Jarná 12, Košice');
    expect(firstFormData.get('automaticAddressProof')).toBe(signedAddressProof);
    const stored = JSON.parse(localStorage.getItem(`plfr:public-report-draft:v1:${attemptId}`) ?? 'null');
    expect(stored?.preparedSubmission?.formValues?.detailDescription).toBe(firstDetail);

    firstRender.unmount();
    render(<ReportDraftReloadRouter search={`?draft=${attemptId}&step=3`} />);
    await user.click(await screen.findByRole('button', { name: 'Zopakovať odoslanie hlásenia' }));
    expect(await screen.findByText('LOCAL TEST / SIMULATED')).not.toBeNull();

    expect(suggestReportAddressMock).toHaveBeenCalledTimes(1);
    const retryFormData = sendLocalTestMock.mock.calls[1][0];
    expect(retryFormData.get('automaticAddress')).toBe('Jarná 12, Košice');
    expect(retryFormData.get('automaticAddressProof')).toBe(signedAddressProof);
    expect(Array.from(retryFormData.entries())).toEqual(Array.from(firstFormData.entries()));
  });

  it('does not submit a pending retry when its saved payload cannot be restored', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const now = Date.now();
    localStorage.setItem(`plfr:public-report-draft:v1:${persistedDraftId}`, JSON.stringify({
      target: { kind: 'light-point', lightPointId: 1 },
      formValues: persistedReportValues,
      step: 3,
      attachmentCount: 0,
      submissionPending: true,
      submissionPendingSince: now,
      preparedSubmission: { formValues: { email: 'invalid snapshot' }, locale: 'sk' },
      userEditedFields: ['locality', 'detailDescription'],
      updatedAt: now,
    }));

    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=3`} />);

    expect(screen.getByText(/nemožno bezpečne zopakovať/)).not.toBeNull();
    const retry = screen.getByRole('button', { name: 'Zopakovať odoslanie hlásenia' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(sendLocalTestMock).not.toHaveBeenCalled();
  });

  it('blocks an already-open pending retry when its receipt deadline passes', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    const startedAt = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const preparedSubmission = { formValues: persistedReportValues, locale: 'sk' as const };
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 1 },
      formValues: persistedReportValues,
      step: 3,
      attachmentCount: 0,
      submissionPending: true,
      submissionPendingSince: startedAt,
      submissionRetryBlocked: false,
      preparedSubmission,
      userEditedFields: ['locality', 'detailDescription'],
    }, startedAt);
    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=3`} />);

    const retry = await screen.findByRole('button', { name: 'Zopakovať odoslanie hlásenia' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    dateNow.mockReturnValue(startedAt + 30 * 24 * 60 * 60 * 1000 + 1);

    fireEvent.submit(retry.closest('form')!);
    await waitFor(() => expect(sendLocalTestMock).not.toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(`plfr:public-report-draft:v1:${persistedDraftId}`) ?? 'null')?.submissionPending).toBe(true);

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(retry.disabled).toBe(true));
    expect(await screen.findByText(/nemožno bezpečne zopakovať/)).not.toBeNull();
  });

  it('keeps selected synthetic map coordinates and internal notes out of public text fields', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
    });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);
    await waitForLocality('Jarná');
    await user.click(screen.getByRole('button', { name: 'Custom map target' }));
    expect(await screen.findByText(/vlastného miesta označeného na mape/)).not.toBeNull();

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
    expect(detail).toBe('Synthetic map landmark');
    expect(detail).not.toContain('48.700000, 21.250000');
    expect(String(detail)).not.toContain('databáze');
  });

  it('keeps a confirmed device-derived target distinct from a known light point', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    sendLocalTestMock.mockResolvedValue({
      success: true,
      status: 'local_test_received',
      filesReceived: 0, receiptId: '4ddc41c3-ce9f-4dd4-9ec0-6c7f7b7f43cf',
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
        <MemoryRouter initialEntries={['/report']}>
          <Routes>
            <Route path="/report" element={<ReportFormPage />} />
            <Route path="/map" element={<h1>Map recovery</h1>} />
          </Routes>
        </MemoryRouter>
      </ReportFormLocaleProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Map recovery' })).not.toBeNull();
  });

  it('restores the selected inventory target and entered fields after a report route reload', async () => {
    getLightPointMock.mockResolvedValue(point(42, 'Jarná', 'LP-42'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: false });
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 42 },
      formValues: persistedReportValues,
      step: 2,
      attachmentCount: 0,
      userEditedFields: ['locality', 'detailDescription'],
    });

    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=2`} />);

    expect(await screen.findByLabelText('E-mail *')).toHaveProperty('value', 'resident@example.test');
    expect(screen.getByText('Krok 2 z 2')).not.toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(getLightPointMock).toHaveBeenCalledWith(42);
  });

  it('does not restore attachments from the previous target when an IndexedDB read finishes late', async () => {
    getLightPointMock.mockImplementation(async (id) => point(id, 'Jarná', `LP-${id}`));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: false });
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 1 },
      formValues: persistedReportValues,
      step: 2,
      attachmentCount: 1,
      userEditedFields: [],
    });
    const delayedRestore = deferred<File[]>();
    const attachmentReader = vi.spyOn(reportDraftStorage, 'readReportAttachments')
      .mockReturnValueOnce(delayedRestore.promise);
    const user = userEvent.setup();

    try {
      render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=2`} withTargetControls />);
      await waitFor(() => expect(attachmentReader).toHaveBeenCalledWith(persistedDraftId));
      await user.click(screen.getByRole('button', { name: 'Target B' }));
      await waitFor(() => expect(getLightPointMock).toHaveBeenCalledWith(2));
      await act(async () => {
        delayedRestore.resolve([new File(['stale attachment'], 'old-target.txt', { type: 'text/plain' })]);
      });

      expect(screen.queryByText('old-target.txt')).toBeNull();
    } finally {
      attachmentReader.mockRestore();
    }
  });

  it('puts only the opaque draft id and current step in the URL', async () => {
    getLightPointMock.mockResolvedValue(point(1, 'Jarná', 'LP-1'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: false });
    const user = userEvent.setup();
    render(<ReportFormTestRouter />);

    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toMatch(/^\?draft=[0-9a-f-]{36}&step=1$/i));
    await advanceToContactStep(user);
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toMatch(/^\?draft=[0-9a-f-]{36}&step=2$/i));
    expect(screen.getByTestId('location-search').textContent).not.toContain('resident@example.test');
  });

  it('restores the pending OTP input and intent after reload without persisting the entered code', async () => {
    getLightPointMock.mockResolvedValue(point(42, 'Jarná', 'LP-42'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    const requestCodeMock = vi.spyOn(api, 'requestEmailVerificationCode').mockReset();
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 42 },
      formValues: persistedReportValues,
      step: 2,
      attachmentCount: 0,
      userEditedFields: ['locality', 'detailDescription'],
    });
    saveReportVerification(persistedDraftId, {
      intentId: 'intent-pending-42',
      email: 'resident@example.test',
      expiresAt: Date.now() + 5 * 60_000,
      retryAt: Date.now() + 30_000,
      verificationToken: null,
    });
    const user = userEvent.setup();

    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=2`} />);

    const codeInput = await screen.findByLabelText('Jednorazový kód');
    expect(codeInput).toHaveProperty('value', '');
    expect(screen.getByText('Kód bol odoslaný. Skontrolujte poštu a zadajte ho nižšie.')).not.toBeNull();
    expect(requestCodeMock).not.toHaveBeenCalled();
    await user.type(codeInput, '123456');
    const storedDraft = localStorage.getItem(`plfr:public-report-draft:v1:${persistedDraftId}`) ?? '';
    const storedVerification = sessionStorage.getItem(`plfr:public-report-verification:v1:${persistedDraftId}`) ?? '';
    expect(storedDraft).not.toContain('verificationCode');
    expect(storedVerification).not.toContain('123456');
  });

  it('restores an unexpired verified review capability and permits Back then Continue', async () => {
    getLightPointMock.mockResolvedValue(point(42, 'Jarná', 'LP-42'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 42 },
      formValues: persistedReportValues,
      step: 3,
      attachmentCount: 0,
      userEditedFields: ['locality', 'detailDescription'],
    });
    saveReportVerification(persistedDraftId, {
      intentId: 'intent-verified-42',
      email: 'resident@example.test',
      expiresAt: Date.now() + 5 * 60_000,
      retryAt: null,
      verificationToken: 'A'.repeat(43),
    });
    const user = userEvent.setup();

    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=3`} />);

    expect(await screen.findByText('Skontrolujte hlásenie')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect(screen.getByText('Krok 2 z 3')).not.toBeNull();
    expect(screen.getByText('E-mail je overený.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pokračovať na kontrolu' }));
    expect(screen.getByText('Skontrolujte hlásenie')).not.toBeNull();
  });

  it.each([
    ['expired verification', 'resident@example.test', Date.now() - 1],
    ['verification for a different email', 'another@example.test', Date.now() + 60_000],
  ])('returns a restored %s to contact step without bypassing verification', async (_caseName, savedEmail, expiresAt) => {
    getLightPointMock.mockResolvedValue(point(42, 'Jarná', 'LP-42'));
    getEmailVerificationStatusMock.mockResolvedValue({ enabled: true });
    saveReportDraft(persistedDraftId, {
      target: { kind: 'light-point', lightPointId: 42 },
      formValues: persistedReportValues,
      step: 3,
      attachmentCount: 0,
      userEditedFields: ['locality', 'detailDescription'],
    });
    saveReportVerification(persistedDraftId, {
      intentId: 'intent-stale-42',
      email: savedEmail,
      expiresAt,
      retryAt: null,
      verificationToken: 'A'.repeat(43),
    });

    render(<ReportDraftReloadRouter search={`?draft=${persistedDraftId}&step=3`} />);

    expect(await screen.findByLabelText('E-mail *')).toHaveProperty('value', 'resident@example.test');
    await waitFor(() => expect(screen.getByText('Krok 2 z 3')).not.toBeNull());
    expect(screen.queryByText('Skontrolujte hlásenie')).toBeNull();
  });
});
