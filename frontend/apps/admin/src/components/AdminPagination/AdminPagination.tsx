import styles from '@admin/styles/adminShared.module.css';

interface AdminPaginationProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}

export function AdminPagination({ page, totalPages, totalRecords, disabled = false, onPageChange }: AdminPaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const numberedPages = [...new Set([safePage - 1, safePage, safePage + 1])]
    .filter((value) => value >= 1 && value <= safeTotalPages);

  return (
    <nav className={styles.pagination} aria-label="Stránkovanie">
      <button type="button" className={styles.buttonSecondary} aria-label="Prvá strana" disabled={disabled || safePage <= 1} onClick={() => onPageChange(1)}>«</button>
      <button type="button" className={styles.buttonSecondary} aria-label="Predchádzajúca strana" disabled={disabled || safePage <= 1} onClick={() => onPageChange(safePage - 1)}>‹</button>
      {numberedPages.map((number) => (
        <button key={number} type="button" className={styles.pageNumber} aria-current={number === safePage ? 'page' : undefined} disabled={disabled || number === safePage} onClick={() => onPageChange(number)}>
          {number}
        </button>
      ))}
      <button type="button" className={styles.buttonSecondary} aria-label="Ďalšia strana" disabled={disabled || safePage >= safeTotalPages} onClick={() => onPageChange(safePage + 1)}>›</button>
      <button type="button" className={styles.buttonSecondary} aria-label="Posledná strana" disabled={disabled || safePage >= safeTotalPages} onClick={() => onPageChange(safeTotalPages)}>»</button>
      <span aria-live="polite">Strana {safePage} z {safeTotalPages} · {totalRecords} záznamov</span>
    </nav>
  );
}
