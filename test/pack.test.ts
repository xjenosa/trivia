// Pack validation: the measurable half of the style rules in
// content/packs/computer-science.ts. Whether a fact is true is the owner's review.

import { describe, expect, it } from "vitest";
import { GAME_QUESTIONS, TIER_QUESTIONS } from "../src/shared/config";
import { drawGame } from "../src/shared/rules";
import { PACKS } from "../content/packs";
import { ANSWER_MAX, TEXT_MAX } from "../content/types";

const TIER_LETTER = { 1: "e", 2: "m", 3: "h" } as const;
const length = (text: string) => [...text].length;
// Built from its code, so this file itself keeps to the rule.
const EM_DASH = String.fromCharCode(0x2014);

describe.each(PACKS)("pack $id", (pack) => {
  const { questions } = pack;

  it("has 60 questions with unique ids", () => {
    expect(questions).toHaveLength(60);
    expect(new Set(questions.map((q) => q.id)).size).toBe(60);
  });

  it("has 20 questions in each tier", () => {
    for (const difficulty of [1, 2, 3] as const) {
      expect(questions.filter((q) => q.difficulty === difficulty)).toHaveLength(20);
    }
  });

  it("names each question after its tier", () => {
    for (const q of questions) {
      expect(q.id, q.id).toMatch(new RegExp(`^cs-${TIER_LETTER[q.difficulty]}\\d\\d$`));
    }
  });

  it("keeps every question to one short line", () => {
    for (const q of questions) {
      expect(length(q.text), q.id).toBeLessThanOrEqual(TEXT_MAX);
      expect(q.text.trim(), q.id).toBe(q.text);
      expect(q.text, q.id).not.toMatch(/[\r\n\t]/);
      expect(q.text.endsWith("?"), q.id).toBe(true);
    }
    expect(new Set(questions.map((q) => q.text)).size).toBe(questions.length);
  });

  it("keeps every answer short enough to print on a platform", () => {
    for (const q of questions) {
      expect(q.answers, q.id).toHaveLength(4);
      for (const answer of q.answers) {
        expect(length(answer), `${q.id}: ${answer}`).toBeGreaterThan(0);
        expect(length(answer), `${q.id}: ${answer}`).toBeLessThanOrEqual(ANSWER_MAX);
        expect(answer.trim(), q.id).toBe(answer);
      }
      expect(new Set(q.answers.map((a) => a.toLowerCase())).size, q.id).toBe(4);
    }
  });

  it("points every question at one of its four answers", () => {
    for (const q of questions) {
      expect([0, 1, 2, 3], q.id).toContain(q.correct);
    }
  });

  it("spreads the correct answer evenly across the platforms", () => {
    const count = (list: typeof questions, index: number) => list.filter((q) => q.correct === index).length;
    for (const index of [0, 1, 2, 3]) {
      // 60 questions over 4 platforms is 15 each; allow a little drift.
      expect(count(questions, index), `platform ${index}`).toBeGreaterThanOrEqual(13);
      expect(count(questions, index), `platform ${index}`).toBeLessThanOrEqual(17);
      // And no tier leans on one platform.
      for (const difficulty of [1, 2, 3] as const) {
        const tier = questions.filter((q) => q.difficulty === difficulty);
        expect(count(tier, index), `tier ${difficulty}, platform ${index}`).toBeGreaterThanOrEqual(4);
        expect(count(tier, index), `tier ${difficulty}, platform ${index}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it("uses no em dash", () => {
    for (const q of questions) {
      expect([q.text, ...q.answers].join(" "), q.id).not.toContain(EM_DASH);
    }
  });

  it("fills four whole games before any question repeats", () => {
    let asked: string[] = [];
    const seen = new Set<string>();
    for (let game = 0; game < 60 / GAME_QUESTIONS; game++) {
      const draw = drawGame(questions, asked);
      expect(draw.ids).toHaveLength(GAME_QUESTIONS);
      for (const id of draw.ids) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
      asked = draw.asked;
    }
    expect(seen.size).toBe(60);
    expect(TIER_QUESTIONS * 3).toBe(GAME_QUESTIONS);
  });
});

describe("all packs", () => {
  it("share no question ids", () => {
    const ids = PACKS.flatMap((pack) => pack.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
