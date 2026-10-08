import styles from './SortableColumnHeader.module.css';

export type SortOrder = 'asc' | 'desc';

interface SortableColumnHeaderProps {
  label: string;
  column: string;
  sortBy: string;
  sortOrder: SortOrder;
  onSort: (column: string, order: SortOrder) => void;
}

export function SortableColumnHeader({
  label,
  column,
  sortBy,
  sortOrder,
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
      <button type="button" className={styles.label} onClick={handleLabelClick}>
        {label}
      </button>
      <div className={styles.arrows}>
        <button
          type="button"
          className={isActive && sortOrder === 'asc' ? styles.arrowActive : styles.arrow}
          onClick={() => onSort(column, 'asc')}
          aria-label={`${label} vzostupne`}
          title="Vzostupne"
        >
          ↑
        </button>
        <button
          type="button"
          className={isActive && sortOrder === 'desc' ? styles.arrowActive : styles.arrow}
          onClick={() => onSort(column, 'desc')}
          aria-label={`${label} zostupne`}
          title="Zostupne"
        >
          ↓
        </button>
      </div>
    </div>
  );
}
