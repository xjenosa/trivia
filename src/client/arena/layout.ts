// Where every token stands. Shared by the 3D arena and the 2D screen, so the two
// projector pages always agree.

import type { PublicPlayer, StateMsg } from "../../shared/protocol";
import { zoneFromPosition } from "../../shared/rules";

export type Spot = "dock" | 0 | 1 | 2 | 3;
export type Positions = Map<string, [number, number]>;

// A reveal plays in three beats: 0 the answer shows, 1 wrong platforms drop and
// the players on them fall, 2 they are back on the dock with a life gone.
export type RevealStage = 0 | 1 | 2;
export const DROP_MS = 900;
export const RESPAWN_MS = 3600;

export interface Standing {
  player: PublicPlayer;
  spot: Spot;
  index: number; // place among the tokens on the same spot
  count: number;
  // What the board shows, which trails the room's state until the respawn.
  lives: number;
  ghost: boolean;
  falling: boolean;
}

export function standings(state: StateMsg, positions: Positions, stage: RevealStage): Standing[] {
  const list: Standing[] = [];
  const counts = new Map<Spot, number>();
  const reveal = state.phase === "reveal";

  for (const player of state.players) {
    // Late joiners stay off the board until the next game.
    if (player.status === "waiting") continue;
    const hit = reveal && player.hit === true;
    const pending = hit && stage < 2;

    let spot: Spot = "dock";
    if (state.phase === "question" && player.status === "alive") {
      const xy = positions.get(player.pid);
      const zone = xy ? zoneFromPosition(xy[0], xy[1]) : null;
      if (zone !== null) spot = zone as Spot;
    } else if (reveal && player.zone != null && !(hit && stage === 2)) {
      spot = player.zone as Spot;
    }

    const index = counts.get(spot) ?? 0;
    counts.set(spot, index + 1);
    list.push({
      player,
      spot,
      index,
      count: 0,
      lives: player.lives + (pending ? 1 : 0),
      ghost: player.status === "out" && !pending,
      falling: hit && stage === 1,
    });
  }
  for (const standing of list) standing.count = counts.get(standing.spot) ?? 1;
  return list;
}

export interface Grid {
  cols: number;
  rows: number;
  scale: number;
}

// The grid of `count` cells that fits an area with the least shrinking.
export function fitGrid(count: number, areaW: number, areaH: number, cellW: number, cellH: number): Grid {
  let best: Grid = { cols: 1, rows: Math.max(1, count), scale: 0 };
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(count / cols);
    const scale = Math.min(1, areaW / (cols * cellW), areaH / (rows * cellH));
    if (scale > best.scale + 1e-6) best = { cols, rows, scale };
  }
  return best;
}

// Offset of cell `index` from the area's center, in cells. Short last rows center.
export function gridCell(index: number, count: number, grid: Grid): { col: number; row: number } {
  const row = Math.floor(index / grid.cols);
  const inRow = row === grid.rows - 1 ? count - row * grid.cols : grid.cols;
  return {
    col: (index % grid.cols) - (inRow - 1) / 2,
    row: row - (grid.rows - 1) / 2,
  };
}

// Points of a superellipse (a squircle at n = 5), optionally pushed outward along
// the normals so a ring keeps an even gap all the way round.
export function superellipse(w: number, h: number, n = 5, offset = 0, segments = 96): Array<[number, number]> {
  const base: Array<[number, number]> = [];
  for (let k = 0; k < segments; k++) {
    const t = (k / segments) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    base.push([(Math.sign(c) * Math.abs(c) ** (2 / n) * w) / 2, (Math.sign(s) * Math.abs(s) ** (2 / n) * h) / 2]);
  }
  if (offset === 0) return base;
  return base.map(([x, y], k) => {
    const a = base[(k + segments - 1) % segments]!;
    const b = base[(k + 1) % segments]!;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    return [x + (ty / len) * offset, y - (tx / len) * offset];
  });
}

// A bar with squircle ends: the square squircle of the short side, cut in half and
// pulled apart. The long edges are straight and the corners keep their true shape
// however long the bar is. Stretching one superellipse to w by h bows the long
// edges and flattens the corners, so never use that for a shape that is not square.
export function bar(w: number, h: number, n = 5, segments = 96): Array<[number, number]> {
  const side = Math.min(w, h);
  const dx = (w - side) / 2;
  const dy = (h - side) / 2;
  return superellipse(side, side, n, 0, segments).map(([x, y]) => [x + Math.sign(x) * dx, y + Math.sign(y) * dy]);
}

export function pathOf(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`).join("") + "Z";
}
