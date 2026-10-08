import { LightPointsMap } from '@/components/LightPointsMap/LightPointsMap';
import styles from './MapPage.module.css';

export function MapPage() {
  return (
    <div className={styles.page}>
      <LightPointsMap />
    </div>
  );
}
