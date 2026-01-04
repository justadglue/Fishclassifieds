import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import ListingPage from "./pages/ListingPage";
import PostListingPage from "./pages/PostListingPage";
import MyListingsPage from "./pages/MyListingsPage";
import EditListingPage from "./pages/EditListingPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/listing/:id" element={<ListingPage />} />
      <Route path="/post" element={<PostListingPage />} />
      <Route path="/me" element={<MyListingsPage />} />
      <Route path="/edit/:id" element={<EditListingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
    </Routes>
  );
}
