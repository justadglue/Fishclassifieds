import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";

export default function AdminRoute(props: { children: React.ReactNode }) {
  const { children } = props;
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!user.isAdmin && !user.isSuperadmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

