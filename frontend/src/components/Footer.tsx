import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Explore</div>
            <div className="mt-3 flex flex-col items-center gap-2">
              <Link to="/browse?type=sale" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Browse listings
              </Link>
              <Link to="/post" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Post a listing
              </Link>
              <Link to="/me" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                My listings
              </Link>
            </div>
          </div>

          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Account</div>
            <div className="mt-3 flex flex-col items-center gap-2">
              <Link to="/profile" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                My profile
              </Link>
              <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Login
              </Link>
              <Link to="/signup" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Sign up
              </Link>
            </div>
          </div>

          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Support</div>
            <div className="mt-3 flex flex-col items-center gap-2">
              <Link to="/faq" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                FAQ
              </Link>
              <Link to="/contact" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Contact
              </Link>
              <Link to="/terms" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Terms
              </Link>
              <Link to="/privacy" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                Privacy
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-6 text-center text-sm font-semibold text-slate-500">
          © {new Date().getFullYear()} Fishclassifieds. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

