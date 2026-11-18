// The landing page: what `/` shows a visitor, and the three ways past it.
// INVARIANT: a room code in the URL, or a game to rejoin, never sees it.

import { expect, test } from "@playwright/test";
import { joinPhone, openProjector, PHONE } from "./helpers";

test("a visitor with no room code gets the landing page and its video", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trivia" })).toBeVisible();
  await expect(page.getByText("Live elimination trivia for in-person events.")).toBeVisible();
  await expect(page.getByTestId("join-name")).toHaveCount(0);

  const video = page.getByTestId("landing-video");
  await expect(video).toBeVisible();
  for (const attribute of ["src", "poster"] as const) {
    const url = await video.getAttribute(attribute);
    expect(url).toMatch(attribute === "src" ? /^\/video\/trivia-(720|360)\.mp4$/ : /^\/video\/trivia-(720|360)\.webp$/);
    const response = await request.get(url!);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(attribute === "src" ? "video/mp4" : "image/webp");
  }
  for (const attribute of ["muted", "loop", "playsInline", "autoplay"] as const) {
    expect(await video.evaluate((el, name) => (el as HTMLVideoElement)[name], attribute)).toBe(true);
  }
  // It plays by itself, at the laptop size.
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.3);
  expect(await video.evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBe(1280);
});

test("a phone gets the small video, and reduced motion gets a poster with a play button", async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const video = page.getByTestId("landing-video");
  await expect(video).toHaveAttribute("src", "/video/trivia-360.mp4");
  expect(await video.evaluate((el) => (el as HTMLVideoElement).autoplay)).toBe(false);
  expect(await video.evaluate((el) => (el as HTMLVideoElement).paused)).toBe(true);
  // One tap plays it and takes the button away; a tap on the video rests it again.
  await page.getByTestId("landing-play").click();
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.3);
  await expect(page.getByTestId("landing-play")).toHaveCount(0);
  await video.click();
  await expect(page.getByTestId("landing-play")).toBeVisible();
  await context.close();
});

test("Host a game reaches the projector", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("landing-host").click();
  await expect(page).toHaveURL(/\/host(\?room=[A-Z0-9]{4})?$/);
  await page.locator('.stage[data-room="live"]').waitFor({ timeout: 20_000 });
});

test("a typed room code leads to the join form, and Back returns", async ({ page }) => {
  await page.goto("/");
  const go = page.getByTestId("landing-join");
  await expect(go).toBeDisabled();
  await page.getByTestId("landing-room").fill("ab2");
  await expect(go).toBeDisabled();
  await page.getByTestId("landing-room").fill("ab2c");
  await expect(page.getByTestId("landing-room")).toHaveValue("AB2C");
  await go.click();
  await expect(page).toHaveURL(/\/\?room=AB2C$/);
  await expect(page.getByTestId("join-name")).toBeVisible();
  await expect(page.getByTestId("landing-video")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("landing-video")).toBeVisible();
});

test("a room code in the URL goes straight to the join form", async ({ page }) => {
  await page.goto("/?room=AB2C");
  await expect(page.getByTestId("join-name")).toBeVisible();
  await expect(page.getByTestId("landing-video")).toHaveCount(0);
});

test("a returning player rejoins from `/` without seeing the landing page", async ({ browser }) => {
  const { code, context } = await openProjector(browser, "/host/2d");
  const phone = await joinPhone(browser, code, "maya", 2);
  await expect(phone.getByTestId("title")).toHaveText("Ready");
  // No room code in the URL: the saved session alone brings the player back.
  await phone.goto("/");
  await expect(phone.getByTestId("title")).toHaveText("Ready");
  await expect(phone.getByTestId("landing-video")).toHaveCount(0);
  await phone.context().close();
  await context.close();
});
