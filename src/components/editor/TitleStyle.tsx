import { useEffect, useRef } from "react";
import type { VirtualElement } from "@floating-ui/react-dom";
import { AlignCenter, AlignLeft, CopyCheck, RotateCcw } from "lucide-react";
import { useApp } from "../../store/app";
import { Popover } from "../ui/Popover";
import { Segmented } from "../ui/Segmented";
import { TITLE_ALIGNS, TITLE_FONTS, TITLE_SIZES } from "../../lib/theme";
import type { TitleAlignId, TitleFontId, TitleSizeId, TitleStyle } from "../../lib/types";
import { play } from "../../lib/sound";
import { toast } from "../../store/toasts";

/** Opens the open note's title style (the ··· menu and the command palette send it). */
export const TITLE_STYLE_EVENT = "umbra:title-style";

/** Each typeface's "Aa", sized so they all look about the same size. */
const AA_SIZE: Record<TitleFontId, number> = { display: 25, italic: 25, serif: 21, sans: 19, mono: 17 };

/**
 * A title's look — its typeface, size and alignment — right where you are: right-click a title
 * (or ··· → Title style). Everything changes as you choose, on the title itself. It's this note's
 * own look; once it has one, it can become every title's ("Use for all notes"), or go back.
 */
export function TitleStyleMenu({ noteId, anchor, onClose }: { noteId: string; anchor: Element | VirtualElement | null; onClose: () => void }) {
  const own = useApp((s) => s.notes[noteId]?.titleStyle ?? null);
  const settings = useApp((s) => s.settings);
  const box = useRef<HTMLDivElement>(null);
  const open = Boolean(anchor);

  const usual = {
    font: settings.titleFont in TITLE_FONTS ? settings.titleFont : "display",
    size: settings.titleSize in TITLE_SIZES ? settings.titleSize : "m",
    align: settings.titleAlign in TITLE_ALIGNS ? settings.titleAlign : "left",
  } as const;
  const look = { font: own?.font ?? usual.font, size: own?.size ?? usual.size, align: own?.align ?? usual.align };

  // From the keyboard, you land on the current typeface (Tab goes on through the rest).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(".ts-font.is-on")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open]);

  const set = (patch: TitleStyle) => {
    useApp.getState().setTitleStyle(noteId, patch);
    play("tick");
  };

  const reset = () => {
    useApp.getState().setTitleStyle(noteId, null);
    play("untick");
  };

  const useForAll = () => {
    const s = useApp.getState();
    const before = { titleFont: s.settings.titleFont, titleSize: s.settings.titleSize, titleAlign: s.settings.titleAlign };
    s.setSettings({ titleFont: look.font, titleSize: look.size, titleAlign: look.align });
    const had = s.clearTitleStyles();
    play("pop");
    onClose();
    toast("Every title looks like this one now", {
      action: {
        label: "Undo",
        run: () => {
          const st = useApp.getState();
          st.setSettings(before);
          for (const [id, style] of Object.entries(had)) if (st.notes[id]) st.updateNote(id, { titleStyle: style }, false);
        },
      },
    });
  };

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="bottom-start" offsetPx={6} className="title-style" label="Title style">
      <div className="ts" ref={box}>
        <div className="ts-head">
          <span className="label">Title</span>
          <span className="ts-scope">{own ? "This note's own" : "Just this note"}</span>
        </div>
        <div className="ts-fonts" role="radiogroup" aria-label="Typeface">
          {(Object.keys(TITLE_FONTS) as TitleFontId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={look.font === id}
              className={`ts-font ${look.font === id ? "is-on" : ""}`}
              onClick={() => set({ font: id })}
            >
              <span className="ts-aa" style={{ fontFamily: TITLE_FONTS[id].stack, fontStyle: TITLE_FONTS[id].italic ? "italic" : undefined, fontSize: AA_SIZE[id] }}>
                Aa
              </span>
              <span className="ts-name">{id === "italic" ? "Italic" : TITLE_FONTS[id].name}</span>
            </button>
          ))}
        </div>
        <div className="ts-row">
          <span className="ts-label">Size</span>
          <Segmented<TitleSizeId>
            size="sm"
            label="Size"
            value={look.size}
            options={(Object.keys(TITLE_SIZES) as TitleSizeId[]).map((id) => ({ value: id, label: TITLE_SIZES[id].short, title: TITLE_SIZES[id].name }))}
            onChange={(size) => set({ size })}
          />
        </div>
        <div className="ts-row">
          <span className="ts-label">Align</span>
          <Segmented<TitleAlignId>
            size="sm"
            label="Alignment"
            value={look.align}
            options={[
              { value: "left", label: <AlignLeft size={15} strokeWidth={1.8} aria-label="Left" />, title: "Left" },
              { value: "center", label: <AlignCenter size={15} strokeWidth={1.8} aria-label="Center" />, title: "Center" },
            ]}
            onChange={(align) => set({ align })}
          />
        </div>
        {own && (
          <>
            <div className="ts-sep" role="separator" />
            <button type="button" className="ts-action" onClick={useForAll}>
              <CopyCheck size={15} strokeWidth={1.8} />
              <span>Use for all notes</span>
            </button>
            <button type="button" className="ts-action" onClick={reset}>
              <RotateCcw size={15} strokeWidth={1.8} />
              <span>Reset to default</span>
            </button>
          </>
        )}
      </div>
    </Popover>
  );
}
