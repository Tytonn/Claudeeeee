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
import "./styles/fx.css";
import "./styles/collab.css";

import { useApp } from "./store/app";
import { loadAll, startPersistence, storageOk } from "./store/persist";
import { toast } from "./store/toasts";
import { startShareSync } from "./store/shareSync";
import { startSync, syncNow } from "./account/sync";
import { ACCENTS, RAIN_AMOUNT, applyTheme } from "./lib/theme";
import type { Settings } from "./lib/types";
import { fx } from "./fx/engine";
import { refreshPointerLight, startPointerLight } from "./fx/dom";
import { setSoundEnabled, setSoundTheme } from "./lib/sound";
import { startViewportFit } from "./lib/platform";
import { startVaultWatch } from "./lib/vault";
import { startImageSync } from "./lib/images";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Whatever happens during startup, never leave the launch veil up.
window.setTimeout(() => document.getElementById("veil")?.remove(), 6000);

async function boot() {
  startViewportFit();
  const data = await loadAll();
  useApp.getState().hydrate(data);

  const { settings } = useApp.getState();
  const syncFx = (s: Settings, first = false) => {
    fx.setLevel(s.effects);
    const accent = ACCENTS[s.accent] ?? ACCENTS.iris;
    fx.setAccent(accent.color, accent.nebula);
    const amount = RAIN_AMOUNT[s.rainAmount] ?? 0.5;
    const blur = typeof s.cityBlur === "number" ? Math.min(1, Math.max(0, s.cityBlur)) : 1;
    fx.setRain({ lightning: s.lightning !== false, city: s.cityLights !== false, amount, blur });
    fx.setScene(s.scene === "rain" || s.scene === "solar" ? s.scene : "eclipse", first);
    fx.setSolar({ clouds: s.solarClouds !== false });
    setSoundTheme(fx.rain && s.effects !== "off" ? "rain" : "eclipse");
    fx.setOpen(s.backdrop === "bare");
    if (fx.cursorLight !== (s.cursorLight !== false)) {
      fx.setCursorLight(s.cursorLight !== false);
      refreshPointerLight();
    }
  };
  applyTheme(settings);
  setSoundEnabled(settings.sounds);
  syncFx(settings, true);
  fx.init();
  startPointerLight();
  if (import.meta.env.DEV) Object.assign(window as object, { __fx: fx, __app: useApp, __syncNow: syncNow });
  useApp.subscribe(
    (s) => s.settings,
    (s) => {
      applyTheme(s);
      setSoundEnabled(s.sounds);
      syncFx(s);
    },
  );

  if (storageOk) {
    startPersistence();
  } else {
    // Couldn't read what's saved: don't write either, or we'd overwrite it with a blank slate.
    toast("Couldn't open your saved notes in this browser, so nothing will be saved right now. Try reloading.", {
      tone: "error",
      duration: 24 * 3_600_000,
    });
  }
  startShareSync();
  startSync();
  startVaultWatch();
  startImageSync();

  // Give the fonts a beat so the first frame is already in the right type.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 450))]);

  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  requestAnimationFrame(() => document.documentElement.classList.add("is-ready"));
  // Lift the launch veil once the first real frame is up: at once if the intro (which brings its
  // own dark) is playing, otherwise as a soft fade.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const veil = document.getElementById("veil");
      if (!veil) return;
      if (document.querySelector(".intro")) veil.remove();
      else {
        veil.style.opacity = "0";
        window.setTimeout(() => veil.remove(), 500);
      }
    }),
  );
}

void boot();
