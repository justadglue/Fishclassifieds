import { Link, Outlet, useLocation } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import BackToButton from "../components/nav/BackToButton";

function TabLink(props: { to: string; label: string }) {
  const { to, label } = props;
  const loc = useLocation();
  const active = loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={[
        "rounded-xl border px-3 py-2 text-sm font-bold",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function AdminLayout() {
  const { user } = useAuth();
  const loc = useLocation();
  const isUserDetail = /^\/admin\/users\/\d+/.test(loc.pathname);
  return (
    <div className="min-h-full">
      <Header maxWidth="7xl" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {isUserDetail ? (
              <div className="mb-2">
                <BackToButton fallbackTo="/admin/users" fallbackLabel="users" />
              </div>
            ) : null}
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Admin</div>
            <h1 className="mt-1 text-2xl font-extrabold text-slate-900">
              <Link to="/admin" className="hover:underline hover:underline-offset-4" aria-label="Back to admin dashboard">
                Dashboard
              </Link>
            </h1>
            <div className="mt-1 text-sm text-slate-600">
              Signed in as <span className="font-semibold">{user?.username}</span>
              {user?.isSuperadmin ? " (superadmin)" : user?.isAdmin ? " (admin)" : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <TabLink to="/admin/listings" label="Listings" />
            <TabLink to="/admin/approvals" label="Approvals" />
            <TabLink to="/admin/reports" label="Reports" />
            <TabLink to="/admin/audit" label="Audit" />
            {user?.isSuperadmin ? <TabLink to="/admin/settings" label="Settings" /> : null}
            <TabLink to="/admin/users" label="Users" />
            {user?.isSuperadmin ? <TabLink to="/admin/users/privileges" label="Privileges" /> : null}
          </div>
        </div>

        <div className="mt-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

