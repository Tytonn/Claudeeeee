import { useState } from "react";
import { useRoute } from "./lib/router";
import { Workspace } from "./components/Workspace";
import { ShareView } from "./share/ShareView";
import { Intro, shouldPlayIntro } from "./fx/Intro";

export function App() {
  const route = useRoute();
  const [intro, setIntro] = useState(() => route.kind === "app" && shouldPlayIntro());
  if (route.kind === "share") return <ShareView key={route.id} id={route.id} keyRaw={route.key} />;
  return (
    <>
      <Workspace />
      {intro && <Intro onDone={() => setIntro(false)} />}
    </>
  );
}
