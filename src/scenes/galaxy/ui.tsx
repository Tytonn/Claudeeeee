import { Orbit } from "lucide-react";
import { Eclipse } from "../../components/ui/Eclipse";
import type { SceneUI } from "../types";

/** The galaxy's card: the eclipse itself, in the dark. */
function GalaxyArt() {
  return <Eclipse progress={1} size={34} />;
}

export const galaxyUI: SceneUI = {
  Art: GalaxyArt,
  icon: <Orbit size={15} strokeWidth={1.6} />,
};
