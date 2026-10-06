import { useEffect, useRef } from 'react';
import type { ReportTarget } from '@/utils/reportNavigationTarget';
import { formatCoordinates } from '@/utils/reportLocationParams';
import type { ReportFormMessages } from '@/i18n/reportFormMessages';
import styles from './TargetConfirmationDialog.module.css';

interface TargetConfirmationDialogProps {
  target: ReportTarget;
  summary: string;
  returnFocusTo?: HTMLElement | null;
  messages: ReportFormMessages['confirmation'];
  onConfirm: () => void;
  onCancel: () => void;
  onHide: () => void;
}

export function TargetConfirmationDialog({
  target,
  summary,
  returnFocusTo,
  messages,
  onConfirm,
  onCancel,
  onHide,
}: TargetConfirmationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = returnFocusTo ?? document.activeElement;
    confirmRef.current?.focus();

    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [returnFocusTo]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
      'button:not([disabled])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const coordinateTarget = target.kind === 'custom' || target.kind === 'device';

  return (
    <div className={styles.backdrop}>
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-confirmation-title"
        aria-describedby="target-confirmation-description"
        onKeyDown={handleKeyDown}
      >
        <h2 id="target-confirmation-title" className={styles.title}>
          {messages.title}
        </h2>
        <p id="target-confirmation-description" className={styles.summary}>
          {summary}
        </p>
        {coordinateTarget && (
          <p className={styles.coordinates}>
            <span>{messages.coordinates}:</span> {formatCoordinates(target.latitude, target.longitude)}
          </p>
        )}
        {target.kind === 'device' && (
          <p className={styles.note}>
            {messages.deviceNote}
          </p>
        )}
        {target.kind === 'manual' && (
          <p className={styles.note}>
            {messages.manualNote}
          </p>
        )}
        <div className={styles.actions}>
          <div className={styles.secondaryActions}>
            <button ref={cancelRef} type="button" className={styles.secondary} onClick={onCancel}>
              {messages.cancel}
            </button>
            {coordinateTarget && (
              <button type="button" className={styles.secondary} onClick={onHide}>
                {messages.hideAndInspectMap}
              </button>
            )}
          </div>
          <button ref={confirmRef} type="button" className={styles.primary} onClick={onConfirm}>
            {messages.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
