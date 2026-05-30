import { NavLink, Outlet } from 'react-router-dom';
import { adminPath } from '@/config/adminRoutes';
import { useAdminAuth } from '@/context/AdminAuthContext';
import styles from './AdminLayout.module.css';

const links = [
  { to: adminPath(), label: 'Prehľad', end: true },
  { to: adminPath('street-lights'), label: 'Svetelné body' },
  { to: adminPath('import'), label: 'Import' },
  { to: adminPath('settings'), label: 'Integrácia' },
  { to: adminPath('logs'), label: 'Logy' },
];

export function AdminLayout() {
  const { admin, logout } = useAdminAuth();

  const handleLogout = async () => {
    await logout();
    window.location.assign(adminPath('login'));
  };

  return (
    <div className={styles.wrapper}>
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Admin panel</h2>
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
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
