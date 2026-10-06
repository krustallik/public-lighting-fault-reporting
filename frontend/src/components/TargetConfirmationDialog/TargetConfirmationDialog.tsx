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
}

export function TargetConfirmationDialog({
  target,
  summary,
  returnFocusTo,
  messages,
  onConfirm,
  onCancel,
}: TargetConfirmationDialogProps) {
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === cancelRef.current) {
      event.preventDefault();
      confirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  };

  const coordinateTarget = target.kind === 'custom' || target.kind === 'device';

  return (
    <div className={styles.backdrop}>
      <section
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
          <button ref={cancelRef} type="button" className={styles.secondary} onClick={onCancel}>
            {messages.cancel}
          </button>
          <button ref={confirmRef} type="button" className={styles.primary} onClick={onConfirm}>
            {messages.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
