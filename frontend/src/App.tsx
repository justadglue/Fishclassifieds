import { useEffect } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import HomePage from "./pages/HomePage";
import BrowseListings from "./pages/BrowseListings";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import AuthGatePage from "./pages/AuthGatePage";
import ListingPage from "./pages/ListingPage";
import PostListingPage from "./pages/PostListingPage";
import MyListingsPage from "./pages/MyListingsPage";
import EditListingPage from "./pages/EditListingPage";
import ProfilePage from "./pages/ProfilePage";
import FaqPage from "./pages/FaqPage.tsx";
import ContactPage from "./pages/ContactPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";
import PrivacyPage from "./pages/PrivacyPage.tsx";
import WantedPostPage from "./pages/WantedPostPage.tsx";
import WantedDetailPage from "./pages/WantedDetailPage.tsx";
import WantedEditPage from "./pages/WantedEditPage.tsx";

function ScrollToTopOnRouteChange() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTopOnRouteChange />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowseListings />} />
        <Route path="/listing/:id" element={<ListingPage />} />
        <Route path="/post" element={<PostListingPage />} />
        <Route path="/me" element={<MyListingsPage />} />
        <Route path="/edit/:id" element={<EditListingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/wanted" element={<Navigate to="/browse?type=wanted" replace />} />
        <Route path="/wanted/post" element={<WantedPostPage />} />
        <Route path="/wanted/:id" element={<WantedDetailPage />} />
        <Route path="/wanted/edit/:id" element={<WantedEditPage />} />
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
