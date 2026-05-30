import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout/Layout';
import { AdminLayout } from '@/components/AdminLayout/AdminLayout';
import { AdminProtectedRoute } from '@/components/AdminProtectedRoute/AdminProtectedRoute';
import { ADMIN_ROUTE_SEGMENT } from '@/config/adminRoutes';
import { MapPage } from '@/pages/MapPage/MapPage';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { AdminLoginPage } from '@/pages/AdminLoginPage/AdminLoginPage';
import { AdminDashboardPage } from '@/pages/AdminDashboardPage/AdminDashboardPage';
import { AdminStreetLightsPage } from '@/pages/AdminStreetLightsPage/AdminStreetLightsPage';
import { AdminStreetLightFormPage } from '@/pages/AdminStreetLightFormPage/AdminStreetLightFormPage';
import { AdminStreetLightDetailPage } from '@/pages/AdminStreetLightDetailPage/AdminStreetLightDetailPage';
import { AdminImportPage } from '@/pages/AdminImportPage/AdminImportPage';
import { AdminSettingsPage } from '@/pages/AdminSettingsPage/AdminSettingsPage';
import { AdminLogsPage } from '@/pages/AdminLogsPage/AdminLogsPage';

export default function App() {
  return (
    <Routes>
      <Route index element={<Navigate to="/map" replace />} />
      <Route path="map" element={<MapPage />} />
      <Route element={<Layout />}>
        <Route path="report" element={<ReportFormPage />} />
        <Route path="result" element={<ResultPage />} />
        <Route path={`${ADMIN_ROUTE_SEGMENT}/login`} element={<AdminLoginPage />} />
        <Route element={<AdminProtectedRoute />}>
          <Route path={ADMIN_ROUTE_SEGMENT} element={<AdminLayout />}>
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
        <Route path="admin/*" element={<Navigate to="/map" replace />} />
      </Route>
    </Routes>
  );
}
