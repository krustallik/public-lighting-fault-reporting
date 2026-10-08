import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout/Layout';
import { MapPage } from '@/pages/MapPage/MapPage';
import { ReportFormPage } from '@/pages/ReportFormPage/ReportFormPage';
import { ResultPage } from '@/pages/ResultPage/ResultPage';
import { ReportFormLocaleProvider } from '@/context/ReportFormLocaleContext';

export default function App() {
  return (
    <ReportFormLocaleProvider>
      <Routes>
      <Route index element={<Navigate to="/map" replace />} />
      <Route path="map" element={<MapPage />} />
      <Route element={<Layout />}>
        <Route path="report" element={<ReportFormPage />} />
        <Route path="result" element={<ResultPage />} />
      </Route>
      </Routes>
    </ReportFormLocaleProvider>
  );
}
