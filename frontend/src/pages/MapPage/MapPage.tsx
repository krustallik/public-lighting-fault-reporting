import { LightPointsMap } from '@/components/LightPointsMap/LightPointsMap';
import styles from './MapPage.module.css';

export function MapPage() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Mapa svetelných bodov</h2>
      <p className={styles.description}>
        Vyberte svetelný bod na mape a nahláste poruchu verejného osvetlenia.
      </p>
      <LightPointsMap />
    </section>
  );
}
