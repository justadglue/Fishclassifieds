import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { initImageFadeIn } from "./imageFade";
import { DialogProvider } from "./components/dialogs/DialogProvider";

initImageFadeIn();

// In an SPA, browsers often restore scroll on refresh/back/forward.
// We handle scroll position ourselves on route changes.
if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <DialogProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DialogProvider>
    </AuthProvider>
  </StrictMode>
);
