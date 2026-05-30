import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';

export function AdminProtectedRoute() {
  const { admin, loading } = useAdminAuth();
  const location = useLocation();

  if (loading) {
    return <p>Overujem prihlásenie…</p>;
  }

  if (!admin) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
