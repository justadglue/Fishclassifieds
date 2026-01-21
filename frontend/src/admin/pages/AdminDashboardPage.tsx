import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { adminFetchStats, type AdminStats } from "../../api";

function StatCard(props: { to: string; title: string; subtitle: string; value?: string }) {
  const { to, title, subtitle, value } = props;
  return (
    <Link to={to} className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900">{title}</div>
          <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
        </div>
        {value ? <div className="shrink-0 rounded-xl bg-slate-900 px-3 py-1 text-sm font-extrabold text-white">{value}</div> : null}
      </div>
    </Link>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const s = await adminFetchStats({ days: 7 });
        if (!cancelled) setStats(s);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load admin stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => {
    const s = stats;
    return [
      {
        to: "/admin/listings",
        title: "Listings",
        subtitle: s ? `Total ${s.listings.total.toLocaleString()} • Active ${s.listings.activeTotal.toLocaleString()}` : "Browse and manage all listings site-wide.",
        value: s ? String(s.listings.total) : undefined,
      },
      {
        to: "/admin/approvals",
        title: "Approvals",
        subtitle: "Review pending listings and wanted posts.",
        value: s ? String(s.approvals.pendingTotal) : undefined,
      },
      {
        to: "/admin/reports",
        title: "Reports",
        subtitle: "Triage user-submitted reports.",
        value: s ? String(s.reports.open) : undefined,
      },
      {
        to: "/admin/users",
        title: "Users",
        subtitle: s ? `Total ${s.users.total.toLocaleString()} • New (last ${s.windowDays}d) ${s.users.newLastWindow.toLocaleString()}` : "Superadmin: manage user privileges.",
        value: s ? String(s.users.total) : undefined,
      },
    ] as const;
  }, [stats]);

  return (
    <div>
      {err ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}
      <div className="mb-4 text-xs font-semibold text-slate-500">{loading ? "Loading…" : stats ? `Updated ${new Date(stats.server.nowIso).toLocaleString()}` : ""}</div>

      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.to} to={c.to} title={c.title} subtitle={c.subtitle} value={c.value} />
        ))}
      </div>

      {stats ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Listings</div>
              <div className="mt-1 font-semibold">
                Active {stats.listings.activeTotal.toLocaleString()} (sale {stats.listings.activeSale.toLocaleString()} • wanted{" "}
                {stats.listings.activeWanted.toLocaleString()})
              </div>
              <div className="text-slate-600">Total (non-deleted): {stats.listings.total.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Views</div>
              <div className="mt-1 font-semibold">{stats.views.total.toLocaleString()} total detail views</div>
              <div className="text-slate-600">Server uptime: {Math.max(0, stats.server.uptimeSec).toLocaleString()}s</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Database</div>
              <div className="mt-1 font-semibold">{stats.db.sizeBytes == null ? "Size unavailable" : `${(stats.db.sizeBytes / (1024 * 1024)).toFixed(2)} MB`}</div>
              <div className="truncate text-slate-600" title={stats.db.path}>
                {stats.db.path}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

