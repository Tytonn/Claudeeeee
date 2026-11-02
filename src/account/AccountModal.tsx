import { useEffect, useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, LogOut, RefreshCw, UserRound, X } from "lucide-react";
import { useApp } from "../store/app";
import { relativeLong } from "../lib/dates";
import { useNow } from "../lib/hooks";
import { Modal } from "../components/ui/Modal";
import { IconButton } from "../components/ui/IconButton";
import { toast } from "../store/toasts";
import { signOut, useAccount } from "./account";
import { syncNow } from "./sync";
import { AuthForm } from "./AuthForm";

/** Sign in or create an account (the eclipse form). Also used on private shared links. */
export const AccountForm = AuthForm;

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
        <span className="acct-coin">{user.username.slice(0, 1).toUpperCase()}</span>
        <span className="acct-me-text">
          <span className="acct-name">@{user.username}</span>
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
  const setUI = useApp((s) => s.setUI);
  return (
    <IconButton label={user ? `@${user.username} — account & sync` : "Sign in to sync"} placement="top" onClick={() => setUI({ account: true })}>
      {user ? (
        <span className={`acct-mini is-${sync}`}>{user.username.slice(0, 1).toUpperCase()}</span>
      ) : (
        <UserRound size={15} strokeWidth={1.7} />
      )}
    </IconButton>
  );
}
