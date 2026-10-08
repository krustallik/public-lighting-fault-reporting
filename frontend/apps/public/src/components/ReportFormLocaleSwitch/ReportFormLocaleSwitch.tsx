import { useReportFormLocale } from '@/context/ReportFormLocaleContext';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';
import styles from './ReportFormLocaleSwitch.module.css';

const OPTIONS: ReportFormLocale[] = ['sk', 'en'];

interface ReportFormLocaleSwitchProps {
  /** Footer bar: SK/EN only, stays on one row with action buttons. */
  compact?: boolean;
  mapControl?: boolean;
}

export function ReportFormLocaleSwitch({ compact = false, mapControl = false }: ReportFormLocaleSwitchProps) {
  const { locale, setLocale, messages } = useReportFormLocale();

  return (
    <div
      className={`${compact ? styles.wrapperCompact : styles.wrapper} ${mapControl ? styles.mapControl : ''}`}
      role="group"
      aria-label={mapControl ? messages.map.languageControlLabel : messages.locale.label}
    >
      {!compact && <span className={styles.label}>{messages.locale.label}</span>}
      <div className={styles.buttons}>
        {OPTIONS.map((code) => (
          <button
            key={code}
            type="button"
            className={locale === code ? styles.buttonActive : styles.button}
            aria-pressed={locale === code}
            aria-label={code === 'sk' ? messages.map.slovakLanguageLabel : messages.map.englishLanguageLabel}
            onClick={() => setLocale(code)}
          >
            {mapControl ? <><span aria-hidden="true">{code === 'sk' ? '🇸🇰' : '🇬🇧'}</span><span>{code.toUpperCase()}</span></> : code === 'sk' ? messages.locale.sk : messages.locale.en}
          </button>
        ))}
      </div>
    </div>
  );
}
