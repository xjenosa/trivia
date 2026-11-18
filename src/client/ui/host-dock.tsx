// The host's control dock: one round glass button per action, its key under it.
//
// Source: the fisheye magnification is adapted from "Mac Style Floating Dock" by
// @themeocean, from 21st.dev (21st.dev/themeocean/mac-style-floating-dock), MIT
// License: each icon keeps a fixed slot, grows on a bell curve around the cursor
// and pushes its neighbors apart, and the glass panel widens to hug them.
//
// Restyled for Trivia (see BRAND.md): Framework7 glyphs in glass buttons instead
// of gradient tiles, the key letter in place of a tooltip, no bounce on click,
// a gentler magnification, and sizes in stage units instead of fixed pixels.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "../common/cn";
import { Icon, type IconName } from "../common/icons";
import { GlassButton } from "./glass";

export interface DockItem {
  id: string;
  label: string; // for screen readers; nothing on screen but the key
  icon: IconName;
  hotkey: string;
  // Lit: the action that matters right now, or a toggle that is on.
  lit?: boolean;
  disabled?: boolean;
}

// In stage units (1% of the stage width), so the dock scales with the projector.
const BASE = 4; // button size at rest
const GAP = 0.9;
const PAD = 1.1; // between the buttons and the glass edge
const MAX_SCALE = 1.28;
const SPREAD = 5; // how far the magnification reaches

export function HostDock({ items, unit, onAction }: { items: DockItem[]; unit: number; onAction(id: string): void }) {
  const [pointer, setPointer] = useState<number | null>(null); // cursor x inside the row, in stage units
  const [reduce, setReduce] = useState(false);
  const row = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Each button has a fixed slot in the resting layout. The cursor is measured
  // against the slot centers, so the numbers stay stable while buttons grow.
  const pitch = BASE + GAP;
  const rowWidth = items.length * BASE + (items.length - 1) * GAP;
  const centers = items.map((_, i) => i * pitch + BASE / 2);
  const scales = centers.map((center) => {
    if (pointer === null || reduce) return 1;
    const distance = pointer - center;
    return 1 + (MAX_SCALE - 1) * Math.exp(-(distance * distance) / (2 * SPREAD * SPREAD));
  });
  // A grown button needs room: push the others apart and keep the dock centered.
  const extra = scales.map((s) => (s - 1) * BASE);
  const totalExtra = extra.reduce((sum, e) => sum + e, 0);
  const shifts = extra.map((e, i) => extra.slice(0, i).reduce((sum, x) => sum + x, 0) + e / 2 - totalExtra / 2);

  const onMove = (event: MouseEvent<HTMLElement>) => {
    const rect = row.current?.getBoundingClientRect();
    if (rect && unit > 0) setPointer((event.clientX - rect.left) / unit);
  };

  return (
    <nav className="dock" aria-label="Host controls" onMouseMove={onMove} onMouseLeave={() => setPointer(null)}>
      <div className="dock-panel glass" aria-hidden="true" style={{ width: `${rowWidth + PAD * 2 + totalExtra}cqw` }} />
      <ul ref={row} className="dock-row" style={{ width: `${rowWidth}cqw`, gap: `${GAP}cqw` }}>
        {items.map((item, i) => (
          <li key={item.id} style={{ width: `${BASE}cqw` }}>
            <div className="dock-slot" style={{ transform: `translateX(${shifts[i]}cqw)` }}>
              <span className="dock-grow" style={{ transform: `scale(${scales[i]})` }}>
                <GlassButton
                  className={cn("dock-button", item.lit && "lit")}
                  aria-label={item.label}
                  aria-pressed={item.lit}
                  disabled={item.disabled}
                  data-testid={`host-${item.id}`}
                  onClick={(event) => {
                    // Drop focus, so Space (next) never re-presses this button.
                    event.currentTarget.blur();
                    onAction(item.id);
                  }}
                  onFocus={() => setPointer(centers[i] ?? null)}
                  onBlur={() => setPointer(null)}
                >
                  <Icon name={item.icon} />
                </GlassButton>
              </span>
              <kbd>{item.hotkey}</kbd>
            </div>
          </li>
        ))}
      </ul>
    </nav>
  );
}
