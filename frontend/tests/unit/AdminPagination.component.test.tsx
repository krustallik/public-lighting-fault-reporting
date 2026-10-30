// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPagination } from '@admin/components/AdminPagination/AdminPagination';

afterEach(cleanup);

describe('AdminPagination', () => {
  it('shows adjacent pages and full first/last controls with a current-page marker', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<AdminPagination page={5} totalPages={11} totalRecords={255} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: '4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '5' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '6' })).toBeTruthy();
    expect(screen.getByText('Strana 5 z 11 · 255 záznamov')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Posledná strana' }));
    expect(onPageChange).toHaveBeenCalledWith(11);
  });

  it('disables unavailable navigation on the first and only page, including empty results', () => {
    const { rerender } = render(<AdminPagination page={1} totalPages={1} totalRecords={0} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Prvá strana' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Predchádzajúca strana' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Ďalšia strana' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Posledná strana' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Strana 1 z 1 · 0 záznamov')).toBeTruthy();

    rerender(<AdminPagination page={1} totalPages={1} totalRecords={1} onPageChange={vi.fn()} />);
    expect(screen.getByText('Strana 1 z 1 · 1 záznamov')).toBeTruthy();
  });
});
