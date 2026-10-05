import { useEffect, useRef } from 'react';
import type { ReportTarget } from '@/utils/reportNavigationTarget';
import { formatCoordinates } from '@/utils/reportLocationParams';
import styles from './TargetConfirmationDialog.module.css';

interface TargetConfirmationDialogProps {
  target: ReportTarget;
  summary: string;
  returnFocusTo?: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TargetConfirmationDialog({
  target,
  summary,
  returnFocusTo,
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
          Potvrďte miesto hlásenia
        </h2>
        <p id="target-confirmation-description" className={styles.summary}>
          {summary}
        </p>
        {coordinateTarget && (
          <p className={styles.coordinates}>
            <span>Súradnice:</span> {formatCoordinates(target.latitude, target.longitude)}
          </p>
        )}
        {target.kind === 'device' && (
          <p className={styles.note}>
            Poloha zariadenia sa použije ako cieľ hlásenia až po tomto potvrdení.
          </p>
        )}
        {target.kind === 'manual' && (
          <p className={styles.note}>
            Lokalitu a bližší popis zadáte vo formulári.
          </p>
        )}
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" className={styles.secondary} onClick={onCancel}>
            Zrušiť
          </button>
          <button ref={confirmRef} type="button" className={styles.primary} onClick={onConfirm}>
            Potvrdiť miesto
          </button>
        </div>
      </section>
    </div>
  );
}
