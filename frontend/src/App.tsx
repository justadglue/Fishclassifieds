import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Footer from "./components/Footer";
import HomePage from "./pages/HomePage";
import BrowseListings from "./pages/BrowseListings";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import AuthGatePage from "./pages/AuthGatePage";
import ListingPage from "./pages/ListingPage";
import PostChoosePage from "./pages/PostChoosePage";
import PostListingPage from "./pages/PostListingPage";
import MyListingsPage from "./pages/MyListingsPage";
import EditListingPage from "./pages/EditListingPage";
import FeatureListingPage from "./pages/FeatureListingPage";
import ProfilePage from "./pages/ProfilePage";
import FaqPage from "./pages/FaqPage.tsx";
import ContactPage from "./pages/ContactPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";
import PrivacyPage from "./pages/PrivacyPage.tsx";
import AdminRoute from "./admin/AdminRoute";
import AdminLayout from "./admin/AdminLayout";
import AdminDashboardPage from "./admin/pages/AdminDashboardPage";
import AdminApprovalsPage from "./admin/pages/AdminApprovalsPage";
import AdminReportsPage from "./admin/pages/AdminReportsPage";
import AdminUsersPage from "./admin/pages/AdminUsersPage";
import AdminUserDetailPage from "./admin/pages/AdminUserDetailPage";
import AdminUserPrivilegesPage from "./admin/pages/AdminUserPrivilegesPage";
import AdminAuditPage from "./admin/pages/AdminAuditPage";
import AdminSettingsPage from "./admin/pages/AdminSettingsPage";
import AdminListingsPage from "./admin/pages/AdminListingsPage";

function ScrollToTopOnRouteChange() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = hash.replace(/^#/, "");
      // Wait a tick so the next route's DOM is mounted.
      window.setTimeout(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }, 0);
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <ScrollToTopOnRouteChange />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/browse" element={<BrowseListings />} />
          <Route path="/listing/:kind/:id" element={<ListingPage />} />
          <Route path="/post" element={<PostChoosePage />} />
          <Route path="/post/:kind" element={<PostListingPage />} />
          <Route path="/me" element={<MyListingsPage />} />
          <Route path="/edit/:kind/:id" element={<EditListingPage />} />
          <Route path="/feature/:id" element={<FeatureListingPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/auth" element={<AuthGatePage />} />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<AdminDashboardPage />} />
            <Route path="listings" element={<AdminListingsPage />} />
            <Route path="approvals" element={<AdminApprovalsPage />} />
            <Route path="reports" element={<AdminReportsPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="users/:id" element={<AdminUserDetailPage />} />
            <Route path="users/privileges" element={<AdminUserPrivilegesPage />} />
          </Route>
        </Routes>
      </div>

      <Footer />
    </div>
  );
}
