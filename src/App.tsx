import { useEffect, useRef, useState } from "react";
import { useRoute } from "./lib/router";
import { Workspace } from "./components/Workspace";
import { ShareView } from "./share/ShareView";
import { Intro, shouldPlayIntro } from "./fx/Intro";
import { startCollab } from "./collab/manager";
import { startPeopleWatch } from "./components/overlays/People";
import { useApp } from "./store/app";
import { useAccount } from "./account/account";

const ASKED = "umbra:asked-sign-in";

/** Not signed in? Offer it once per visit — just after the intro, or a moment after opening. */
function offerSignIn(delay: number) {
  try {
    if (sessionStorage.getItem(ASKED)) return;
    sessionStorage.setItem(ASKED, "1");
  } catch {
    /* storage blocked: offer anyway */
  }
  window.setTimeout(() => {
    const s = useApp.getState();
    if (useAccount.getState().user || s.ui.account || s.ui.settings || s.ui.palette || s.ui.share) return;
    s.setUI({ account: true });
  }, delay);
}

export function App() {
  const route = useRoute();
  const [intro, setIntro] = useState(() => route.kind === "app" && shouldPlayIntro());
  const started = useRef(false);
  // Keep your shared notes live in the background (only in your own app, not on a share page).
  useEffect(() => {
    if (route.kind === "app" && !started.current) {
      started.current = true;
      startCollab();
      startPeopleWatch();
      if (!intro) offerSignIn(900);
    }
  }, [route.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (route.kind === "share") return <ShareView key={route.id} id={route.id} keyRaw={route.key} />;
  return (
    <>
      <Workspace />
      {intro && (
        <Intro
          onDone={() => {
            setIntro(false);
            offerSignIn(380);
          }}
        />
      )}
    </>
  );
}
