import { NavLink, Outlet } from 'react-router-dom';
import { adminPath } from '@admin/config/adminRoutes';
import { useAdminAuth } from '@admin/context/AdminAuthContext';
import { useAdminTheme } from '@admin/hooks/useAdminTheme';
import styles from './AdminLayout.module.css';

const links = [
  { to: adminPath(), label: 'Prehľad', end: true },
  { to: adminPath('street-lights'), label: 'Svetelné body', end: true },
  { to: adminPath('reports'), label: 'Hlásenia porúch', end: true },
  { to: adminPath('import'), label: 'Import', end: true },
  { to: adminPath('settings'), label: 'Integrácia', end: true },
  { to: adminPath('logs'), label: 'Logy', end: true },
];

export function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const [theme, chooseTheme] = useAdminTheme();

  const handleLogout = async () => {
    await logout();
    window.location.assign(adminPath('login'));
  };

  return (
    <div className={styles.wrapper}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>Admin panel</h2>
          <button
            type="button"
            className={styles.themeToggle}
            aria-label={theme === 'dark' ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim'}
            title={theme === 'dark' ? 'Svetlý režim' : 'Tmavý režim'}
            onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
        {admin && (
          <p className={styles.user}>
            {admin.fullName || admin.username}
          </p>
        )}
        <nav className={styles.nav}>
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? styles.navLinkActive : styles.navLink
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className={styles.logout} onClick={handleLogout}>
          Odhlásiť sa
        </button>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
