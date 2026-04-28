/**
 * Top-level app: auth provider + router.
 *
 * Public routes:
 *   /login
 *
 * Protected (wrapped in <Layout />):
 *   /                     Dashboard
 *   /equipment            Equipment list
 *   /equipment/:id        Equipment detail (live)
 *   /alarms               Alarms list
 *   /predictions          AI predictions
 *   /maintenance          Maintenance orders
 *   /reports              Excel/PDF exports
 *   /boiler               Boiler tracking
 *   /users                (admin only) User management
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login           from './pages/Login';
import Dashboard       from './pages/Dashboard';
import Equipment       from './pages/Equipment';
import EquipmentDetail from './pages/EquipmentDetail';
import Alarms          from './pages/Alarms';
import Predictions     from './pages/Predictions';
import Maintenance     from './pages/Maintenance';
import Reports         from './pages/Reports';
import Users           from './pages/Users';
import BoilerTracking  from './pages/BoilerTracking';
import Notes           from './pages/Notes';

import './styles/App.css';

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index                 element={<Dashboard />} />
          <Route path="equipment"      element={<Equipment />} />
          <Route path="equipment/:id"  element={<EquipmentDetail />} />
          <Route path="alarms"         element={<Alarms />} />
          <Route path="predictions"    element={<Predictions />} />
          <Route path="maintenance"    element={<Maintenance />} />
          <Route path="reports"        element={<Reports />} />
          <Route path="boiler"         element={<BoilerTracking />} />
          <Route path="notes"          element={<Notes />} />
          <Route path="users"          element={<AdminOnly><Users /></AdminOnly>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
