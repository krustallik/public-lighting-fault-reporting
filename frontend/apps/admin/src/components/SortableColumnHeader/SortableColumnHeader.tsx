import styles from './SortableColumnHeader.module.css';

export type SortOrder = 'asc' | 'desc';

interface SortableColumnHeaderProps {
  label: string;
  column: string;
  sortBy: string;
  sortOrder: SortOrder;
  disabled?: boolean;
  onSort: (column: string, order: SortOrder) => void;
}

export function SortableColumnHeader({
  label,
  column,
  sortBy,
  sortOrder,
  disabled = false,
  onSort,
}: SortableColumnHeaderProps) {
  const isActive = sortBy === column;

  const handleLabelClick = () => {
    if (isActive) {
      onSort(column, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSort(column, 'asc');
    }
  };

  return (
    <div className={styles.header}>
      <button type="button" className={styles.label} onClick={handleLabelClick} disabled={disabled} aria-pressed={isActive} aria-label={`Zoradiť podľa ${label}${isActive ? sortOrder === 'asc' ? ', aktuálne vzostupne' : ', aktuálne zostupne' : ''}`}>
        {label}
      </button>
      <button type="button" className={isActive ? styles.sortButtonActive : styles.sortButton}
        onClick={handleLabelClick} disabled={disabled} aria-pressed={isActive}
        aria-label={isActive ? `Zmeniť zoradenie ${label} na ${sortOrder === 'asc' ? 'zostupné' : 'vzostupné'}` : `Zoradiť podľa ${label}, vzostupne`}
        title={isActive ? (sortOrder === 'asc' ? 'Vzostupne' : 'Zostupne') : 'Bez zoradenia'}>
        {isActive ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
      </button>
    </div>
  );
}
