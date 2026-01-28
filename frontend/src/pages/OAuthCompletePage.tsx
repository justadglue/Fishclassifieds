import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { oauthCompletePending, oauthFetchPending } from "../api";

export default function OAuthCompletePage() {
    const nav = useNavigate();
    const loc = useLocation();
    const qs = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
    const state = qs.get("state") ?? "";

    // Read the origin URL stored before starting OAuth (set by OAuthButtons).
    // This survives the external Google redirect so we can return to /auth or /login correctly.
    const oauthOrigin = useMemo(() => {
        try {
            const raw = sessionStorage.getItem("oauth_origin_url");
            if (!raw) return null;
            const u = new URL(raw);
            return { pathname: u.pathname, search: u.search };
        } catch {
            return null;
        }
    }, []);

    // If user started OAuth from /auth, /signup, or /login, send them back there (preserving query params).
    const goBack = () => {
        // Clear the stored origin so it doesn't affect future flows.
        try { sessionStorage.removeItem("oauth_origin_url"); } catch { }

        const validOrigins = ["/auth", "/signup", "/login"];
        if (oauthOrigin?.pathname && validOrigins.includes(oauthOrigin.pathname)) {
            nav(`${oauthOrigin.pathname}${oauthOrigin.search ?? ""}`, { replace: true });
            return;
        }
        nav("/login", { replace: true });
    };

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setErr(null);
            setLoading(true);
            try {
                const res = await oauthFetchPending(state);
                if (cancelled) return;
                // Only prefill email. All other fields should be entered manually.
                setEmail(res.profile.email ?? "");
                setUsername("");
                setFirstName("");
                setLastName("");
            } catch (e: any) {
                if (cancelled) return;
                setErr(e?.message ?? "Unable to load signup details");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [state]);

    const canSubmit =
        !!state &&
        email.trim().length > 0 &&
        username.trim().length >= 3 &&
        firstName.trim().length > 0 &&
        lastName.trim().length > 0;

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit || submitting) return;
        setErr(null);
        setSubmitting(true);
        try {
            const res = await oauthCompletePending({
                state,
                email: email.trim(),
                username: username.trim(),
                firstName: firstName.trim(),
                lastName: lastName.trim(),
            });
            window.location.href = res.redirectTo;
        } catch (e: any) {
            setErr(e?.message ?? "Signup failed");
        } finally {
            setSubmitting(false);
        }
    }

    if (!state) {
        return (
            <div className="min-h-dvh bg-slate-50 flex items-center justify-center px-6">
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Complete signup</h1>
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Missing OAuth state.</div>
                    <div className="mt-6 text-center">
                        <button type="button" onClick={goBack} className="text-sm font-semibold text-slate-600 hover:text-slate-900 underline underline-offset-4">
                            Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-dvh bg-slate-50 flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Complete signup</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Finish creating your account.
                </p>

                {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

                {loading ? (
                    <div className="mt-4 text-sm text-slate-600">Loading…</div>
                ) : (
                    <form onSubmit={onSubmit} className="mt-6 grid gap-3">
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email address"
                            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                        />

                        <input
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Username"
                            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                        />

                        <div className="grid gap-3 sm:grid-cols-2">
                            <input
                                required
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="First name"
                                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                                maxLength={80}
                                autoComplete="given-name"
                            />
                            <input
                                required
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Last name"
                                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                                maxLength={80}
                                autoComplete="family-name"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!canSubmit || submitting}
                            className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                            {submitting ? "Creating..." : "Create account"}
                        </button>

                        <button
                            type="button"
                            onClick={goBack}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                    </form>
                )}

            </div>
        </div>
    );
}

