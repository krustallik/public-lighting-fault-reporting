import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout/Layout';
import { MapPage } from '@/pages/MapPage/MapPage';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { AdminLoginPage } from '@/pages/AdminLoginPage/AdminLoginPage';
import { AdminLightPointsPage } from '@/pages/AdminLightPointsPage/AdminLightPointsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/map" replace />} />
        <Route path="map" element={<MapPage />} />
        <Route path="report" element={<ReportFormPage />} />
        <Route path="result" element={<ResultPage />} />
        <Route path="admin/login" element={<AdminLoginPage />} />
        <Route path="admin/light-points" element={<AdminLightPointsPage />} />
      </Route>
    </Routes>
  );
}
