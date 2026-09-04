import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({
  children,
  adminOnly = false,
  requireRole,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  requireRole?: 'admin';
}) {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin' && user.role !== 'organizer' && user.role !== 'superuser')
    return <Navigate to="/" replace />;
  if (requireRole && user.role !== requireRole) return <Navigate to="/" replace />;
  return <>{children}</>;
}
