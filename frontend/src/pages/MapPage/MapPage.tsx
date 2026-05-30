import { Link } from 'react-router-dom';
import { MapPlaceholder } from '@/components/MapPlaceholder/MapPlaceholder';
import styles from './MapPage.module.css';

export function MapPage() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Mapa svetelných bodov</h2>
      <p className={styles.description}>
        Verejná mapa pre výber svetelného bodu a nahlásenie poruchy.
      </p>
      <MapPlaceholder />
      <Link to="/report" className={styles.link}>
        Nahlásiť poruchu
      </Link>
    </section>
  );
}
