import { Outlet } from 'react-router-dom';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.wrapper}>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
