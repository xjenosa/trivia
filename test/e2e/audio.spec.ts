// Sound is synthesized, so there is nothing to compare by ear here. The test
// listens in on Web Audio instead: it records the pitch of every oscillator the
// page starts, and each cue has notes of its own.

import { expect, test } from "@playwright/test";
import { computerScience } from "../../content/packs/computer-science";
import { joinPhone, PROJECTOR, questionText } from "./helpers";

// Rounded frequencies (Hz) that only one cue plays.
const NOTE = { join: [880, 1319], questionStart: 740, tick: 1175, lastTick: 1760, win: 1047 };

declare global {
  interface Window {
    __heard: { notes: number[]; noise: number };
  }
}

test("sound waits for the host, plays each cue, and M mutes it for good", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: PROJECTOR });
  await context.addInitScript(() => {
    window.__heard = { notes: [], noise: 0 };
    const startTone = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when?: number) {
      window.__heard.notes.push(Math.round(this.frequency.value));
      return startTone.call(this, when);
    };
    const startNoise = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: [number?, number?, number?]) {
      window.__heard.noise += 1;
      return startNoise.apply(this, args);
    };
  });
  const screen = await context.newPage();
  await screen.goto("/host/2d");
  const stage = screen.locator(".stage");
  await expect(stage).toHaveAttribute("data-room", "live");
  const code = (await screen.getByTestId("room-code").first().textContent())!.trim();
  const heard = () => screen.evaluate(() => window.__heard.notes);
  const noise = () => screen.evaluate(() => window.__heard.noise);

  // Nothing plays before the host touches a key, not even for a join.
  const ace = await joinPhone(browser, code, "ace", 0);
  await expect(screen.getByTestId("joined")).toHaveText("1 joined");
  await expect(stage).toHaveAttribute("data-audio", "off");
  expect(await heard()).toEqual([]);

  // The first key press starts audio: lobby music, then a blip for the next join.
  await screen.keyboard.press("p");
  await expect(stage).toHaveAttribute("data-audio", "running");
  await expect.poll(async () => (await heard()).length).toBeGreaterThan(0);
  expect(await heard()).not.toContain(NOTE.join[0]);
  await joinPhone(browser, code, "bob", 1);
  for (const note of NOTE.join) await expect.poll(heard).toContain(note);

  // A question starts with its sting; ace answers right, bob never answers.
  await screen.keyboard.press("s");
  await expect.poll(heard).toContain(NOTE.questionStart);
  const text = await questionText(screen);
  const correct = computerScience.questions.find((q) => q.text === text)!.correct;
  await ace.getByTestId(`zone-${correct}`).click();

  // The clock runs down on its own: ticks in the last five seconds, the last one higher.
  expect(await heard()).not.toContain(NOTE.tick);
  await expect.poll(heard, { timeout: 30_000 }).toContain(NOTE.tick);
  await expect.poll(heard, { timeout: 15_000 }).toContain(NOTE.lastTick);
  const ticks = await noise();
  expect(ticks).toBeGreaterThanOrEqual(5);

  // Time is up: bob's platform gives way with a rumble.
  await expect(screen.locator('.stage[data-phase="reveal"]')).toBeVisible();
  await expect.poll(noise).toBeGreaterThan(ticks);

  // Two more misses and bob is out, which leaves ace the winner.
  for (let round = 0; round < 2; round++) {
    await screen.keyboard.press("n");
    await expect(screen.locator('.stage[data-phase="question"]')).toBeVisible();
    const next = await questionText(screen);
    const right = computerScience.questions.find((q) => q.text === next)!.correct;
    await ace.getByTestId(`zone-${right}`).click();
    await expect(ace.getByTestId("me")).toHaveAttribute("data-zone", String(right));
    await screen.keyboard.press("n");
    await expect(screen.locator('.stage[data-phase="reveal"]')).toBeVisible();
  }
  await screen.keyboard.press("n");
  await expect(screen.locator('.stage[data-phase="over"]')).toBeVisible();
  await expect.poll(heard).toContain(NOTE.win);

  // M mutes, and the choice outlives a reload.
  await expect(stage).not.toHaveAttribute("data-muted", "");
  await screen.keyboard.press("m");
  await expect(stage).toHaveAttribute("data-muted", "");
  expect(await screen.evaluate(() => localStorage.getItem("trivia.muted"))).toBe("1");
  await screen.reload();
  await expect(stage).toHaveAttribute("data-room", "live");
  await expect(stage).toHaveAttribute("data-muted", "");
  await screen.keyboard.press("m");
  await expect(stage).not.toHaveAttribute("data-muted", "");
  expect(await screen.evaluate(() => localStorage.getItem("trivia.muted"))).toBe("0");
});
