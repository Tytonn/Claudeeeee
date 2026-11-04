import { AnimatePresence, motion } from "motion/react";
import { Orbit, Sun } from "lucide-react";
import { useApp } from "../../store/app";
import type { AccentId } from "../../lib/types";
import { Row } from "../../components/overlays/settingsParts";
import { Switch } from "../../components/ui/Switch";
import { Segmented, SegmentedEpoch } from "../../components/ui/Segmented";
import iris from "./cards/iris.webp";
import moon from "./cards/moon.webp";
import sky from "./cards/sky.webp";
import mint from "./cards/mint.webp";
import corona from "./cards/corona.webp";
import ember from "./cards/ember.webp";
import rose from "./cards/rose.webp";
import type { SceneUI } from "../types";

/** The galaxy's card: the scene itself — an eclipse in deep space, in your accent's colours. */
const CARDS: Record<AccentId, string> = { iris, moon, sky, mint, corona, ember, rose };

function GalaxyArt() {
  const accent = useApp((s) => s.settings.accent);
  return <img className="scene-img" src={CARDS[accent] ?? CARDS.iris} alt="" aria-hidden draggable={false} decoding="async" />;
}

/** The galaxy's own settings (with effects on). */
function GalaxySettings() {
  const effects = useApp((s) => s.settings.effects);
  const on = useApp((s) => s.settings.galaxyEclipse === true);
  const spot = useApp((s) => (s.settings.galaxyEclipseSpot === "middle" ? "middle" : "beside"));
  const scene = useApp((s) => s.settings.scene);
  const setSettings = useApp((s) => s.setSettings);
  if (effects === "off") return null;
  return (
    <>
      <Row label="Eclipse" desc="A total eclipse of its own, hanging in the galaxy — a black moon, its corona streaming out into the nebula. Off, the note itself is the moon.">
        <Switch checked={on} onChange={(v) => setSettings({ galaxyEclipse: v })} label="Eclipse" />
      </Row>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div key="spot" className="set-row-slide" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }} style={{ overflow: "hidden" }}>
            <Row label="Where it hangs" desc={spot === "middle" ? "Right in the middle of the screen, behind your words." : "Beside your writing, in the open sky."}>
              <SegmentedEpoch.Provider value={scene}>
                <Segmented<"beside" | "middle">
                  label="Where the eclipse hangs"
                  size="sm"
                  value={spot}
                  options={[
                    { value: "beside", label: "Beside" },
                    { value: "middle", label: "Middle" },
                  ]}
                  onChange={(v) => setSettings({ galaxyEclipseSpot: v })}
                />
              </SegmentedEpoch.Provider>
            </Row>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export const galaxyUI: SceneUI = {
  Art: GalaxyArt,
  icon: <Orbit size={15} strokeWidth={1.6} />,
  Settings: GalaxySettings,
  commands: (settings, set) => [
    ...(settings.galaxyEclipse === true
      ? [
          {
            id: "galaxy-eclipse-spot",
            label: settings.galaxyEclipseSpot === "middle" ? "Move the eclipse beside your writing" : "Move the eclipse to the middle",
            icon: <Sun size={15} strokeWidth={1.6} />,
            keywords: "eclipse moon middle center centre beside side move place galaxy",
            run: () => set({ galaxyEclipseSpot: settings.galaxyEclipseSpot === "middle" ? "beside" : "middle" }),
          },
        ]
      : []),
    {
      id: "galaxy-eclipse",
      label: settings.galaxyEclipse === true ? "Put the eclipse away (the note is the moon)" : "Hang an eclipse in the galaxy",
      icon: <Sun size={15} strokeWidth={1.6} />,
      keywords: "eclipse moon sun corona galaxy space total black hole ring",
      run: () => set({ galaxyEclipse: settings.galaxyEclipse !== true }),
    },
  ],
};
