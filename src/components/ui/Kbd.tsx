type Props = { keys: string | string[]; subtle?: boolean; className?: string };

/** Renders shortcut keycaps: "Ctrl K" → [Ctrl][K]. */
export function Kbd({ keys, subtle, className = "" }: Props) {
  const list = Array.isArray(keys) ? keys : keys.split(" ");
  return (
    <span className={`kbd-group ${subtle ? "subtle" : ""} ${className}`} aria-hidden>
      {list.map((k, i) => (
        <kbd key={i} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}
