import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import EventsManagementPage from './pages/EventsManagementPage';
import TicketsManagementPage from './pages/TicketsManagementPage';
import BoothSalesPage from './pages/BoothSalesPage';
import GateScannerPage from './pages/GateScannerPage';
import ClusterDashboardPage from './pages/ClusterDashboardPage';
import MyTicketPage from './pages/MyTicketPage';
import { useAuthStore } from './store/authStore';

function RootRedirect() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'booth_staff') return <Navigate to="/booth" replace />;
  if (user?.role === 'gate_staff') return <Navigate to="/gate" replace />;
  return <Navigate to="/my-ticket" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Login Route */}
        <Route path="/login" element={<LoginPage />} />

        {/* Main Application Shell */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<RootRedirect />} />

          {/* Public Attendee Pass Lookup */}
          <Route path="/my-ticket" element={<MyTicketPage />} />

          {/* Admin Protected Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/events"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <EventsManagementPage />
              </ProtectedRoute>
            }
          />

          {/* Staff & Booth Routes */}
          <Route
            path="/admin/tickets"
            element={
              <ProtectedRoute allowedRoles={['admin', 'booth_staff']}>
                <TicketsManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/booth"
            element={
              <ProtectedRoute allowedRoles={['admin', 'booth_staff']}>
                <BoothSalesPage />
              </ProtectedRoute>
            }
          />

          {/* Gate Scanner Routes (Stage 6) */}
          <Route
            path="/gate"
            element={
              <ProtectedRoute allowedRoles={['admin', 'gate_staff']}>
                <GateScannerPage />
              </ProtectedRoute>
            }
          />

          {/* Cluster & Chaos Visualization (Stage 6) */}
          <Route path="/cluster" element={<ClusterDashboardPage />} />
        </Route>

        {/* 404 Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
