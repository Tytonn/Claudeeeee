import { useEffect, useState } from "react";
import { useRoute } from "./lib/router";
import { Workspace } from "./components/Workspace";
import { ShareView } from "./share/ShareView";
import { Intro, shouldPlayIntro } from "./fx/Intro";
import { startCollab } from "./collab/manager";

export function App() {
  const route = useRoute();
  const [intro, setIntro] = useState(() => route.kind === "app" && shouldPlayIntro());
  // Keep your shared notes live in the background (only in your own app, not on a share page).
  useEffect(() => {
    if (route.kind === "app") startCollab();
  }, [route.kind]);
  if (route.kind === "share") return <ShareView key={route.id} id={route.id} keyRaw={route.key} />;
  return (
    <>
      <Workspace />
      {intro && <Intro onDone={() => setIntro(false)} />}
    </>
  );
}
