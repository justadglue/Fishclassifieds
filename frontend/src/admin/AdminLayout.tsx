import { Link, Outlet, useLocation } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import BackToButton from "../components/nav/BackToButton";

function TabLink(props: { to: string; label: string; badge?: string; disabled?: boolean }) {
  const { to, label, badge, disabled } = props;
  const loc = useLocation();
  const active = loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  const cls = [
    "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold",
    disabled
      ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
      : active
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  ].join(" ");
  const badgeEl = badge ? (
    <span className={["rounded-full border px-2 py-0.5 text-[11px] font-extrabold", disabled ? "border-slate-200 text-slate-400" : "border-slate-200 text-slate-600"].join(" ")}>
      {badge}
    </span>
  ) : null;

  if (disabled) {
    return (
      <span className={cls} aria-disabled="true" title={`${label} (superadmin only)`}>
        <span>{label}</span>
        {badgeEl}
      </span>
    );
  }

  return (
    <Link to={to} className={cls}>
      <span>{label}</span>
      {badgeEl}
    </Link>
  );
}

export default function AdminLayout() {
  const { user } = useAuth();
  const loc = useLocation();
  const isUserDetail = /^\/admin\/users\/\d+/.test(loc.pathname);
  const isSuper = Boolean(user?.isSuperadmin);
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
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <TabLink to="/admin/listings" label="Listings" />
              <TabLink to="/admin/approvals" label="Approvals" />
              <TabLink to="/admin/reports" label="Reports" />
              <TabLink to="/admin/audit" label="Audit" />
              <TabLink to="/admin/users" label="Users" />
            </div>

            {isSuper ? (
              <div className="flex flex-col items-end">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Superadmin</div>
                <div className="mt-1 flex flex-wrap justify-end gap-2">
                  <TabLink to="/admin/ai" label="AI Functions" />
                  <TabLink to="/admin/settings" label="Settings" />
                  <TabLink to="/admin/users/privileges" label="Privileges" />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

