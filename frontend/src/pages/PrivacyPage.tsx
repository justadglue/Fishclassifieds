import Header from "../components/Header";

export default function PrivacyPage() {
  return (
    <div className="min-h-full bg-slate-950 text-white">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="text-xs font-bold uppercase tracking-wider text-white/60">Legal</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Privacy</h1>
        <p className="mt-3 text-sm font-semibold text-white/75">
          This is a placeholder privacy page. Add your official privacy policy here before going live.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm font-semibold text-white/75">
          We collect only the information needed to provide the service (e.g., account details and listing content).
          We don’t sell personal data. Add full details here.
        </div>
      </main>
    </div>
  );
}

