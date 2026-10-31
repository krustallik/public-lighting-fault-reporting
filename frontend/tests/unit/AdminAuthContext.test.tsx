// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminAuthProvider, useAdminAuth } from '@admin/context/AdminAuthContext';

const { api } = vi.hoisted(() => ({ api: { me: vi.fn(), login: vi.fn(), logout: vi.fn() } }));
vi.mock('@admin/services/adminApi', () => ({ adminApi: api }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const admin = { id: 3, username: 'operator', fullName: 'Light Operator' };

function AuthProbe() {
  const auth = useAdminAuth();
  return <main>
    <output aria-label="Session">{auth.loading ? 'loading' : auth.admin?.username ?? 'anonymous'}</output>
    <button onClick={() => void auth.login('operator', 'synthetic-password').catch(() => undefined)}>Sign in</button>
    <button onClick={() => void auth.refreshAdmin()}>Refresh session</button>
    <button onClick={() => void auth.logout().catch(() => undefined)}>Sign out</button>
  </main>;
}

function renderAuth() { return render(<AdminAuthProvider><AuthProbe /></AdminAuthProvider>); }

describe('AdminAuthProvider', () => {
  it('restores a server session before leaving the loading state and supports login/logout', async () => {
    let resolveMe!: (value: typeof admin) => void;
    api.me.mockImplementationOnce(() => new Promise((resolve) => { resolveMe = resolve; }));
    api.login.mockResolvedValue(admin);
    api.logout.mockResolvedValue(undefined);
    renderAuth();
    expect(screen.getByLabelText('Session').textContent).toBe('loading');
    resolveMe(admin);
    await waitFor(() => expect(screen.getByLabelText('Session').textContent).toBe('operator'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.login).toHaveBeenCalledWith('operator', 'synthetic-password'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Session').textContent).toBe('anonymous'));
    expect(api.logout).toHaveBeenCalledOnce();
  });

  it('fails closed on session lookup or login failure and clears a session even if logout fails', async () => {
    api.me.mockRejectedValueOnce(new Error('expired session'));
    api.login.mockRejectedValueOnce(new Error('invalid credentials'));
    api.logout.mockRejectedValueOnce(new Error('network failure'));
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText('Session').textContent).toBe('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.login).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Session').textContent).toBe('anonymous');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Session').textContent).toBe('anonymous');
  });

  it('refreshes the current authenticated identity and clears it if the server no longer recognizes it', async () => {
    api.me.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ...admin, fullName: null }).mockRejectedValueOnce(new Error('revoked'));
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText('Session').textContent).toBe('operator'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Session').textContent).toBe('operator');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Session').textContent).toBe('anonymous');
  });
});
