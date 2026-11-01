import { useRef } from "react";
import { ArrowLeft, Share } from "lucide-react";
import { useApp } from "../store/app";
import { BOARD, useShareStatus } from "../store/shareSync";
import { useIsMobile, useNow } from "../lib/hooks";
import { openShare } from "../lib/actions";
import { Countdowns } from "./widgets/Countdowns";
import { Todos } from "./widgets/Todos";
import { Tooltip } from "./ui/Tooltip";
import { IconButton } from "./ui/IconButton";
import { ShareSheet } from "./overlays/ShareSheet";

export function Rail() {
  const settings = useApp((s) => s.settings);
  const shareOpen = useApp((s) => s.ui.share === BOARD);
  const shared = useApp((s) => Boolean(s.shares[BOARD]));
  const status = useShareStatus((s) => s[BOARD]);
  const setUI = useApp((s) => s.setUI);
  const isMobile = useIsMobile();
  const now = useNow(60_000);
  // A stable wrapper: the button inside swaps (icon → "Live" pill) once shared,
  // and the share sheet must stay anchored through that swap.
  const shareAnchor = useRef<HTMLSpanElement>(null);
  const d = new Date(now);

  if (!settings.todos && !settings.countdowns) return <aside className="rail is-empty" aria-hidden />;

  return (
    <aside className="rail" aria-label="To-dos and countdowns">
      <div className="rail-inner">
        <header className="rail-head">
          {isMobile && (
            <IconButton label="Back" tooltip={false} onClick={() => setUI({ mobile: useApp.getState().ui.activeId ? "editor" : "list" })}>
              <ArrowLeft size={17} strokeWidth={1.7} />
            </IconButton>
          )}
          <div className="rail-date">
            <div className="rail-day display">{d.toLocaleDateString(undefined, { weekday: "long" })}</div>
            <div className="rail-full mono">{d.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</div>
          </div>
          <span ref={shareAnchor} className="rail-share">
          {shared ? (
            <Tooltip label="Lists are shared — manage link">
              <button
                type="button"
                className={`pill-btn sm is-live ${shareOpen ? "is-open" : ""}`}
                onClick={() => (shareOpen ? setUI({ share: null }) : openShare(BOARD))}
              >
                <span className={`live-dot ${status === "syncing" ? "is-syncing" : ""}`} />
                <span>Live</span>
              </button>
            </Tooltip>
          ) : (
            <IconButton label="Share your lists" active={shareOpen} onClick={() => (shareOpen ? setUI({ share: null }) : openShare(BOARD))}>
              <Share size={15} strokeWidth={1.7} />
            </IconButton>
          )}
          </span>
        </header>
        {settings.countdowns && <Countdowns />}
        {settings.todos && <Todos />}
      </div>
      <ShareSheet anchor={BOARD} open={shareOpen} anchorEl={shareAnchor.current} onClose={() => setUI({ share: null })} />
    </aside>
  );
}
