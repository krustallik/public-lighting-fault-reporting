import { NavLink, Outlet } from 'react-router-dom';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Poruchy verejného osvetlenia</h1>
        <nav className={styles.nav}>
          <NavLink to="/map" className={styles.navLink}>
            Mapa
          </NavLink>
          <NavLink to="/report" className={styles.navLink}>
            Nahlásiť poruchu
          </NavLink>
          <NavLink to="/admin/login" className={styles.navLink}>
            Admin
          </NavLink>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
