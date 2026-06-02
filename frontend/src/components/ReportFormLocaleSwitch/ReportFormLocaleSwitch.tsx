import { useReportFormLocale } from '@/context/ReportFormLocaleContext';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';
import styles from './ReportFormLocaleSwitch.module.css';

const OPTIONS: ReportFormLocale[] = ['sk', 'en'];

interface ReportFormLocaleSwitchProps {
  /** Footer bar: SK/EN only, stays on one row with action buttons. */
  compact?: boolean;
}

export function ReportFormLocaleSwitch({ compact = false }: ReportFormLocaleSwitchProps) {
  const { locale, setLocale, messages } = useReportFormLocale();

  return (
    <div
      className={compact ? styles.wrapperCompact : styles.wrapper}
      role="group"
      aria-label={messages.locale.label}
    >
      {!compact && <span className={styles.label}>{messages.locale.label}</span>}
      <div className={styles.buttons}>
        {OPTIONS.map((code) => (
          <button
            key={code}
            type="button"
            className={locale === code ? styles.buttonActive : styles.button}
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
          >
            {code === 'sk' ? messages.locale.sk : messages.locale.en}
          </button>
        ))}
      </div>
    </div>
  );
}
