import { useMemo, useState } from 'react';
import type { LightPoint } from '@/types/lightPoint';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';
import type { ReportFormMessages } from '@/i18n/reportFormMessages';
import styles from './LightPointsMap.module.css';

interface Props {
  points: LightPoint[];
  locale: ReportFormLocale;
  messages: ReportFormMessages['map'];
  onSelect: (point: LightPoint, trigger: HTMLElement) => void;
}

export function FallbackKnownPointChooser({ points, locale, messages, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    const matches = points.filter((point) => !normalized || [
      point.inventory_number, point.address, String(point.id),
    ].some((value) => value?.toLocaleLowerCase(locale).includes(normalized)));
    return { matches: matches.slice(0, 20), total: matches.length };
  }, [locale, points, query]);

  return (
    <section className={styles.fallbackPoints} aria-labelledby="fallback-points-title" data-testid="fallback-known-points">
      <h2 id="fallback-points-title">{messages.fallbackPointsTitle}</h2>
      <p>{messages.fallbackPointsHint}</p>
      <label htmlFor="fallback-point-search">{messages.fallbackPointsSearch}</label>
      <input
        id="fallback-point-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      <p role="status" aria-live="polite">{messages.fallbackPointsCount(visible.total)}</p>
      <div className={styles.fallbackPointList}>
        {visible.matches.map((point) => (
          <button
            key={point.id}
            type="button"
            className={styles.fallbackPointButton}
            onClick={(event) => onSelect(point, event.currentTarget)}
          >
            {[point.inventory_number?.trim(), point.address?.trim(), `#${point.id}`].filter(Boolean).join(' · ')}
          </button>
        ))}
      </div>
    </section>
  );
}
