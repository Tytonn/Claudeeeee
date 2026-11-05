import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera, Cloud, CloudOff, CodeXml, LogOut, RefreshCw, UserRound, X } from "lucide-react";
import { useApp } from "../store/app";
import { relativeLong } from "../lib/dates";
import { useNow } from "../lib/hooks";
import { Modal } from "../components/ui/Modal";
import { IconButton } from "../components/ui/IconButton";
import { toast } from "../store/toasts";
import { signOut, useAccount } from "./account";
import { syncNow } from "./sync";
import { AuthForm } from "./AuthForm";
import { usePhoto } from "../components/Avatar";
import { Tooltip } from "../components/ui/Tooltip";
import { addProfilePicture } from "../lib/images";

/** Sign in or create an account (the eclipse form). Also used on private shared links. */
export const AccountForm = AuthForm;

/** The people who make umbra: a small mark beside their own name, in their account. */
const DEVELOPERS = new Set(["tyton"]);

function DevBadge() {
  return (
    <Tooltip label="umbra developer" placement="top">
      <span className="acct-badge">
        <CodeXml size={11} strokeWidth={2.3} aria-hidden />
        dev
      </span>
    </Tooltip>
  );
}

/** Your profile picture (for the account you're signed in to), if you've set one. */
export function useMyPicture() {
  const uid = useAccount((s) => s.user?.uid ?? null);
  const avatar = useApp((s) => s.settings.avatar);
  return usePhoto(uid && avatar?.uid === uid ? avatar : null);
}

/** Your picture, big: tap it to choose a photo; shown to whoever's in a shared note with you. */
function MyPicture({ initial }: { initial: string }) {
  const src = useMyPicture();
  const uid = useAccount((s) => s.user?.uid ?? null);
  const setSettings = useApp((s) => s.setSettings);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    if (!uid) return;
    setBusy(true);
    try {
      const pic = await addProfilePicture(file);
      setSettings({ avatar: { uid, ...pic } });
      toast("Profile picture saved", { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't use that picture.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={`acct-coin ${src ? "has-photo" : ""} ${busy ? "is-busy" : ""}`} onClick={() => input.current?.click()} aria-label={src ? "Change your profile picture" : "Add a profile picture"} disabled={busy}>
        {src ? <img src={src} alt="" draggable={false} /> : initial}
        <span className="acct-coin-edit" aria-hidden>
          <Camera size={15} strokeWidth={1.9} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pick(file);
        }}
      />
    </>
  );
}

function PictureLinks() {
  const src = useMyPicture();
  const setSettings = useApp((s) => s.setSettings);
  return (
    <span className="acct-pic-links">
      <button type="button" className="link-btn" onClick={() => document.querySelector<HTMLButtonElement>(".acct-me .acct-coin")?.click()}>
        {src ? "Change photo" : "Add a photo"}
      </button>
      {src && (
        <>
          <span className="sep" />
          <button type="button" className="link-btn" onClick={() => setSettings({ avatar: null })}>
            Remove
          </button>
        </>
      )}
    </span>
  );
}

function SignedIn({ onClose }: { onClose: () => void }) {
  const { user, sync, lastSync, error } = useSyncExternalStore(useAccount.subscribe, useAccount.getState);
  const now = useNow(15_000);
  const noteCount = useApp((s) => Object.values(s.notes).filter((n) => !n.deletedAt).length);
  const sharedCount = useApp((s) => Object.keys(s.shared).length);
  const counts = { notes: noteCount, shared: sharedCount };
  if (!user) return null;
  return (
    <div className="acct-panel">
      <div className="acct-me">
        <MyPicture initial={user.username.slice(0, 1).toUpperCase()} />
        <span className="acct-me-text">
          <span className="acct-name-row">
            <span className="acct-name">@{user.username}</span>
            {DEVELOPERS.has(user.username) && <DevBadge />}
          </span>
          <PictureLinks />
          <span className={`acct-sync mono is-${sync}`}>
            {sync === "offline" ? <CloudOff size={11} strokeWidth={2} /> : <Cloud size={11} strokeWidth={2} />}
            {sync === "syncing" ? "Syncing…" : sync === "offline" ? "Offline — will sync when you're back" : sync === "error" ? "Sync paused" : lastSync ? `Synced ${relativeLong(lastSync, now)}` : "Synced"}
          </span>
        </span>
      </div>
      {error && <div className="acct-error">{error}</div>}
      <p className="acct-blurb">
        {counts.notes} note{counts.notes === 1 ? "" : "s"}, your lists, links and settings follow you to any device you sign in on
        {counts.shared ? ` — plus the ${counts.shared} note${counts.shared === 1 ? "" : "s"} shared with you` : ""}.
      </p>
      <div className="acct-actions">
        <button type="button" className="ghost-btn" onClick={() => syncNow()}>
          <RefreshCw size={13} strokeWidth={1.8} /> Sync now
        </button>
        <button
          type="button"
          className="ghost-btn danger"
          onClick={async () => {
            await signOut();
            toast("Signed out — your notes stay on this device");
            onClose();
          }}
        >
          <LogOut size={13} strokeWidth={1.8} /> Sign out
        </button>
      </div>
    </div>
  );
}

export function AccountModal() {
  const open = useApp((s) => s.ui.account);
  const setUI = useApp((s) => s.setUI);
  const user = useAccount((s) => s.user);
  const close = () => setUI({ account: false });
  // Keep the sign-in form up through its finale, even though you're signed in by then.
  const [auth, setAuth] = useState(!user);
  useEffect(() => {
    if (open) setAuth(!useAccount.getState().user);
  }, [open]);
  return (
    <Modal open={open} onClose={close} className="account" label="Account">
      <div className={`acct-body ${auth ? "is-auth" : ""}`}>
        <span className="acct-close">
          <IconButton label="Close" kbd="esc" onClick={close}>
            <X size={16} strokeWidth={1.7} />
          </IconButton>
        </span>
        {!auth && user ? (
          <>
            <header className="acct-head">
              <h2 className="display">Your account</h2>
            </header>
            <SignedIn onClose={close} />
          </>
        ) : (
          <AuthForm onDone={close} />
        )}
      </div>
    </Modal>
  );
}

/** The little account button in the sidebar's footer. */
export function AccountButton() {
  const user = useAccount((s) => s.user);
  const sync = useAccount((s) => s.sync);
  const pic = useMyPicture();
  const setUI = useApp((s) => s.setUI);
  return (
    <IconButton label={user ? `@${user.username} — account & sync` : "Sign in to sync"} placement="top" onClick={() => setUI({ account: true })}>
      {user ? (
        <span className={`acct-mini is-${sync} ${pic ? "has-photo" : ""}`}>{pic ? <img src={pic} alt="" draggable={false} /> : user.username.slice(0, 1).toUpperCase()}</span>
      ) : (
        <UserRound size={15} strokeWidth={1.7} />
      )}
    </IconButton>
  );
}
