import { useRoute } from "./lib/router";
import { Workspace } from "./components/Workspace";
import { ShareView } from "./share/ShareView";

export function App() {
  const route = useRoute();
  if (route.kind === "share") return <ShareView key={route.id} id={route.id} keyRaw={route.key} />;
  return <Workspace />;
}
