// The answering screen: four zones that mirror the platforms, and your token.
// Drag the token onto a zone, or tap a zone.
//
// SEND BUDGET (cost guardrail, mirrored loosely by the room): at most one `move`
// every 250 ms while dragging, none while still, at most 40 per question. The
// final drop and taps are always sent.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { BRACKETS, MOVE_INTERVAL_MS, MOVES_PER_QUESTION, ZONE_COUNT } from "../../shared/config";
import type { PublicPlayer, StateMsg } from "../../shared/protocol";
import { Ring, useTimeLeft } from "../common/bits";
import { avatarVar, initial, platformVar } from "../common/brand";
import type { RoomSocket } from "../common/socket";

interface Drag {
  x: number; // px inside the zones box
  y: number;
  over: number | null;
}

// Where the token rests: bottom right of its zone, or the middle when unanswered.
const REST_NEAR = "calc(50% - 10.75cqw)";
const REST_FAR = "calc(100% - 9.25cqw)";

export function Answer({ state, me, send }: { state: StateMsg; me: PublicPlayer; send: RoomSocket["send"] }) {
  const you = state.you!;
  const ghost = me.status === "out";
  // A ghost gets one guess per question.
  const canAnswer = !ghost || you.zone === null;
  const { seconds, fraction } = useTimeLeft(state);

  const box = useRef<HTMLDivElement>(null);
  const zones = useRef<Array<HTMLButtonElement | null>>([]);
  const budget = useRef({ sent: 0, last: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  // What was just sent, shown until the room confirms it. undefined: follow the room.
  const [sent, setSent] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    budget.current = { sent: 0, last: 0 };
    setDrag(null);
    setSent(undefined);
  }, [state.questionNumber]);
  useEffect(() => setSent(undefined), [you.zone]);

  const resting = sent !== undefined ? sent : you.zone;
  const shown = drag ? drag.over : resting;

  const locate = (event: PointerEvent): (Drag & { nx: number; ny: number }) | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    // Hit test the clamped point, so a drop past the edge lands on the nearest zone.
    const px = rect.left + x;
    const py = rect.top + y;
    let over: number | null = null;
    zones.current.forEach((el, index) => {
      const r = el?.getBoundingClientRect();
      if (r && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) over = index;
    });
    return { x, y, over, nx: (x / rect.width) * 2 - 1, ny: (y / rect.height) * 2 - 1 };
  };

  const onDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (!canAnswer) return;
    const at = locate(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(at);
  };

  const onMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const at = locate(event);
    if (!at) return;
    setDrag(at);
    const now = Date.now();
    const b = budget.current;
    if (!ghost && now - b.last >= MOVE_INTERVAL_MS && b.sent < MOVES_PER_QUESTION) {
      b.last = now;
      b.sent += 1;
      send({ t: "move", x: at.nx, y: at.ny });
    }
  };

  const onUp = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const at = locate(event) ?? { ...drag, nx: 0, ny: 0 };
    setDrag(null);
    if (at.over !== null) {
      send({ t: "pick", zone: at.over });
      setSent(at.over);
    } else if (!ghost) {
      // Dropped in the gap: no answer. The gap lies inside the room's dead zone.
      send({ t: "move", x: at.nx, y: at.ny });
      setSent(null);
    }
  };

  const pick = (zone: number) => {
    if (!canAnswer || drag) return;
    send({ t: "pick", zone });
    setSent(zone);
  };

  const place: CSSProperties = drag
    ? { left: drag.x, top: drag.y }
    : resting === null
      ? { left: "50%", top: "50%" }
      : { left: resting % 2 === 1 ? REST_FAR : REST_NEAR, top: resting >= 2 ? REST_FAR : REST_NEAR };

  // No status line under the zones: the token's place and the ring already say it.
  return (
    <>
      <section className="cell ph-q">
        <h1 className="q" data-testid="question">
          {state.question?.text}
        </h1>
        <Ring seconds={seconds} fraction={fraction} paused={state.paused} />
      </section>
      <div className="zones" ref={box} data-testid="zones">
        {Array.from({ length: ZONE_COUNT }, (_, zone) => (
          <button
            key={zone}
            type="button"
            ref={(el) => {
              zones.current[zone] = el;
            }}
            className={shown === zone ? "zone on" : "zone"}
            style={{ "--p": platformVar(zone) } as CSSProperties}
            data-testid={`zone-${zone}`}
            aria-pressed={resting === zone}
            onClick={() => pick(zone)}
          >
            <span className="br" aria-hidden="true">
              {BRACKETS[zone]}
            </span>
            <span className="ans">{state.question?.answers[zone]}</span>
          </button>
        ))}
        <span
          className={`ava me${drag ? " dragging" : ""}${ghost ? " ghost" : ""}`}
          style={{ "--c": avatarVar(me.color), ...place } as CSSProperties}
          data-testid="me"
          data-zone={resting ?? ""}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {initial(me.name)}
        </span>
      </div>
    </>
  );
}
