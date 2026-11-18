// The flat board for /host/2d: the same room and the same layout rules as the 3D
// arena (arena/layout.ts), drawn with DOM and CSS for weak venue laptops.
//
// VIEW: straight down from above, not the arena's angle. So each platform is a
// true square squircle, like an app icon on a home screen, and a platform that
// drops falls away from the viewer (it shrinks) instead of sliding down the page.

import { useMemo, type CSSProperties } from "react";
import { BRACKETS, ZONE_COUNT } from "../../shared/config";
import { Hearts, Token } from "../common/bits";
import { platformVar } from "../common/brand";
import { cn } from "../common/cn";
import { bar, fitGrid, gridCell, pathOf, standings, superellipse, type Spot } from "../arena/layout";
import type { BoardProps } from "../arena/Projector";

// Stage units (cqw). The board sits between the question card and the host dock,
// laid out as the arena is from above: a 2x2 of squares, the dock in front.
const SIDE = 11;
const GAP = 1.4;
const NEAR = SIDE / 2 + GAP / 2;
const CENTER = { x: 50, y: 28.5 };
const PLATFORMS: Array<[number, number]> = [
  [CENTER.x - NEAR, CENTER.y - NEAR],
  [CENTER.x + NEAR, CENTER.y - NEAR],
  [CENTER.x - NEAR, CENTER.y + NEAR],
  [CENTER.x + NEAR, CENTER.y + NEAR],
];
const DOCK = { x: 50, y: 44, w: 34, h: 6.2 };
// A standee: hearts, token, name.
const CELL_W = 4.5;
const CELL_H = 6;
// Tokens stand on the lower half of a platform, clear of the answer above.
const TOKEN_AREA = { w: SIDE - 1, h: 5.6, dy: 2.3 };

const FILL = pathOf(superellipse(SIDE, SIDE));
// The answer ring: the platform's own outline pushed out along its normals, so
// the gap is even all the way round.
const RING = pathOf(superellipse(SIDE, SIDE, 5, 0.42));
const DOCK_PATH = pathOf(bar(DOCK.w, DOCK.h));

export function Board2D({ state, positions, stage, tick }: BoardProps) {
  // `tick` changes when positions do; they are mutated in place.
  const placed = useMemo(() => (state ? standings(state, positions, stage) : []), [state, positions, stage, tick]);
  const phase = state?.phase ?? "lobby";
  const reveal = phase === "reveal";
  const dropping = reveal && stage >= 1 && state?.floorHeld === false;

  const grids = new Map<Spot, ReturnType<typeof fitGrid>>();
  for (const standing of placed) {
    if (grids.has(standing.spot)) continue;
    const area = standing.spot === "dock" ? { w: DOCK.w - 2, h: DOCK.h - 0.4 } : TOKEN_AREA;
    grids.set(standing.spot, fitGrid(standing.count, area.w, area.h, CELL_W, CELL_H));
  }

  return (
    <div className="board2d" data-phase={phase} data-empty={state ? undefined : ""}>
      {Array.from({ length: ZONE_COUNT }, (_, zone) => {
        const [x, y] = PLATFORMS[zone]!;
        const correct = reveal && state?.correct === zone;
        const answer = state?.question?.answers[zone] ?? "";
        return (
          <div
            key={zone}
            className={cn("plat", correct && "correct", dropping && !correct && "dropped")}
            style={{ left: `${x - SIDE / 2}cqw`, top: `${y - SIDE / 2}cqw`, "--p": platformVar(zone), "--tilt": zone % 2 ? "14deg" : "-14deg" } as CSSProperties}
            data-testid={`platform-${zone}`}
            data-correct={correct ? "" : undefined}
          >
            <svg viewBox={`${-SIDE / 2} ${-SIDE / 2} ${SIDE} ${SIDE}`} aria-hidden="true">
              <defs>
                <linearGradient id={`sheen-${zone}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" className="sheen-top" />
                  <stop offset="0.3" className="sheen-base" />
                </linearGradient>
              </defs>
              <path d={FILL} fill={`url(#sheen-${zone})`} />
              <path className="answer-ring" d={RING} />
            </svg>
            {/* The platform's own mark, big and centered. The answer is separate text. */}
            <span className="plat-mark" aria-hidden="true">
              {BRACKETS[zone]}
            </span>
            <span className="plat-label" data-long={answer.length > 10 ? "" : undefined}>
              {answer}
            </span>
          </div>
        );
      })}

      <svg
        className="dock2d"
        viewBox={`${-DOCK.w / 2} ${-DOCK.h / 2} ${DOCK.w} ${DOCK.h}`}
        style={{ left: `${DOCK.x - DOCK.w / 2}cqw`, top: `${DOCK.y - DOCK.h / 2}cqw`, width: `${DOCK.w}cqw`, height: `${DOCK.h}cqw` }}
        aria-hidden="true"
      >
        <path d={DOCK_PATH} />
      </svg>

      {placed.map((standing) => {
        const grid = grids.get(standing.spot)!;
        const cell = gridCell(standing.index, standing.count, grid);
        const center = standing.spot === "dock" ? [DOCK.x, DOCK.y] : [PLATFORMS[standing.spot]![0], PLATFORMS[standing.spot]![1] + TOKEN_AREA.dy];
        const x = center[0]! + cell.col * CELL_W * grid.scale;
        const y = center[1]! + cell.row * CELL_H * grid.scale;
        const p = standing.player;
        // A respawn remounts the token, so it pops onto the dock instead of flying back up.
        const life = reveal && p.hit && stage === 2 ? `back-${state?.questionNumber}` : "on";
        return (
          <div
            key={`${p.pid}:${life}`}
            className={cn("tok", standing.falling && "falling", standing.ghost && "ghost")}
            style={{ "--x": `${x}cqw`, "--y": `${y}cqw`, "--s": grid.scale } as CSSProperties}
            data-testid="token"
            data-pid={p.pid}
            data-name={p.name}
            data-spot={standing.spot}
            data-lives={standing.lives}
          >
            <Hearts lives={standing.lives} />
            <Token color={p.color} name={p.name} />
            <span className="tok-name">{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}
