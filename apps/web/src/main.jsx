import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Expose Authorize.net public keys to Accept.js. These must be set at build time
// via Vite env vars (VITE_AUTHORIZE_NET_API_LOGIN, VITE_AUTHORIZE_NET_CLIENT_KEY).
// The *public* client key is safe to ship in the bundle; the transaction key is not.
window.__AUTHORIZE_NET_API_LOGIN__ = import.meta.env.VITE_AUTHORIZE_NET_API_LOGIN || "";
window.__AUTHORIZE_NET_CLIENT_KEY__ = import.meta.env.VITE_AUTHORIZE_NET_CLIENT_KEY || "";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
