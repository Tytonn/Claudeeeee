import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Globe, Lock, UserX } from "lucide-react";
import { useApp } from "../../store/app";
import { BOARD } from "../../store/shareSync";
import { toast } from "../../store/toasts";
import { ApiError, getPeople, initPeople, patchPeople, type People, type Person } from "../../lib/api";
import { sha256B64, writeTokenFor } from "../../lib/crypto";
import { displayTitle } from "../../lib/text";
import { openShare } from "../../lib/actions";
import { play } from "../../lib/sound";
import { IDLE_AFTER, lastInputAt } from "../../lib/activity";
import { PENDING_EVENT } from "../../collab/manager";
import { Popover } from "../ui/Popover";
import { Menu } from "../ui/Menu";
import type { ShareRecord } from "../../lib/types";

/**
 * Who can open a shared link — the owner's side of it, like a doc's "Share" dialog:
 * anyone with the link, or only people you let in; and for each person who has opened
 * it while signed in, what they can do — or remove them, any time.
 */

/** How many people are waiting to be let in, per shared link (shown as a dot on Share). */
export const usePending = create<Record<string, number>>(() => ({}));

async function load(record: ShareRecord): Promise<People> {
  try {
    return await getPeople(record.id, record.token);
  } catch (err) {
    // Links from before access lists: start one now.
    if (err instanceof ApiError && err.code === "no_acl") {
      const linkHash = await sha256B64(await writeTokenFor(record.key));
      return initPeople(record.id, record.token, { linkHash, mode: record.restricted ? "restricted" : "link", linkRole: record.editable === false ? "view" : "edit" });
    }
    throw err;
  }
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function RoleMenu({ person, onPick }: { person: Person; onPick: (role: "edit" | "view" | "blocked") => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const label = person.role === "edit" ? "Can edit" : person.role === "view" ? "Can view" : person.role === "blocked" ? "Removed" : "Waiting";
  return (
    <>
      <button ref={btn} type="button" className={`people-role ${person.role}`} onClick={() => setOpen((v) => !v)}>
        {label} <ChevronDown size={12} strokeWidth={2} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-end" role="menu">
        <Menu
          items={[
            { label: "Can edit", icon: person.role === "edit" ? <Check size={15} /> : <span className="menu-gap" />, onSelect: () => onPick("edit") },
            { label: "Can view", icon: person.role === "view" ? <Check size={15} /> : <span className="menu-gap" />, onSelect: () => onPick("view") },
            "divider",
            person.role === "blocked"
              ? { label: "Let back in", icon: <span className="menu-gap" />, onSelect: () => onPick("edit") }
              : { label: "Remove access", icon: <UserX size={15} />, danger: true, onSelect: () => onPick("blocked") },
          ]}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </>
  );
}

export function PeoplePanel({ anchor }: { anchor: string }) {
  const record = useApp((s) => s.shares[anchor]);
  const [data, setData] = useState<People | null>(null);
  const [error, setError] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => {
    if (!record) return;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await load(record);
        if (stopped) return;
        setData(res);
        setError(false);
        usePending.setState({ [anchor]: res.members.filter((m) => m.role === "pending").length });
      } catch {
        if (!stopped) setError(true);
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [record?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!record) return null;

  const patch = async (p: Parameters<typeof patchPeople>[2]) => {
    try {
      const res = await patchPeople(record.id, record.token, p);
      setData(res);
      usePending.setState({ [anchor]: res.members.filter((m) => m.role === "pending").length });
      if (p.mode) useApp.getState().patchShare(anchor, { restricted: p.mode === "restricted" });
    } catch {
      toast("Couldn't reach the server — try again", { tone: "error" });
    }
  };

  const members = data?.members ?? [];
  const pending = members.filter((m) => m.role === "pending");
  const active = members.filter((m) => m.role === "edit" || m.role === "view");
  const removed = members.filter((m) => m.role === "blocked");
  const restricted = data?.mode === "restricted";

  return (
    <div className="people">
      <div className="people-head label">Who can open it</div>
      <div className="people-modes" role="radiogroup" aria-label="Who can open it">
        {(
          [
            ["link", <Globe size={14} strokeWidth={1.8} key="g" />, "Anyone with the link", "No sign-in needed"],
            ["restricted", <Lock size={14} strokeWidth={1.8} key="l" />, "Only people I let in", "They sign in and ask; you approve"],
          ] as const
        ).map(([mode, icon, title, sub]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={(data?.mode ?? "link") === mode}
            className={`people-mode ${(data?.mode ?? "link") === mode ? "is-on" : ""}`}
            disabled={!data}
            onClick={() => (data?.mode !== mode ? void patch({ mode }) : undefined)}
          >
            <span className="people-mode-icon">{icon}</span>
            <span className="people-mode-text">
              <span>{title}</span>
              <span className="people-mode-sub">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {pending.map((p) => (
          <motion.div key={p.uid} className="people-row is-pending" layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
            <span className="people-coin">{initials(p.name || p.username)}</span>
            <span className="people-text">
              <span className="people-name">{p.name || p.username}</span>
              <span className="people-sub mono">@{p.username} · wants in</span>
            </span>
            <button
              type="button"
              className="primary-btn sm"
              onClick={() => {
                play("chime");
                void patch({ uid: p.uid, role: data?.linkRole ?? "edit" });
              }}
            >
              Let in
            </button>
            <button type="button" className="ghost-btn sm" onClick={() => void patch({ uid: p.uid, role: "blocked" })}>
              Decline
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="people-list">
        <AnimatePresence initial={false}>
          {active.map((p) => (
            <motion.div key={p.uid} className="people-row" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
              <span className="people-coin">{initials(p.name || p.username)}</span>
              <span className="people-text">
                <span className="people-name">{p.name || p.username}</span>
                <span className="people-sub mono">@{p.username}</span>
              </span>
              <RoleMenu
                person={p}
                onPick={(role) => {
                  if (role === "blocked") toast(`${p.name || p.username} can't open it anymore`);
                  void patch({ uid: p.uid, role });
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {data && !active.length && !pending.length && (
          <div className="people-empty">
            {restricted
              ? "Nobody's in yet. When someone opens the link and signs in, they'll ask here — you decide."
              : "People who open the link while signed in show up here. Change what they can do, or remove them, any time."}
          </div>
        )}
        {error && !data && <div className="people-empty">Couldn't load who has access — retrying…</div>}
      </div>

      {removed.length > 0 && (
        <div className="people-removed">
          <button type="button" className="link-btn" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? "Hide" : "Show"} {removed.length} removed
          </button>
          {showRemoved &&
            removed.map((p) => (
              <div key={p.uid} className="people-row is-removed">
                <span className="people-coin">{initials(p.name || p.username)}</span>
                <span className="people-text">
                  <span className="people-name">{p.name || p.username}</span>
                  <span className="people-sub mono">@{p.username}</span>
                </span>
                <button type="button" className="ghost-btn sm" onClick={() => void patch({ uid: p.uid, role: data?.linkRole ?? "edit" })}>
                  Let back in
                </button>
              </div>
            ))}
        </div>
      )}
      {!restricted && removed.length > 0 && (
        <p className="people-fine">Removed people can't open it while signed in. To keep anyone else out too, switch to "Only people I let in".</p>
      )}
    </div>
  );
}

/**
 * Watches private links for people asking to get in, and lets you know — once every 45 seconds,
 * and only while you're here to be told (the tab showing, someone at the keyboard). A note you
 * have open hears of them sooner: its own check-ins carry the count (see collab/manager.ts).
 */
export function startPeopleWatch() {
  const seen = new Map<string, Set<string>>();
  const check = async (only?: string) => {
    const s = useApp.getState();
    for (const record of Object.values(s.shares)) {
      if (!record.restricted || (only && record.anchor !== only)) continue;
      try {
        const res = await getPeople(record.id, record.token);
        const pending = res.members.filter((m) => m.role === "pending");
        usePending.setState({ [record.anchor]: pending.length });
        const known = seen.get(record.anchor) ?? new Set<string>();
        for (const p of pending) {
          if (known.has(p.uid)) continue;
          known.add(p.uid);
          const note = record.anchor === BOARD ? null : useApp.getState().notes[record.anchor];
          toast(`${p.name || p.username} wants to open “${note ? displayTitle(note) : "your lists"}”`, {
            duration: 12_000,
            action: { label: "Review", run: () => (record.anchor === BOARD ? useApp.getState().setUI({ share: BOARD }) : (useApp.getState().selectNote(record.anchor), openShare(record.anchor))) },
          });
          play("chime");
        }
        seen.set(record.anchor, known);
      } catch {
        /* try again next round */
      }
    }
  };
  const tick = async () => {
    if (!document.hidden && Date.now() - lastInputAt() < IDLE_AFTER) await check();
    window.setTimeout(tick, 45_000);
  };
  window.addEventListener(PENDING_EVENT, (e) => void check((e as CustomEvent<string>).detail));
  window.setTimeout(tick, 3000);
}
