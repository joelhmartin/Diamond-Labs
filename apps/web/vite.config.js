import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { swapAcceptJsUrl, assertStagingBuildSafe } from "./src/lib/app-env.js";

// Point index.html's Accept.js <script> at the sandbox or live host per
// VITE_AUTHORIZE_NET_ENV. Unset => production URL, so default builds are unchanged.
const acceptJsPlugin = (authNetEnv) => ({
  name: "accept-js-url",
  transformIndexHtml: (html) => swapAcceptJsUrl(html, authNetEnv),
});

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  assertStagingBuildSafe(viteEnv.VITE_APP_ENV, viteEnv.VITE_AUTHORIZE_NET_ENV);
  return {
  plugins: [react(), acceptJsPlugin(viteEnv.VITE_AUTHORIZE_NET_ENV)],
  server: {
    port: 5173,
    // Allow access via dev tunnels (cloudflared/ngrok) — required for testing
    // Authorize.net Accept Hosted, which rejects localhost and needs an https FQDN.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  };
});
