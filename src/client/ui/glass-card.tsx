// A glass card: a frosted pane with a refractive rim, for the projector's panels
// (question card, lobby panel, winner card, notice).
//
// Source: "Glass Card" by @educalvolpz, from 21st.dev (21st.dev/educalvolpz/glass-card),
// MIT License. The construction is theirs: a frosted body inset from the edge, a
// rim that bends the backdrop through an SVG displacement filter where the browser
// can (Chromium), a faint chromatic fringe, a specular highlight and top-edge
// sweep, a bottom shade, and a polished inner ring.
//
// Restyled for Trivia (see BRAND.md, Glass):
// - Sizes come from CSS variables (--glass-radius, --glass-rim) in stage units, so
//   the card scales with the projector instead of using fixed pixels.
// - Fill, light and shadow come from the brand tokens in brand.css; the layers are
//   styled in arena/projector.css.
// - No pointer tracking and no hover lift, so no `motion` dependency: nothing
//   hovers over a projector, and the light should hold still.
// Use it through ./glass.tsx, which adds the frosted and solid fallbacks.

import { useEffect, useId, useState, type HTMLAttributes } from "react";
import { cn } from "../common/cn";

// The rim stays nearly sharp: blurred much past a pixel, the bend smears into frost.
const RIM_FILTERS = "blur(2px) saturate(172%) brightness(1.07)";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  // Class for the content wrapper, which sits above the glass layers.
  bodyClassName?: string;
  // Displacement strength of the rim, in px. 0 keeps the rim but removes the bend.
  refraction?: number;
}

export function GlassCard({ className, bodyClassName, refraction = 18, children, ...props }: GlassCardProps) {
  const filterId = `glass-rim-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [canDisplace, setCanDisplace] = useState(false);

  // Only Chromium composites an SVG displacement inside backdrop-filter. Elsewhere
  // the rim keeps its blur and drops the bend, instead of losing the whole declaration.
  useEffect(() => {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return;
    const probe = `url(#${filterId}) blur(2px)`;
    setCanDisplace(CSS.supports("backdrop-filter", probe) || CSS.supports("-webkit-backdrop-filter", probe));
  }, [filterId]);

  const displaces = refraction > 0 && canDisplace;
  const rimBackdrop = displaces ? `url(#${filterId}) ${RIM_FILTERS}` : RIM_FILTERS;

  return (
    <div className={cn("glass-card", className)} {...props}>
      {displaces ? (
        <svg aria-hidden="true" className="glass-card-defs" focusable="false">
          <defs>
            <filter id={filterId}>
              <feTurbulence baseFrequency="0.016 0.024" numOctaves={2} result="noise" seed={7} type="fractalNoise" />
              <feGaussianBlur in="noise" result="soft" stdDeviation={1.4} />
              <feDisplacementMap in="SourceGraphic" in2="soft" scale={refraction} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
      ) : null}

      {/* Frosted body, inset so the rim below samples the raw backdrop. */}
      <div aria-hidden="true" className="glass-card-pane" />

      {/* Refractive rim: the edge that visibly bends what sits behind it. */}
      <div aria-hidden="true" className="glass-card-rim" style={{ backdropFilter: rimBackdrop, WebkitBackdropFilter: rimBackdrop }} />

      {/* Light layers, isolated so blending never leaks past the pane. */}
      <div aria-hidden="true" className="glass-card-light">
        <div className="glass-card-fringe" />
        <div className="glass-card-specular" />
        <div className="glass-card-sweep" />
        <div className="glass-card-shade" />
      </div>

      {/* The polished inner edge. */}
      <div aria-hidden="true" className="glass-card-edge" />

      <div className={cn("glass-card-body", bodyClassName)}>{children}</div>
    </div>
  );
}
