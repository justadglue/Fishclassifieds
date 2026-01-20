import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MyListingsPage from "./MyListingsPage";

export default function MyDraftsPage() {
  // Reuse the same table/UI; ensure we land on the Drafts tab.
  const nav = useNavigate();
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("type") !== "drafts") {
      sp.set("type", "drafts");
      nav(`/drafts?${sp.toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <MyListingsPage />;
}

