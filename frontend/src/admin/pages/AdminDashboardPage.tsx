import { Link } from "react-router-dom";

export default function AdminDashboardPage() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Link to="/admin/approvals" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300">
        <div className="text-sm font-extrabold text-slate-900">Approvals</div>
        <div className="mt-1 text-sm text-slate-600">Review pending listings and wanted posts.</div>
      </Link>
      <Link to="/admin/reports" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300">
        <div className="text-sm font-extrabold text-slate-900">Reports</div>
        <div className="mt-1 text-sm text-slate-600">Triage user-submitted reports.</div>
      </Link>
      <Link to="/admin/users" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300">
        <div className="text-sm font-extrabold text-slate-900">Users</div>
        <div className="mt-1 text-sm text-slate-600">Superadmin: manage admin privileges.</div>
      </Link>
    </div>
  );
}

