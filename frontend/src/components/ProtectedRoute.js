import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="muted" style={{ padding: 40 }}>Loading…</div>;
  if (!user)   return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
