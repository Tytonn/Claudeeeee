import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";

import "./styles/base.css";
import "./styles/ui.css";
import "./styles/layout.css";
import "./styles/editor.css";
import "./styles/widgets.css";
import "./styles/overlays.css";
import "./styles/viewer.css";

import { useApp } from "./store/app";
import { loadAll, startPersistence } from "./store/persist";
import { startShareSync } from "./store/shareSync";
import { applyTheme } from "./lib/theme";
import { setSoundEnabled } from "./lib/sound";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

async function boot() {
  const data = await loadAll();
  useApp.getState().hydrate(data);

  const { settings } = useApp.getState();
  applyTheme(settings);
  setSoundEnabled(settings.sounds);
  useApp.subscribe(
    (s) => s.settings,
    (s) => {
      applyTheme(s);
      setSoundEnabled(s.sounds);
    },
  );

  startPersistence();
  startShareSync();

  // Give the fonts a beat so the first frame is already in the right type.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 450))]);

  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  requestAnimationFrame(() => document.documentElement.classList.add("is-ready"));
}

void boot();
