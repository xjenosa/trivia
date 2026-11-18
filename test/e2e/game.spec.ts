// The whole game through real pages: a projector that hosts, and phones that join
// from its room code. Each phone is its own browser context, like a real device.

import { expect, test, type Page } from "@playwright/test";
import { computerScience } from "../../content/packs/computer-science";
import { joinPhone, openProjector, questionText } from "./helpers";

function lookup(text: string) {
  const question = computerScience.questions.find((q) => q.text === text);
  if (!question) throw new Error(`question not in the pack: ${text}`);
  return question;
}

const phase = (page: Page, name: string) => page.locator(`.stage[data-phase="${name}"]`);

for (const path of ["/host/2d", "/host"] as const) {
  test.describe(`a game hosted on ${path}`, () => {
    test("three phones join, answer, and the reveal costs the wrong ones a life", async ({ browser }) => {
      const { page: screen, code } = await openProjector(browser, path);

      // The host key stays in localStorage; the URL carries the room code alone.
      expect(new URL(screen.url()).search).toBe(`?room=${code}`);
      const hostKey = await screen.evaluate((key) => localStorage.getItem(key), `trivia.host.${code}`);
      expect(hostKey).toBeTruthy();
      expect(await screen.content()).not.toContain(hostKey!);

      const ace = await joinPhone(browser, code, "ace", 0);
      const bob = await joinPhone(browser, code, "bob", 3);
      const cy = await joinPhone(browser, code, "cy", 5);
      await expect(screen.getByTestId("joined")).toHaveText("3 joined");
      await expect(ace.getByTestId("title")).toHaveText("Ready");

      await screen.keyboard.press("s");
      await expect(phase(screen, "question")).toBeVisible();
      await expect(screen.getByTestId("progress")).toHaveText("1 of 15");

      const text = await questionText(screen);
      const question = lookup(text);
      await expect(ace.getByTestId("question")).toHaveText(text);
      const wrong = (question.correct + 1) % 4;

      // Nothing on the projector or a phone gives the answer away yet.
      await expect(screen.getByTestId("answer")).toHaveCount(0);
      await expect(screen.locator("[data-correct]")).toHaveCount(0);

      // ace taps the right answer, bob drags his token onto a wrong one, cy never answers.
      await ace.getByTestId(`zone-${question.correct}`).click();
      await expect(ace.getByTestId("me")).toHaveAttribute("data-zone", String(question.correct));
      await expect(ace.getByTestId(`zone-${question.correct}`)).toHaveAttribute("aria-pressed", "true");

      const from = (await bob.getByTestId("me").boundingBox())!;
      const to = (await bob.getByTestId(`zone-${wrong}`).boundingBox())!;
      await bob.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await bob.mouse.down();
      await bob.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await bob.mouse.up();
      await expect(bob.getByTestId("me")).toHaveAttribute("data-zone", String(wrong));
      await expect(cy.getByTestId("me")).toHaveAttribute("data-zone", "");

      if (path === "/host/2d") {
        await expect(screen.locator('[data-testid="token"][data-name="ace"]')).toHaveAttribute("data-spot", String(question.correct));
        await expect(screen.locator('[data-testid="token"][data-name="bob"]')).toHaveAttribute("data-spot", String(wrong));
        await expect(screen.locator('[data-testid="token"][data-name="cy"]')).toHaveAttribute("data-spot", "dock");
      }

      // The host skips ahead: the reveal.
      await screen.keyboard.press("n");
      await expect(phase(screen, "reveal")).toBeVisible();
      await expect(screen.getByTestId("answer")).toHaveText(question.answers[question.correct]);
      if (path === "/host/2d") await expect(screen.getByTestId(`platform-${question.correct}`)).toHaveAttribute("data-correct", "");

      await expect(ace.getByTestId("title")).toHaveText("Safe");
      await expect(ace.getByRole("img", { name: "3 of 3 lives" })).toBeVisible();
      await expect(bob.getByTestId("title")).toHaveText("Lost a life");
      await expect(bob.getByRole("img", { name: "2 of 3 lives" })).toBeVisible();
      await expect(cy.getByTestId("title")).toHaveText("Lost a life");
      await expect(cy.getByRole("img", { name: "2 of 3 lives" })).toBeVisible();

      // After the drop, the fallen are back on the dock with a life gone.
      await expect(screen.getByTestId("alive")).toHaveText("3 left");
      await expect(screen.getByTestId("alive")).not.toHaveClass(/hide/, { timeout: 8000 });
      if (path === "/host/2d") {
        await expect(screen.locator('[data-testid="token"][data-name="bob"]')).toHaveAttribute("data-lives", "2");
        await expect(screen.locator('[data-testid="token"][data-name="bob"]')).toHaveAttribute("data-spot", "dock");
        await expect(screen.locator('[data-testid="token"][data-name="ace"]')).toHaveAttribute("data-lives", "3");
      }

      // On to question 2, then pause and resume.
      await screen.keyboard.press("n");
      await expect(screen.getByTestId("progress")).toHaveText("2 of 15");
      await expect(ace.getByTestId("question")).not.toHaveText(text);
      await screen.keyboard.press("p");
      await expect(ace.getByRole("timer")).toHaveClass(/paused/);
      await screen.keyboard.press("p");
      await expect(ace.getByRole("timer")).not.toHaveClass(/paused/);
      await expect(ace.getByTestId("me")).toHaveAttribute("data-zone", "");

      // A reload puts a phone straight back in, lives intact.
      await bob.reload();
      await expect(bob.getByTestId("question")).toBeVisible();
      await expect(bob.getByRole("img", { name: "2 of 3 lives" })).toBeVisible();

      // Esc takes two presses mid-game, then everyone is back in the lobby.
      await screen.keyboard.press("Escape");
      await expect(phase(screen, "question")).toBeVisible();
      await screen.keyboard.press("Escape");
      await expect(phase(screen, "lobby")).toBeVisible();
      await expect(bob.getByTestId("title")).toHaveText("Ready");
      await expect(bob.getByRole("img", { name: "3 of 3 lives" })).toBeVisible();
    });

    test("the host buttons work, a kicked player stays out, and other devices cannot host", async ({ browser }) => {
      test.skip(path === "/host", "the host controls are one component; covered on /host/2d");
      const { page: screen, code } = await openProjector(browser, path);
      const ace = await joinPhone(browser, code, "ace", 1);
      const bob = await joinPhone(browser, code, "bob", 2);
      await expect(screen.getByTestId("joined")).toHaveText("2 joined");

      // Click a name to arm it, click again to remove the player.
      const chip = screen.getByTestId("roster").getByRole("button", { name: /bob/ });
      await chip.click();
      await expect(screen.getByTestId("joined")).toHaveText("2 joined");
      await chip.click();
      await expect(screen.getByTestId("joined")).toHaveText("1 joined");
      await expect(bob.getByRole("alert")).toHaveText("Removed by the host");
      await bob.getByTestId("join-button").click();
      await expect(bob.getByRole("alert")).toHaveText("Removed by the host");
      await expect(screen.getByTestId("joined")).toHaveText("1 joined");

      // Buttons do what the keys do.
      await screen.getByTestId("host-start").click();
      await expect(phase(screen, "question")).toBeVisible();
      await screen.getByTestId("host-pause").click();
      await expect(screen.locator(".stage[data-paused]")).toBeVisible();
      await screen.getByTestId("host-pause").click();
      await expect(screen.locator(".stage[data-paused]")).toHaveCount(0);
      await screen.getByTestId("host-mute").click();
      await expect(screen.locator(".stage[data-muted]")).toBeVisible();
      await screen.getByTestId("host-mute").click();
      await screen.getByTestId("host-next").click();
      await expect(phase(screen, "reveal")).toBeVisible();
      await screen.getByTestId("host-next").click();
      await expect(screen.getByTestId("progress")).toHaveText("2 of 15");

      // Someone who joins now waits; revive brings everyone in.
      const late = await joinPhone(browser, code, "late", 4);
      await expect(late.getByTestId("title")).toHaveText("Next game");
      await screen.getByTestId("host-revive").click();
      await expect(late.getByTestId("question")).toBeVisible();

      // Another device with the room code has no key: it cannot host.
      const other = await browser.newContext();
      const stranger = await other.newPage();
      await stranger.goto(`${path}?room=${code}`);
      await expect(stranger.getByTestId("notice")).toContainText("hosted on another device");
      await stranger.keyboard.press("Escape");
      await stranger.keyboard.press("Escape");
      await expect(ace.getByTestId("question")).toBeVisible();
      await stranger.getByRole("button", { name: "New room" }).click();
      await expect(stranger.locator('.stage[data-room="live"]')).toBeVisible();
      expect(new URL(stranger.url()).search).not.toBe(`?room=${code}`);
      await other.close();
    });
  });
}

test("the host switches between the 3D arena and the 2D screen mid-game", async ({ browser }) => {
  const { page: screen, code } = await openProjector(browser, "/host");
  await expect(screen.locator("canvas.arena3d")).toBeVisible();
  await expect(screen.getByTestId("no-webgl")).toHaveCount(0);
  const ace = await joinPhone(browser, code, "ace", 0);
  await joinPhone(browser, code, "bob", 1);

  await screen.keyboard.press("s");
  await expect(phase(screen, "question")).toBeVisible();
  const text = await questionText(screen);
  const question = lookup(text);
  await ace.getByTestId(`zone-${question.correct}`).click();

  // Same room, same host key, other board: the game carries on.
  await screen.getByTestId("mode-2d").click();
  await expect(screen).toHaveURL((url) => url.pathname === "/host/2d" && url.search === `?room=${code}`);
  await expect(phase(screen, "question")).toBeVisible();
  await expect(screen.getByTestId("question")).toHaveText(text);
  await expect(screen.locator('[data-testid="token"][data-name="ace"]')).toHaveAttribute("data-spot", String(question.correct));

  await screen.keyboard.press("n");
  await expect(phase(screen, "reveal")).toBeVisible();
  await expect(ace.getByTestId("title")).toHaveText("Safe");
  // Hold the 6 second reveal, so it is still up after the page loads again.
  await screen.keyboard.press("p");
  await expect(screen.locator(".stage[data-paused]")).toBeVisible();

  await screen.getByTestId("mode-3d").click();
  await expect(screen).toHaveURL((url) => url.pathname === "/host" && url.search === `?room=${code}`);
  await expect(phase(screen, "reveal")).toBeVisible();
  await expect(screen.getByTestId("answer")).toHaveText(question.answers[question.correct]);
});
