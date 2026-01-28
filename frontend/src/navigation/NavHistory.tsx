import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

type NavEntry = {
  key: string;
  pathname: string;
  search: string;
  label: string;
};

function isTemporaryPath(pathname: string) {
  const p = String(pathname || "/");
  return p.startsWith("/edit/") || p.startsWith("/auth") || p === "/login" || p === "/signup" || p === "/oauth/complete";
}

function labelForLocation(pathname: string, search: string) {
  const p = String(pathname || "/");
  const sp = new URLSearchParams(search || "");

  if (p === "/") return "home";
  if (p === "/browse") {
    const t = (sp.get("type") ?? "sale").toLowerCase();
    return t === "wanted" ? "wanted" : "listings";
  }
  if (p === "/me") return "My listings";
  if (p === "/post") return "post";
  if (p.startsWith("/post/")) return "post";
  if (p.startsWith("/listing/")) return "listing";
  if (p.startsWith("/edit/")) return "edit";
  if (p.startsWith("/feature/")) return "My listings";
  if (p === "/profile") return "profile";
  if (p === "/faq") return "FAQ";
  if (p === "/contact") return "contact";
  if (p === "/terms") return "terms";
  if (p === "/privacy") return "privacy";
  if (p === "/oauth/complete") return "home";
  if (p === "/login" || p === "/signup" || p === "/auth") return "home";

  if (p === "/admin") return "admin dashboard";
  if (p === "/admin/listings") return "admin listings";
  if (p === "/admin/users") return "users";
  if (p.startsWith("/admin/users/")) return "users";
  if (p === "/admin/approvals") return "approvals";
  if (p === "/admin/reports") return "reports";
  if (p === "/admin/audit") return "audit";
  if (p === "/admin/settings") return "settings";

  // Fallback: last segment or root.
  const seg = p.split("/").filter(Boolean).slice(-1)[0] ?? "";
  return seg || "home";
}

const NavHistoryContext = createContext<{
  prev: NavEntry | null;
  prevNonTemp: NavEntry | null;
  goBack: (fallbackTo: string) => void;
  goBackNonTemp: (fallbackTo: string) => void;
} | null>(null);

export function NavHistoryProvider(props: { children: React.ReactNode }) {
  const { children } = props;
  const loc = useLocation();
  const navType = useNavigationType(); // POP | PUSH | REPLACE
  const nav = useNavigate();

  const stackRef = useRef<NavEntry[]>([]);
  const [prev, setPrev] = useState<NavEntry | null>(null);
  const [prevNonTemp, setPrevNonTemp] = useState<NavEntry | null>(null);

  useEffect(() => {
    const entry: NavEntry = {
      key: loc.key,
      pathname: loc.pathname,
      search: loc.search,
      label: labelForLocation(loc.pathname, loc.search),
    };

    const stack = stackRef.current;
    const idx = stack.findIndex((e) => e.key === loc.key);

    if (navType === "POP") {
      if (idx >= 0) stackRef.current = stack.slice(0, idx + 1);
      else stackRef.current = [...stack, entry];
    } else if (navType === "REPLACE") {
      if (stack.length === 0) stackRef.current = [entry];
      else stackRef.current = [...stack.slice(0, stack.length - 1), entry];
    } else {
      // PUSH
      if (idx >= 0) stackRef.current = [...stack.slice(0, idx + 1)];
      else stackRef.current = [...stack, entry];
    }

    const nextStack = stackRef.current;
    setPrev(nextStack.length >= 2 ? nextStack[nextStack.length - 2] : null);
    // Find the most recent non-temporary page before the current route.
    const curIdx = nextStack.length - 1;
    let found: NavEntry | null = null;
    for (let i = curIdx - 1; i >= 0; i--) {
      const e = nextStack[i];
      if (!isTemporaryPath(e.pathname)) {
        found = e;
        break;
      }
    }
    setPrevNonTemp(found);
  }, [loc.key, loc.pathname, loc.search, navType]);

  const value = useMemo(() => {
    return {
      prev,
      prevNonTemp,
      goBack: (fallbackTo: string) => {
        const s = stackRef.current;
        if (s.length >= 2) nav(-1);
        else nav(fallbackTo);
      },
      goBackNonTemp: (fallbackTo: string) => {
        const s = stackRef.current;
        if (s.length < 2) {
          nav(fallbackTo);
          return;
        }
        // Jump back to the most recent non-temporary entry to avoid landing on /edit, /auth, etc.
        const curIdx = s.length - 1;
        let targetIdx = -1;
        for (let i = curIdx - 1; i >= 0; i--) {
          if (!isTemporaryPath(s[i].pathname)) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx < 0) {
          nav(fallbackTo);
          return;
        }
        const delta = targetIdx - curIdx; // negative
        if (delta === 0) nav(fallbackTo);
        else nav(delta);
      },
    };
  }, [nav, prev, prevNonTemp]);

  return <NavHistoryContext.Provider value={value}>{children}</NavHistoryContext.Provider>;
}

export function useNavHistory() {
  const ctx = useContext(NavHistoryContext);
  if (!ctx) throw new Error("useNavHistory must be used within NavHistoryProvider");
  return ctx;
}

