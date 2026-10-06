// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TargetConfirmationDialog } from '../../src/components/TargetConfirmationDialog/TargetConfirmationDialog';
import { getReportFormMessages } from '../../src/i18n/reportFormMessages';

const confirmationMessages = getReportFormMessages('sk').confirmation;

afterEach(cleanup);

describe('TargetConfirmationDialog', () => {
  it('describes a custom target and confirms it with keyboard-operable controls', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <TargetConfirmationDialog
        target={{ kind: 'custom', latitude: 48.7, longitude: 21.25 }}
        summary="Selected map point"
        messages={confirmationMessages}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onHide={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Potvrďte miesto hlásenia' });
    expect(dialog.textContent).toContain('48.700000, 21.250000');
    const confirm = screen.getByRole('button', { name: 'Potvrdiť miesto' });
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with Escape and restores focus to the invoking control', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <TargetConfirmationDialog
        target={{ kind: 'light-point', lightPointId: 7 }}
        summary="Jarná, light point 7"
        messages={confirmationMessages}
        returnFocusTo={trigger}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onHide={vi.fn()}
      />
    );

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps keyboard focus inside the confirmation controls', async () => {
    const user = userEvent.setup();
    render(
      <TargetConfirmationDialog
        target={{ kind: 'manual' }}
        summary="Location will be entered in the form"
        messages={confirmationMessages}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onHide={vi.fn()}
      />
    );
    const confirm = screen.getByRole('button', { name: 'Potvrdiť miesto' });
    const cancel = screen.getByRole('button', { name: 'Zrušiť' });

    confirm.focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(confirm);
  });

  it('can hide a coordinate confirmation for map inspection without cancelling the target', async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    const onCancel = vi.fn();
    render(
      <TargetConfirmationDialog
        target={{ kind: 'custom', latitude: 48.7, longitude: 21.25 }}
        summary="Selected map point"
        messages={confirmationMessages}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onHide={onHide}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Skryť a prezrieť mapu' }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
