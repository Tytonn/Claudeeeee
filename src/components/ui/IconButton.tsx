import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Placement } from "@floating-ui/react-dom";
import { Tooltip } from "./Tooltip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  kbd?: string | string[];
  tooltip?: boolean;
  placement?: Placement;
  active?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, kbd, tooltip = true, placement = "bottom", active, size = "md", className = "", children, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`icon-btn ${size} ${active ? "is-active" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={label} kbd={kbd} placement={placement}>
      {button}
    </Tooltip>
  );
});
