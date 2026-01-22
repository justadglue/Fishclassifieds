import Header from "../components/Header";

export default function TermsPage() {
  return (
    <div className="min-h-full bg-slate-950 text-white">
      <Header maxWidth="7xl" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="text-xs font-bold uppercase tracking-wider text-white/60">Legal</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Terms</h1>
        <p className="mt-3 text-sm font-semibold text-white/75">
          This is a placeholder terms page. Add your official terms here before going live.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm font-semibold text-white/75">
          By using Fishclassifieds, you agree to follow all applicable laws and not post prohibited items or content.
          Sellers are responsible for their listings and transactions.
        </div>
      </main>
    </div>
  );
}

