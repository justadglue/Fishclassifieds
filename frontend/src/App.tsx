import { useEffect } from "react";
import { Navigate, Routes, Route, useLocation, useParams } from "react-router-dom";
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
import { listingDetailPath, listingEditPath } from "./listings/routes";

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

function LegacySaleListingRedirect() {
  const { id } = useParams();
  if (!id) return <Navigate to="/browse?type=sale" replace />;
  return <Navigate to={listingDetailPath("sale", id)} replace />;
}

function LegacyWantedListingRedirect() {
  const { id } = useParams();
  if (!id) return <Navigate to="/browse?type=wanted" replace />;
  return <Navigate to={listingDetailPath("wanted", id)} replace />;
}

function LegacySaleEditRedirect() {
  const { id } = useParams();
  if (!id) return <Navigate to="/me" replace />;
  return <Navigate to={listingEditPath("sale", id)} replace />;
}

function LegacyWantedEditRedirect() {
  const { id } = useParams();
  if (!id) return <Navigate to="/me" replace />;
  return <Navigate to={listingEditPath("wanted", id)} replace />;
}

export default function App() {
  return (
    <>
      <ScrollToTopOnRouteChange />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowseListings />} />
        <Route path="/listing/:kind/:id" element={<ListingPage />} />
        <Route path="/listing/:id" element={<LegacySaleListingRedirect />} />
        <Route path="/post" element={<PostChoosePage />} />
        <Route path="/post/:kind" element={<PostListingPage />} />
        <Route path="/post/listing" element={<Navigate to="/post/sale" replace />} />
        <Route path="/me" element={<MyListingsPage />} />
        <Route path="/edit/:kind/:id" element={<EditListingPage />} />
        <Route path="/edit/:id" element={<LegacySaleEditRedirect />} />
        <Route path="/feature/:id" element={<FeatureListingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/wanted" element={<Navigate to="/browse?type=wanted" replace />} />
        <Route path="/wanted/post" element={<Navigate to="/post/wanted" replace />} />
        <Route path="/wanted/:id" element={<LegacyWantedListingRedirect />} />
        <Route path="/wanted/edit/:id" element={<LegacyWantedEditRedirect />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/auth" element={<AuthGatePage />} />
      </Routes>
    </>
  );
}
