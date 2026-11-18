// Shared by the e2e spec and the screenshot run. Playwright's own browsers only.

import type { Browser, BrowserContext, Page } from "@playwright/test";

export const PHONE = { width: 390, height: 844 };
export const PROJECTOR = { width: 1600, height: 900 };

export async function openProjector(browser: Browser, path: "/host/2d" | "/host"): Promise<{ page: Page; code: string; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: PROJECTOR });
  const page = await context.newPage();
  await page.goto(path);
  // The page mints its own room; the code is only real once the room is live.
  await page.locator('.stage[data-room="live"]').waitFor({ timeout: 20_000 });
  const code = (await page.getByTestId("room-code").first().textContent())!.trim();
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error(`unexpected room code: ${code}`);
  return { page, code, context };
}

export async function joinPhone(browser: Browser, code: string, name: string, color: number): Promise<Page> {
  // Firefox has no mobile emulation, and its mouse input goes astray at 2x scale.
  const firefox = browser.browserType().name() === "firefox";
  const context = await browser.newContext(
    firefox ? { viewport: PHONE, hasTouch: true } : { viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  );
  const page = await context.newPage();
  await page.goto(`/?room=${code}`);
  await page.getByTestId("join-name").fill(name);
  await page.getByRole("radio", { name: `Color ${color + 1}` }).click();
  await page.getByTestId("join-button").click();
  await page.getByTestId("title").waitFor();
  return page;
}

// The room code is public; the answer is not. Tests look it up in the pack, the
// way a player who knows the answer would.
export async function questionText(page: Page): Promise<string> {
  return (await page.getByTestId("question").first().textContent())!.trim();
}
