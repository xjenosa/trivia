// Glass for controls and chrome that float over content (BRAND.md, Glass).
// Three tiers, chosen per browser and per system setting:
//   refract  Chromium: real refraction, from ./liquid-glass.tsx (pills, buttons)
//            and ./glass-card.tsx (panels)
//   frost    Safari and Firefox (so every iPhone): the plain `.glass` blur
//   solid    prefers-reduced-transparency: `.glass` turns opaque in brand.css
// RULE: every glass piece goes through here, so none ships without its fallback.

import { forwardRef, useSyncExternalStore, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { cn } from "../common/cn";
import { GlassCard } from "./glass-card";
import { detectEngine, LiquidGlass, LiquidGlassButton } from "./liquid-glass";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
  );
}

export function useGlassMode(): "refract" | "frost" | "solid" {
  const solid = useMedia("(prefers-reduced-transparency: reduce)");
  if (solid) return "solid";
  return detectEngine() === "chromium" ? "refract" : "frost";
}

export function Glass({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const mode = useGlassMode();
  if (mode !== "refract") {
    return (
      <div className={cn("glass", className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <LiquidGlass material="regular" appearance="dark" className={className} {...props}>
      {children}
    </LiquidGlass>
  );
}

// A panel: a card with content in a body wrapper. The same DOM in every tier, so
// one set of layout rules (the body class) serves all three.
export function GlassPanel({
  className,
  bodyClassName,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { bodyClassName?: string }) {
  const mode = useGlassMode();
  if (mode !== "refract") {
    return (
      <div className={cn("glass", className)} {...props}>
        <div className={bodyClassName}>{children}</div>
      </div>
    );
  }
  return (
    <GlassCard className={className} bodyClassName={bodyClassName} {...props}>
      {children}
    </GlassCard>
  );
}

export const GlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, type = "button", ...props }, ref) => {
    const mode = useGlassMode();
    if (mode !== "refract") {
      return (
        <button ref={ref} type={type} className={cn("glass-button", className)} {...props}>
          {children}
        </button>
      );
    }
    return (
      <LiquidGlassButton
        ref={ref}
        type={type}
        size="icon"
        material="regular"
        appearance="dark"
        interactive
        className={cn("glass-button-liquid", className)}
        {...props}
      >
        {children}
      </LiquidGlassButton>
    );
  },
);
GlassButton.displayName = "GlassButton";
