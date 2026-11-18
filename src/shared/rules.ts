// Pure game rules. No clocks, sockets or storage here, so every rule is unit tested.
// The Room Durable Object (src/worker/room.ts) is the only caller that mutates a game.

import { GAP, NAME_MAX, SUDDEN_DEATH_MAX, TIER_QUESTIONS, ZONE_CENTER, ZONE_COUNT } from "./config";
import type { Status } from "./protocol";
import type { Difficulty, Question } from "../../content/types";

export interface RulePlayer {
  pid: string;
  lives: number;
  status: Status;
  zone: number | null;
}

// ---- input clamping

export function clampUnit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

export function isZone(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < ZONE_COUNT;
}

// Zones mirror the platforms: 0 back left, 1 back right, 2 front left, 3 front right.
// The middle cross (the dead zone) is no answer at all.
export function zoneFromPosition(x: number, y: number, gap = GAP): number | null {
  if (Math.abs(x) < gap || Math.abs(y) < gap) return null;
  return (y > 0 ? 2 : 0) + (x > 0 ? 1 : 0);
}

export function zoneCenter(zone: number): [number, number] {
  return [zone % 2 === 1 ? ZONE_CENTER : -ZONE_CENTER, zone >= 2 ? ZONE_CENTER : -ZONE_CENTER];
}

export function sanitizeName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const clean = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, NAME_MAX).join("").trim() || "Player";
}

// ---- lives

export interface Resolution {
  // Everyone still in was wrong, so nobody loses a life and no platform drops.
  floorHeld: boolean;
  hits: string[];
}

// A wrong answer and no answer cost the same. Only players still alive count.
export function resolveQuestion(players: readonly RulePlayer[], correct: number): Resolution {
  const alive = players.filter((p) => p.status === "alive");
  const wrong = alive.filter((p) => p.zone !== correct);
  const floorHeld = alive.length > 0 && wrong.length === alive.length;
  return { floorHeld, hits: floorHeld ? [] : wrong.map((p) => p.pid) };
}

export function applyHits<T extends RulePlayer>(players: readonly T[], hits: readonly string[]): T[] {
  const hit = new Set(hits);
  return players.map((p) => {
    if (!hit.has(p.pid) || p.status !== "alive") return p;
    const lives = Math.max(0, p.lives - 1);
    return { ...p, lives, status: lives === 0 ? "out" : "alive" };
  });
}

// ---- how a game ends

export interface GameProgress {
  questionNumber: number; // the question just revealed, 1-based
  questionCount: number;
  suddenDeath: boolean;
  suddenDeathAsked: number;
  startedCount: number; // players in at the start; a solo game never ends early
}

export type Outcome =
  | { kind: "continue" }
  | { kind: "suddenDeath"; contenders: string[] }
  | { kind: "over"; winners: string[] };

export function nextStep(players: readonly RulePlayer[], game: GameProgress): Outcome {
  const alive = players.filter((p) => p.status === "alive");
  if (alive.length === 0) return { kind: "over", winners: [] };
  if (alive.length === 1 && game.startedCount > 1) return { kind: "over", winners: [alive[0]!.pid] };

  if (game.suddenDeath) {
    if (game.suddenDeathAsked >= SUDDEN_DEATH_MAX) return { kind: "over", winners: alive.map((p) => p.pid) };
    return { kind: "continue" };
  }
  if (game.questionNumber < game.questionCount) return { kind: "continue" };

  const most = Math.max(...alive.map((p) => p.lives));
  const leaders = alive.filter((p) => p.lives === most).map((p) => p.pid);
  if (leaders.length === 1) return { kind: "over", winners: leaders };
  return { kind: "suddenDeath", contenders: leaders };
}

// Sudden death is the normal rules with one life each: the tied leaders stay in,
// everyone else still alive is out.
export function enterSuddenDeath<T extends RulePlayer>(players: readonly T[], contenders: readonly string[]): T[] {
  const inIt = new Set(contenders);
  return players.map((p) => {
    if (p.status !== "alive") return p;
    return inIt.has(p.pid) ? { ...p, lives: 1 } : { ...p, lives: 0, status: "out" };
  });
}

// ---- question draw

export type Rng = () => number;

export function shuffle<T>(list: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface Draw {
  ids: string[];
  // The room's memory of what it has asked, updated for this draw.
  asked: string[];
}

// Picks `count` questions of one tier, avoiding the ones already asked. When the
// tier runs out, its memory is cleared and the rest come from the whole tier again.
export function drawTier(
  questions: readonly Question[],
  difficulty: Difficulty,
  count: number,
  asked: readonly string[],
  rng: Rng = Math.random,
): Draw {
  const tier = questions.filter((q) => q.difficulty === difficulty).map((q) => q.id);
  const seen = new Set(asked);
  const ids = shuffle(tier.filter((id) => !seen.has(id)), rng).slice(0, count);
  if (ids.length === count) return { ids, asked: [...asked, ...ids] };

  const inTier = new Set(tier);
  const taken = new Set(ids);
  const refill = shuffle(tier.filter((id) => !taken.has(id)), rng).slice(0, count - ids.length);
  const all = [...ids, ...refill];
  return { ids: all, asked: [...asked.filter((id) => !inTier.has(id)), ...all] };
}

// A game ramps: easy, then medium, then hard, shuffled inside each tier.
export function drawGame(
  questions: readonly Question[],
  asked: readonly string[],
  rng: Rng = Math.random,
  perTier = TIER_QUESTIONS,
): Draw {
  let memory = [...asked];
  const ids: string[] = [];
  for (const difficulty of [1, 2, 3] as const) {
    const draw = drawTier(questions, difficulty, perTier, memory, rng);
    ids.push(...draw.ids);
    memory = draw.asked;
  }
  return { ids, asked: memory };
}
