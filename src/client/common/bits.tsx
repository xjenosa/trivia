// Small pieces every page shares: the player token, the hearts, the countdown ring.

import type { CSSProperties } from "react";
import { LIVES, QUESTION_MS, REVEAL_MS } from "../../shared/config";
import type { StateMsg } from "../../shared/protocol";
import { avatarVar, initial } from "./brand";
import { cn } from "./cn";
import { Icon, SILHOUETTE } from "./icons";
import { useNow } from "./socket";

export function Token({
  color,
  name,
  className,
  style,
}: {
  color: number;
  name?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cn("ava", className)} style={{ "--c": avatarVar(color), ...style } as CSSProperties}>
      {name === undefined ? null : initial(name) || (
        <svg className="ava-person" viewBox={SILHOUETTE.viewBox} aria-hidden="true">
          <path d={SILHOUETTE.d} />
        </svg>
      )}
    </span>
  );
}

export function Hearts({ lives, className }: { lives: number; className?: string }) {
  return (
    <span className={cn("hearts", className)} role="img" aria-label={`${lives} of ${LIVES} lives`}>
      {Array.from({ length: LIVES }, (_, i) => (
        <span key={i} className={i < lives ? undefined : "lost"}>
          <Icon name="heart_fill" />
        </span>
      ))}
    </span>
  );
}

// Time left on the room's timer, on the server's clock.
export function useTimeLeft(state: StateMsg | null): { seconds: number; fraction: number } {
  const now = useNow(state !== null && state.deadline > 0 && !state.paused);
  if (!state || state.deadline === 0) return { seconds: 0, fraction: 0 };
  const total = state.phase === "reveal" ? REVEAL_MS : QUESTION_MS;
  const left = Math.max(0, state.paused ? state.deadline - state.serverNow : state.deadline - now);
  return { seconds: Math.ceil(left / 1000), fraction: Math.min(1, left / total) };
}

const CIRCUMFERENCE = 125.66; // 2 * pi * r, r = 20

export function Ring({
  seconds,
  fraction,
  paused,
  className,
}: {
  seconds: number;
  fraction: number;
  paused?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("timer", paused && "paused", className)} role="timer" aria-label={`${seconds} seconds left`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="ring-track" cx="24" cy="24" r="20" />
        <circle
          className="ring-fill"
          cx="24"
          cy="24"
          r="20"
          style={{ strokeDashoffset: CIRCUMFERENCE * (1 - fraction) }}
        />
      </svg>
      <span className="ring-num" data-testid="countdown">
        {seconds}
      </span>
    </div>
  );
}
