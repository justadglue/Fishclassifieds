import AdminSettingsPage from "./AdminSettingsPage";

export default function AdminAiFunctionsPage() {
  // Reuse the existing popular searches tooling, but render it outside Settings.
  return <AdminSettingsPage mode="popularSearches" />;
}

