import { describe, expect, it } from "vitest";
import { GAP, LIVES, NAME_MAX, SUDDEN_DEATH_MAX } from "../src/shared/config";
import {
  applyHits,
  clampUnit,
  drawGame,
  drawTier,
  enterSuddenDeath,
  isZone,
  nextStep,
  resolveQuestion,
  sanitizeName,
  zoneCenter,
  zoneFromPosition,
  type GameProgress,
  type RulePlayer,
} from "../src/shared/rules";
import type { Difficulty, Question } from "../content/types";

const player = (pid: string, zone: number | null, lives = LIVES, status: RulePlayer["status"] = "alive"): RulePlayer => ({
  pid,
  lives,
  status,
  zone,
});

// A seeded generator, so draws are repeatable.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pack(perTier: number): Question[] {
  const out: Question[] = [];
  for (const difficulty of [1, 2, 3] as Difficulty[]) {
    for (let i = 0; i < perTier; i++) {
      out.push({ id: `d${difficulty}-${i}`, text: "?", answers: ["a", "b", "c", "d"], correct: 0, difficulty });
    }
  }
  return out;
}

const progress = (over: Partial<GameProgress> = {}): GameProgress => ({
  questionNumber: 1,
  questionCount: 15,
  suddenDeath: false,
  suddenDeathAsked: 0,
  startedCount: 3,
  ...over,
});

describe("zone from position", () => {
  it("maps the four quadrants to the four platforms", () => {
    expect(zoneFromPosition(-0.5, -0.5)).toBe(0);
    expect(zoneFromPosition(0.5, -0.5)).toBe(1);
    expect(zoneFromPosition(-0.5, 0.5)).toBe(2);
    expect(zoneFromPosition(0.5, 0.5)).toBe(3);
  });

  it("treats the middle cross as no answer", () => {
    expect(zoneFromPosition(0, 0)).toBeNull();
    expect(zoneFromPosition(GAP - 0.01, 0.8)).toBeNull();
    expect(zoneFromPosition(-0.8, -(GAP - 0.01))).toBeNull();
    expect(zoneFromPosition(GAP, GAP)).toBe(3);
    expect(zoneFromPosition(-GAP, -GAP)).toBe(0);
  });

  it("puts every zone center inside its own zone", () => {
    for (const zone of [0, 1, 2, 3]) {
      const [x, y] = zoneCenter(zone);
      expect(zoneFromPosition(x, y)).toBe(zone);
    }
  });
});

describe("input clamping", () => {
  it("clamps coordinates to the arena and rejects junk", () => {
    expect(clampUnit(0.25)).toBe(0.25);
    expect(clampUnit(7)).toBe(1);
    expect(clampUnit(-7)).toBe(-1);
    expect(clampUnit(NaN)).toBeNull();
    expect(clampUnit(Infinity)).toBeNull();
    expect(clampUnit("0.5")).toBeNull();
    expect(clampUnit(undefined)).toBeNull();
  });

  it("accepts only zones 0 to 3", () => {
    expect([0, 1, 2, 3].every(isZone)).toBe(true);
    expect([-1, 4, 1.5, NaN, "1", null].some(isZone)).toBe(false);
  });

  it("trims names to 16 characters and strips control characters", () => {
    expect(sanitizeName("  maya  ")).toBe("maya");
    expect(sanitizeName("a\u0000b\u0007c​d")).toBe("abcd");
    expect(sanitizeName("line\nbreak")).toBe("linebreak");
    expect([...sanitizeName("x".repeat(40))]).toHaveLength(NAME_MAX);
    expect(sanitizeName("")).toBe("Player");
    expect(sanitizeName(42)).toBe("Player");
    expect(sanitizeName("   ")).toBe("Player");
  });
});

describe("lives", () => {
  it("costs a life for a wrong answer and for no answer", () => {
    const players = [player("right", 1), player("wrong", 2), player("none", null)];
    const result = resolveQuestion(players, 1);
    expect(result).toEqual({ floorHeld: false, hits: ["wrong", "none"] });
    const after = applyHits(players, result.hits);
    expect(after.map((p) => p.lives)).toEqual([3, 2, 2]);
    expect(after.every((p) => p.status === "alive")).toBe(true);
  });

  it("turns a player out at zero lives", () => {
    const after = applyHits([player("a", 0, 1)], ["a"]);
    expect(after[0]).toMatchObject({ lives: 0, status: "out" });
  });

  it("holds the floor when everyone still in is wrong", () => {
    const players = [player("a", 0), player("b", null), player("c", 3)];
    expect(resolveQuestion(players, 1)).toEqual({ floorHeld: true, hits: [] });
  });

  it("ignores players who are out or waiting", () => {
    const players = [player("alive", 1), player("ghost", 0, 0, "out"), player("late", null, 3, "waiting")];
    expect(resolveQuestion(players, 1)).toEqual({ floorHeld: false, hits: [] });
    // The only player still in is wrong: the floor holds even though a ghost guessed right.
    const allWrong = [player("alive", 0), player("ghost", 1, 0, "out")];
    expect(resolveQuestion(allWrong, 1)).toEqual({ floorHeld: true, hits: [] });
  });

  it("never hits a player who is not alive", () => {
    const after = applyHits([player("ghost", 0, 0, "out")], ["ghost"]);
    expect(after[0]).toMatchObject({ lives: 0, status: "out" });
  });
});

describe("how a game ends", () => {
  it("continues while more than one player has lives and questions remain", () => {
    expect(nextStep([player("a", 0), player("b", 0)], progress({ questionNumber: 14 }))).toEqual({ kind: "continue" });
  });

  it("ends early when one player has lives left", () => {
    const players = [player("a", 0, 2), player("b", 0, 0, "out"), player("c", 0, 0, "out")];
    expect(nextStep(players, progress({ questionNumber: 3 }))).toEqual({ kind: "over", winners: ["a"] });
  });

  it("lets a solo game run to the last question", () => {
    const solo = [player("a", 0)];
    expect(nextStep(solo, progress({ questionNumber: 3, startedCount: 1 }))).toEqual({ kind: "continue" });
    expect(nextStep(solo, progress({ questionNumber: 15, startedCount: 1 }))).toEqual({ kind: "over", winners: ["a"] });
  });

  it("gives the win to the most lives after the last question", () => {
    const players = [player("a", 0, 3), player("b", 0, 2), player("c", 0, 1)];
    expect(nextStep(players, progress({ questionNumber: 15 }))).toEqual({ kind: "over", winners: ["a"] });
  });

  it("sends tied leaders into sudden death", () => {
    const players = [player("a", 0, 2), player("b", 0, 2), player("c", 0, 1)];
    expect(nextStep(players, progress({ questionNumber: 15 }))).toEqual({ kind: "suddenDeath", contenders: ["a", "b"] });
    const after = enterSuddenDeath(players, ["a", "b"]);
    expect(after.map((p) => [p.lives, p.status])).toEqual([
      [1, "alive"],
      [1, "alive"],
      [0, "out"],
    ]);
  });

  it("plays sudden death as one wrong answer and you are out, floor-holds included", () => {
    const tied = enterSuddenDeath([player("a", 0), player("b", 1)], ["a", "b"]);
    const round = resolveQuestion(tied, 0);
    expect(round).toEqual({ floorHeld: false, hits: ["b"] });
    const after = applyHits(tied, round.hits);
    expect(nextStep(after, progress({ questionNumber: 16, suddenDeath: true, suddenDeathAsked: 1 }))).toEqual({
      kind: "over",
      winners: ["a"],
    });
    // Both wrong: the floor holds and both stay in.
    expect(resolveQuestion(tied, 3)).toEqual({ floorHeld: true, hits: [] });
  });

  it("shares the win when sudden death runs out of questions", () => {
    const tied = [player("a", 0, 1), player("b", 0, 1)];
    const before = progress({ questionNumber: 17, suddenDeath: true, suddenDeathAsked: SUDDEN_DEATH_MAX - 1 });
    expect(nextStep(tied, before)).toEqual({ kind: "continue" });
    const after = progress({ questionNumber: 18, suddenDeath: true, suddenDeathAsked: SUDDEN_DEATH_MAX });
    expect(nextStep(tied, after)).toEqual({ kind: "over", winners: ["a", "b"] });
  });

  it("ends with no winner when nobody is left", () => {
    expect(nextStep([player("a", 0, 0, "out")], progress())).toEqual({ kind: "over", winners: [] });
  });
});

describe("question draw", () => {
  const questions = pack(20);
  const tierOf = (id: string) => Number(id[1]);

  it("draws 5 easy, then 5 medium, then 5 hard", () => {
    const { ids } = drawGame(questions, [], seeded(1));
    expect(ids).toHaveLength(15);
    expect(ids.map(tierOf)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect(new Set(ids).size).toBe(15);
  });

  it("shuffles inside a tier", () => {
    const a = drawGame(questions, [], seeded(1)).ids;
    const b = drawGame(questions, [], seeded(2)).ids;
    expect(a).not.toEqual(b);
  });

  it("does not repeat a question across games until a tier runs out", () => {
    const rng = seeded(7);
    let asked: string[] = [];
    const seen: string[] = [];
    for (let game = 0; game < 4; game++) {
      const draw = drawGame(questions, asked, rng);
      seen.push(...draw.ids);
      asked = draw.asked;
    }
    // 4 games x 5 per tier uses each tier of 20 exactly once.
    expect(new Set(seen).size).toBe(60);
    // The fifth game has to start over, and still never repeats inside itself.
    const fifth = drawGame(questions, asked, rng);
    expect(new Set(fifth.ids).size).toBe(15);
    expect(fifth.ids.map(tierOf)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  });

  it("uses up the unasked questions before starting a tier over", () => {
    const small = pack(7);
    const first = drawTier(small, 1, 5, [], seeded(3));
    const second = drawTier(small, 1, 5, first.asked, seeded(4));
    const fresh = small.filter((q) => q.difficulty === 1 && !first.ids.includes(q.id)).map((q) => q.id);
    expect(second.ids).toHaveLength(5);
    expect(new Set(second.ids).size).toBe(5);
    expect(fresh.every((id) => second.ids.includes(id))).toBe(true);
    // The tier's memory restarted with just this draw.
    expect([...second.asked].sort()).toEqual([...second.ids].sort());
  });

  it("leaves other tiers' memory alone when one tier starts over", () => {
    const small = pack(5);
    const first = drawGame(small, [], seeded(5));
    const hard = drawTier(small, 3, 1, first.asked, seeded(6));
    expect(hard.ids).toHaveLength(1);
    expect(hard.asked.filter((id) => tierOf(id) === 1)).toHaveLength(5);
    expect(hard.asked.filter((id) => tierOf(id) === 3)).toEqual(hard.ids);
  });

  it("draws what it can from a tier smaller than the request", () => {
    const tiny = pack(2);
    const { ids } = drawGame(tiny, [], seeded(8));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
