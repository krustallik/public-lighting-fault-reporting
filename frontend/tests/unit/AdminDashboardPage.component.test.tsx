// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach } from 'vitest';
import { AdminDashboardPage } from '@admin/pages/AdminDashboardPage/AdminDashboardPage';

afterEach(cleanup);

describe('AdminDashboardPage', () => {
  it('presents the supported inventory, import, settings, and log destinations', () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Admin prehľad' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Svetelné body' }).getAttribute('href')).toBe('/panel-svietidla/street-lights');
    expect(screen.getByRole('link', { name: 'Import dát' }).getAttribute('href')).toBe('/panel-svietidla/import');
    expect(screen.getByRole('link', { name: 'Nastavenia integrácie' }).getAttribute('href')).toBe('/panel-svietidla/settings');
    expect(screen.getByRole('link', { name: 'Technické logy' }).getAttribute('href')).toBe('/panel-svietidla/logs');
    expect(screen.getByText(/neukladá osobné údaje občanov/i)).toBeTruthy();
  });
});
