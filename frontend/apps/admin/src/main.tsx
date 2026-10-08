import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AdminAuthProvider } from '@admin/context/AdminAuthContext';
import AdminApp from './App';
import '@shared/styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AdminAuthProvider>
        <AdminApp />
      </AdminAuthProvider>
    </BrowserRouter>
  </StrictMode>
);
