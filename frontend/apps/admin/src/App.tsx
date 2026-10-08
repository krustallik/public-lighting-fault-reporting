import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@admin/components/AdminLayout/AdminLayout';
import { AdminProtectedRoute } from '@admin/components/AdminProtectedRoute/AdminProtectedRoute';
import { ADMIN_ROUTE_SEGMENT, adminPath } from '@admin/config/adminRoutes';
import { AdminDashboardPage } from '@admin/pages/AdminDashboardPage/AdminDashboardPage';
import { AdminImportPage } from '@admin/pages/AdminImportPage/AdminImportPage';
import { AdminLoginPage } from '@admin/pages/AdminLoginPage/AdminLoginPage';
import { AdminLogsPage } from '@admin/pages/AdminLogsPage/AdminLogsPage';
import { AdminSettingsPage } from '@admin/pages/AdminSettingsPage/AdminSettingsPage';
import { AdminStreetLightDetailPage } from '@admin/pages/AdminStreetLightDetailPage/AdminStreetLightDetailPage';
import { AdminStreetLightFormPage } from '@admin/pages/AdminStreetLightFormPage/AdminStreetLightFormPage';
import { AdminStreetLightsPage } from '@admin/pages/AdminStreetLightsPage/AdminStreetLightsPage';
import styles from './App.module.css';

const adminRootPath = ADMIN_ROUTE_SEGMENT || '/';

export default function AdminApp() {
  return (
    <Routes>
      <Route index element={<Navigate to={adminPath('login')} replace />} />
      <Route
        path={adminPath('login').replace(/^\//, '')}
        element={<div className={styles.loginFrame}><AdminLoginPage /></div>}
      />
      <Route path={adminRootPath} element={<AdminProtectedRoute />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="street-lights" element={<AdminStreetLightsPage />} />
          <Route path="street-lights/new" element={<AdminStreetLightFormPage />} />
          <Route path="street-lights/:id" element={<AdminStreetLightDetailPage />} />
          <Route path="street-lights/:id/edit" element={<AdminStreetLightFormPage />} />
          <Route path="import" element={<AdminImportPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
