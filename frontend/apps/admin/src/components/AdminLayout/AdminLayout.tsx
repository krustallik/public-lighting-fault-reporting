import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { adminPath } from '@admin/config/adminRoutes';
import { useAdminAuth } from '@admin/context/AdminAuthContext';
import { useAdminTheme } from '@admin/hooks/useAdminTheme';
import styles from './AdminLayout.module.css';

const links = [
  { to: adminPath(), label: 'Prehľad', end: true },
  { to: adminPath('street-lights'), label: 'Svetelné body' },
  { to: adminPath('reports'), label: 'Hlásenia porúch', end: true },
  { to: adminPath('import'), label: 'Import', end: true },
  { to: adminPath('statistics'), label: 'Štatistiky hlásení', end: true },
  { to: adminPath('logs'), label: 'Logy', end: true },
];

export function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const [theme, chooseTheme] = useAdminTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    window.location.assign(adminPath('login'));
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.topbar}>
          <h2 className={styles.brand}>Admin panel</h2>
          <button
            type="button"
            className={styles.menuToggle}
            aria-controls="admin-primary-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Zavrieť menu' : 'Menu'}
          </button>
          <nav id="admin-primary-navigation" className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`} aria-label="Hlavná navigácia">
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.tools}>
          {admin && <span className={styles.identity} title={admin.fullName || admin.username}>{admin.fullName || admin.username}</span>}
          <button
            type="button"
            className={styles.themeToggle}
            aria-label={theme === 'dark' ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim'}
            title={theme === 'dark' ? 'Svetlý režim' : 'Tmavý režim'}
            onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button type="button" className={styles.logout} onClick={handleLogout}>Odhlásiť sa</button>
        </div>
      </header>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
