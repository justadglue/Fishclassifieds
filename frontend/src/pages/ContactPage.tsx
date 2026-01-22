import Header from "../components/Header";

export default function ContactPage() {
  return (
    <div className="min-h-full bg-slate-950 text-white">
      <Header maxWidth="7xl" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="text-xs font-bold uppercase tracking-wider text-white/60">Support</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Contact</h1>
        <p className="mt-3 text-sm font-semibold text-white/75">
          Need help or want to report an issue? Email us and we’ll get back to you.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-extrabold">Email</div>
          <a
            className="mt-2 inline-block text-sm font-semibold text-white underline hover:text-white/90"
            href="mailto:support@fishclassifieds.com"
          >
            support@fishclassifieds.com
          </a>
          <div className="mt-4 text-xs font-semibold text-white/60">
            Please include a link to the listing and a short description of the issue.
          </div>
        </div>
      </main>
    </div>
  );
}

