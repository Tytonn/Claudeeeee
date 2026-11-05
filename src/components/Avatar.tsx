import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { imageUrl } from "../lib/images";

type Picture = { id: string; key: string; type: string };

/** A picture's URL: the photo (decrypted once, then kept on this device), or null while it isn't here. */
export function usePhoto(pic: Picture | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const id = pic?.id ?? null;
  const key = pic?.key ?? null;
  const type = pic?.type ?? null;
  useEffect(() => {
    setSrc(null);
    if (!id || !key || !type) return;
    let live = true;
    void imageUrl({ id, key, type }).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [id, key, type]);
  return src;
}

/**
 * Someone's picture, as a little disc: their photo if they've set one; otherwise their initial,
 * glowing in their colour; and for a guest (not signed in), a figure in a colour of their own.
 */
export function Avatar({
  name,
  color,
  picture,
  guest = false,
  size = 28,
  className = "",
}: {
  name: string;
  color: string;
  picture?: Picture | null;
  guest?: boolean;
  size?: number;
  className?: string;
}) {
  const src = usePhoto(guest ? null : picture);
  const initial = Array.from(name.replace(/^@/, "").trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={`avatar ${src ? "has-photo" : ""} ${guest ? "is-guest" : ""} ${className}`}
      style={{ "--c": color, "--s": `${size}px` } as React.CSSProperties}
      aria-hidden
    >
      {src ? <img src={src} alt="" draggable={false} /> : guest ? <UserRound size={Math.round(size * 0.58)} strokeWidth={2.1} /> : <span className="avatar-initial">{initial}</span>}
    </span>
  );
}
