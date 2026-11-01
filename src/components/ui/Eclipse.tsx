import { useId } from "react";
import { motion } from "motion/react";

type Props = {
  /** 0 → sun fully visible, 1 → total eclipse (corona). */
  progress: number;
  size?: number;
  className?: string;
  /** Animate the moon on hover / when progress changes. */
  animated?: boolean;
  glow?: boolean;
};

const ANGLE = (-38 * Math.PI) / 180;

export function Eclipse({ progress, size = 28, className = "", animated = true, glow = true }: Props) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { mask: `ecl-m-${raw}`, halo: `ecl-h-${raw}`, blur: `ecl-b-${raw}`, fade: `ecl-f-${raw}`, fadeGrad: `ecl-fg-${raw}` };
  const p = Math.min(1, Math.max(0, progress));
  const r = 7;
  const c = 12;
  const total = p >= 0.995;
  const dist = (1 - p) * r * 2.15;
  const mx = c + Math.cos(ANGLE) * dist;
  const my = c + Math.sin(ANGLE) * dist;
  const transition = animated ? { type: "spring" as const, stiffness: 120, damping: 20 } : { duration: 0 };

  return (
    <svg className={`eclipse ${total ? "is-total" : ""} ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id={ids.halo} cx="50%" cy="50%" r="50%">
          <stop offset="45%" style={{ stopColor: "var(--accent)", stopOpacity: total ? 0.55 : 0.32 }} />
          <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
        </radialGradient>
        <mask id={ids.mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          <motion.circle initial={false} animate={{ cx: mx, cy: my }} transition={transition} r={r * 1.0} fill="black" />
        </mask>
        <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
        {/* The moon fades out softly at the edge of the glow instead of being hard-clipped. */}
        <radialGradient id={ids.fadeGrad} cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>
        <mask id={ids.fade} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <circle cx={c} cy={c} r={12} fill={`url(#${ids.fadeGrad})`} />
        </mask>
      </defs>
      {glow && <circle className="eclipse-halo" cx={c} cy={c} r={11.5} fill={`url(#${ids.halo})`} opacity={0.25 + p * 0.55} />}
      {total && (
        <>
          <circle cx={c} cy={c} r={r + 0.35} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.6} filter={`url(#${ids.blur})`} opacity={0.95} />
          <circle cx={c} cy={c} r={r + 0.1} fill="none" style={{ stroke: "var(--accent-text)" }} strokeWidth={0.6} opacity={0.9} />
        </>
      )}
      <circle cx={c} cy={c} r={r} mask={`url(#${ids.mask})`} style={{ fill: "var(--accent)" }} />
      {/* The moon: an opaque dark body, so the glow reads behind it, never through it. */}
      <g mask={`url(#${ids.fade})`}>
        <motion.circle
          initial={false}
          animate={{ cx: mx, cy: my }}
          transition={transition}
          r={r}
          fill="#050506"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth={0.6}
        />
      </g>
    </svg>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className="logo" aria-hidden>
      <Eclipse progress={0.84} size={size} className="logo-mark" />
    </span>
  );
}
