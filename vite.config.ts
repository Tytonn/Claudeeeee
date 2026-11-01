import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";

/**
 * Dev only: shared links (/s/<id>) are rewritten to the SPA by netlify.toml. In dev the
 * Netlify plugin would serve the raw index.html for that rewrite, skipping Vite's HTML
 * transform — so hand those URLs to Vite's own index.html first. (Production serves the
 * built index.html, so this isn't needed there.)
 */
function devShareRoutes(): Plugin {
  return {
    name: "umbra:dev-share-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/s\/[A-Za-z0-9]{8,32}\/?(\?.*)?$/.test(req.url)) req.url = "/share.html";
        next();
      });
    },
  };
}

/**
 * Dev only: the Netlify plugin applies the production headers from netlify.toml —
 * including the strict CSP, which blocks Vite's inline HMR preamble. Relax only
 * `script-src` so every other CSP rule is still exercised while developing.
 */
function devCsp(): Plugin {
  return {
    name: "umbra:dev-csp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const csp = res.getHeader("content-security-policy");
        if (typeof csp === "string") {
          res.setHeader("content-security-policy", csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"));
        }
        next();
      });
    },
  };
}

// Netlify exposes the site's public address as `URL` during builds. Link previews in chat
// apps (Discord, iMessage…) need an absolute og:image, so hand it to index.html.
process.env.VITE_SITE_URL ??= process.env.URL ?? "";

// `netlify()` emulates Netlify Functions + Blobs + redirects + headers inside `vite dev`,
// so sharing works locally exactly like it does in production.
export default defineConfig({
  plugins: [react(), devShareRoutes(), netlify(), devCsp()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      // Same app, two doors: share links get their own page so chat apps show a
      // "shared with you" preview, while the homepage keeps the generic one.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        share: fileURLToPath(new URL("./share.html", import.meta.url)),
      },
    },
  },
});
