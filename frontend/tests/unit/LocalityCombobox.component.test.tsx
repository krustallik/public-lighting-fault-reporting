// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalityCombobox } from '../../src/components/LocalityCombobox/LocalityCombobox';

const choices = [
  { value: 'Hlavná', label: 'Hlavná' },
  { value: 'Hlavná cesta', label: 'Hlavná cesta' },
  { value: 'Stará cesta', label: 'Stará cesta' },
];

afterEach(cleanup);

function renderCombobox(value = '', resetKey = 'target-a', onSelect = vi.fn()) {
  const onEdit = vi.fn();
  const view = render(
    <>
      <label htmlFor="locality">Street / fault location / locality *</label>
      <LocalityCombobox
        id="locality"
        value={value}
        choices={choices}
        resetKey={resetKey}
        placeholder="Start typing a locality…"
        noMatchesText="No canonical localities match."
        listboxLabel="Localities"
        selectionHint="Select a canonical locality from the suggestions."
        onEdit={onEdit}
        onSelect={onSelect}
      />
      <button type="button">Next field</button>
      <output aria-label="Selected canonical locality">{value}</output>
    </>
  );
  return { ...view, onEdit, onSelect };
}

describe('LocalityCombobox', () => {
  it('uses a ranked, bounded accessible list and selects a canonical value with the keyboard', async () => {
    const user = userEvent.setup();
    const { onEdit, onSelect } = renderCombobox();
    const input = screen.getByRole('combobox', { name: /Street/ });

    await user.type(input, 'HLAVNA');
    expect(onEdit).toHaveBeenCalled();
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Hlavná', 'Hlavná cesta']);
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('Hlavná');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps unmatched text out of the selected canonical value and never commits it with Enter', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderCombobox();
    const input = screen.getByRole('combobox', { name: /Street/ }) as HTMLInputElement;

    await user.type(input, 'Unknown street');
    expect(screen.getAllByRole('status').some((status) =>
      status.textContent === 'No canonical localities match.'
    )).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-controls')).toBe(false);
    await user.keyboard('{Enter}');

    expect(input.value).toBe('Unknown street');
    expect(screen.getByLabelText('Selected canonical locality').textContent).toBe('');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('supports pointer selection and exposes the scrollable listbox to keyboard users without trapping Tab', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderCombobox();
    const input = screen.getByRole('combobox', { name: /Street/ });
    await user.type(input, 'Stará');
    await user.click(screen.getByRole('option', { name: 'Stará cesta' }));
    expect(onSelect).toHaveBeenCalledWith('Stará cesta');

    await user.clear(input);
    await user.type(input, 'H');
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Localities' }));
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('Hlavná');

    await user.clear(input);
    await user.type(input, 'H');
    await user.keyboard('{Tab}');
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next field' }));
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('reflects autofill and clears stale suggestions when the report target changes', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const view = renderCombobox('Hlavná', 'target-a', onSelect);
    const input = screen.getByRole('combobox', { name: /Street/ }) as HTMLInputElement;
    expect(input.value).toBe('Hlavná');

    await user.clear(input);
    await user.type(input, 'Stará');
    expect(screen.getByRole('option', { name: 'Stará cesta' })).not.toBeNull();

    view.rerender(
      <>
        <label htmlFor="locality">Street / fault location / locality *</label>
        <LocalityCombobox
          id="locality"
          value="Stará cesta"
          choices={choices}
          resetKey="target-b"
          placeholder="Start typing a locality…"
          noMatchesText="No canonical localities match."
          listboxLabel="Localities"
          selectionHint="Select a canonical locality from the suggestions."
          onEdit={vi.fn()}
          onSelect={onSelect}
        />
      </>
    );
    expect((screen.getByRole('combobox', { name: /Street/ }) as HTMLInputElement).value).toBe('Stará cesta');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
