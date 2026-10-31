import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { ShieldAlert } from 'lucide-react';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user?.role)) {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-center p-6">
        <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-lg shadow-rose-500/10">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">Access Restricted</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-sm">
          Your role (<span className="font-mono text-cyan-300 uppercase">{user?.role}</span>) does not have
          permission to access this route. Requires one of: [{allowedRoles.join(', ')}].
        </p>
      </div>
    );
  }

  return children;
}
