// Screenshots of every screen, for the Apple-look review: `npm run shots`.
// Needs `npm run dev` running. Uses Playwright's own Chromium, never a system browser.
// Usage: node test/e2e/shots.mjs [phone] [screen] [arena] [landing]   (default: all four)
//        node test/e2e/shots.mjs crowd      30 players on both boards
//        node test/e2e/shots.mjs settings   reduced transparency, more contrast, reduced motion
// SHOTS_QUICK=1 stops a projector run after the first question, for look tuning.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "./tidy-browser.cjs";
import { computerScience } from "../../content/packs/computer-science.ts";

const BASE = process.env.TRIVIA_URL ?? "http://localhost:5173";
// SHOTS_BROWSER=webkit (or firefox) shoots the frosted-glass tier into its own folder.
const ENGINE = process.env.SHOTS_BROWSER ?? "chromium";
const OUT = ENGINE === "chromium" ? "screenshots" : `screenshots/${ENGINE}`;
const PHONE = { width: 390, height: 844 };
const PROJECTOR = { width: 1600, height: 900 };
const want = process.argv.slice(2);
const wants = (name) => want.length === 0 || want.includes(name);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const correctOf = (text) => {
  const q = computerScience.questions.find((item) => item.text === text.trim());
  if (!q) throw new Error(`unknown question: ${text}`);
  return q.correct;
};

const browser =
  ENGINE === "chromium"
    ? await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] })
    : await { firefox, webkit }[ENGINE].launch();

async function phone(code, name, color) {
  const mobile = ENGINE === "firefox" ? {} : { deviceScaleFactor: 2, isMobile: true };
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true, ...mobile });
  const page = await context.newPage();
  await page.goto(`${BASE}/?room=${code}`);
  await page.getByTestId("join-name").fill(name);
  await page.getByRole("radio", { name: `Color ${color + 1}` }).click();
  return page;
}

const shot = async (page, name) => {
  await sleep(700); // let springs settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png`);
};

// ---- phones, driven by a scripted host over a plain socket
if (wants("phone")) {
  console.log("phone");
  const { code, hostKey } = await (await fetch(`${BASE}/api/new`)).json();
  const host = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?code=${code}&role=screen&hostKey=${hostKey}`);
  await new Promise((resolve) => host.addEventListener("open", resolve, { once: true }));
  const cmd = (t) => host.send(JSON.stringify({ t }));

  const maya = await phone(code, "maya", 2);
  await shot(maya, "phone-1-join");
  await maya.getByTestId("join-button").click();
  const kofi = await phone(code, "kofi", 3);
  await kofi.getByTestId("join-button").click();
  const ana = await phone(code, "ana", 7);
  await ana.getByTestId("join-button").click();
  await maya.getByTestId("title").waitFor();
  await shot(maya, "phone-2-lobby");

  cmd("start");
  await maya.getByTestId("question").waitFor();
  await shot(maya, "phone-3-question");
  const correct = correctOf(await maya.getByTestId("question").textContent());
  const wrong = (correct + 1) % 4;
  await maya.getByTestId(`zone-${correct}`).click();
  await kofi.getByTestId(`zone-${wrong}`).click();
  await shot(maya, "phone-4-answered");

  // A drag, caught mid-air.
  const box = await ana.getByTestId("zones").boundingBox();
  const me = await ana.getByTestId("me").boundingBox();
  await ana.mouse.move(me.x + me.width / 2, me.y + me.height / 2);
  await ana.mouse.down();
  await ana.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.3, { steps: 8 });
  await shot(ana, "phone-5-dragging");
  await ana.mouse.up();

  cmd("next");
  await maya.getByTestId("title").waitFor();
  await shot(maya, "phone-6-safe");
  await shot(kofi, "phone-7-lost-a-life");

  // Late joiner waits for the next game.
  const late = await phone(code, "rin", 6);
  await late.getByTestId("join-button").click();
  await late.getByTestId("title").waitFor();
  await shot(late, "phone-8-next-game");

  // kofi runs out of lives, then guesses along as a ghost.
  for (let round = 0; round < 2; round++) {
    cmd("next");
    await kofi.getByTestId("question").waitFor();
    await sleep(150);
    const right = correctOf(await kofi.getByTestId("question").textContent());
    await maya.getByTestId(`zone-${right}`).click();
    await ana.getByTestId(`zone-${right}`).click();
    await kofi.getByTestId(`zone-${(right + 1) % 4}`).click();
    await sleep(150);
    cmd("next");
    await kofi.getByTestId("title").waitFor();
  }
  await shot(kofi, "phone-9-out");
  cmd("next");
  await kofi.getByTestId("question").waitFor();
  await sleep(150);
  const right = correctOf(await kofi.getByTestId("question").textContent());
  await kofi.getByTestId(`zone-${right}`).click();
  await shot(kofi, "phone-10-ghost-guess");
  await maya.getByTestId(`zone-${right}`).click();
  cmd("next");
  await kofi.getByTestId("title").waitFor();
  await shot(kofi, "phone-11-ghost-right");

  // ana drops out too, which leaves maya the winner.
  for (let round = 0; round < 8; round++) {
    cmd("next");
    const over = await Promise.race([
      maya.getByTestId("question").waitFor().then(() => false),
      maya.locator('[data-phase="over"]').waitFor().then(() => true),
    ]);
    if (over) break;
    await sleep(150);
    const answer = correctOf(await maya.getByTestId("question").textContent());
    await maya.getByTestId(`zone-${answer}`).click();
    await sleep(150);
    cmd("next");
    await maya.getByTestId("title").waitFor();
  }
  await maya.locator('[data-phase="over"]').waitFor();
  await shot(maya, "phone-12-winner");
  await shot(ana, "phone-13-game-over");
  host.close();
}

// ---- a projector page, hosted from its own keyboard, with six phones
async function projector(path, prefix) {
  console.log(prefix);
  const context = await browser.newContext({ viewport: PROJECTOR });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("  page error:", error.message));
  await page.goto(BASE + path);
  await page.locator('.stage[data-room="live"]').waitFor();
  const code = (await page.getByTestId("room-code").first().textContent()).trim();
  await shot(page, `${prefix}-1-lobby-empty`);

  const cast = [["maya", 2], ["dev_null", 5], ["ana", 7], ["kofi", 3], ["rin", 6], ["segfault", 1]];
  const phones = [];
  for (const [name, color] of cast) {
    const p = await phone(code, name, color);
    await p.getByTestId("join-button").click();
    await p.getByTestId("title").waitFor();
    phones.push(p);
    await sleep(250);
  }
  await sleep(1500);
  await shot(page, `${prefix}-2-lobby`);

  await page.keyboard.press("s");
  await page.locator('.stage[data-phase="question"]').waitFor();
  await sleep(1200);
  await shot(page, `${prefix}-3-question`);

  // Answers land one by one: most are right, two are wrong, one never answers.
  const answer = async (picks) => {
    const correct = correctOf(await page.getByTestId("question").textContent());
    for (const [i, pick] of picks.entries()) {
      if (pick === null) continue;
      await phones[i].getByTestId(`zone-${pick === "right" ? correct : (correct + pick) % 4}`).click();
      await sleep(120);
    }
  };
  await answer(["right", "right", 1, "right", 2, null]);
  await sleep(1600);
  await shot(page, `${prefix}-4-answered`);
  if (process.env.SHOTS_QUICK) {
    for (const p of phones) await p.context().close();
    return context.close();
  }

  await page.keyboard.press("n");
  await page.locator('.stage[data-phase="reveal"]').waitFor();
  // The reveal plays in beats; these two are caught without the usual settle time.
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${prefix}-5-reveal.png` });
  console.log(`  ${prefix}-5-reveal.png`);
  await sleep(850);
  await page.screenshot({ path: `${OUT}/${prefix}-6-drop.png` });
  console.log(`  ${prefix}-6-drop.png`);
  await page.getByTestId("alive").filter({ hasText: "left" }).and(page.locator(":not(.hide)")).waitFor();
  await sleep(600);
  await shot(page, `${prefix}-7-respawn`);

  // Paused, mid-question.
  await page.keyboard.press("n");
  await page.locator('.stage[data-phase="question"]').waitFor();
  await answer(["right", 1, "right", "right", "right", "right"]);
  await page.keyboard.press("p");
  await sleep(900);
  await shot(page, `${prefix}-8-paused`);
  await page.keyboard.press("p");

  // Play on until maya is the last one with lives.
  for (let round = 0; round < 14; round++) {
    if ((await page.locator(".stage").getAttribute("data-phase")) === "over") break;
    if ((await page.locator(".stage").getAttribute("data-phase")) === "question") {
      await answer(["right", null, null, null, null, null]);
      await sleep(200);
    }
    await page.keyboard.press("n");
    await sleep(350);
  }
  await page.locator('.stage[data-phase="over"]').waitFor();
  await sleep(900);
  await shot(page, `${prefix}-9-winner`);

  await page.keyboard.press("Escape");
  await page.locator('.stage[data-phase="lobby"]').waitFor();
  await shot(page, `${prefix}-10-lobby-after`);

  // A projector without the host key.
  const other = await browser.newContext({ viewport: PROJECTOR });
  const stranger = await other.newPage();
  await stranger.goto(`${BASE}${path}?room=${code}`);
  await stranger.getByTestId("notice").and(stranger.locator(":not(.hide)")).waitFor();
  await shot(stranger, `${prefix}-11-hosted-elsewhere`);
  await other.close();
  for (const p of phones) await p.context().close();
  await context.close();
}
if (wants("screen")) await projector("/host/2d", "screen");
if (wants("arena")) await projector("/host", "arena");

// ---- a crowd: 30 players over plain sockets, to check the layouts under load
async function crowd(path, prefix) {
  console.log(`${prefix} crowd`);
  const context = await browser.newContext({ viewport: PROJECTOR });
  const page = await context.newPage();
  await page.goto(BASE + path);
  await page.locator('.stage[data-room="live"]').waitFor();
  const code = (await page.getByTestId("room-code").first().textContent()).trim();
  const names = ["maya", "dev_null", "ana", "kofi", "rin", "segfault", "ada", "linus", "grace", "alan", "margaret", "dennis", "ken", "barbara", "tim", "guido", "bjarne", "yukihiro", "brendan", "anders", "radia", "donald", "edsger", "john", "katherine", "hedy", "vint", "sophie", "niklaus", "fran"];
  const sockets = [];
  for (const [i, name] of names.entries()) {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?code=${code}&role=player`);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    ws.send(JSON.stringify({ t: "join", pid: `crowd-pid-${String(i).padStart(4, "0")}`, name, color: i % 8 }));
    sockets.push(ws);
    await sleep(40);
  }
  await sleep(2500);
  await shot(page, `${prefix}-12-crowd-lobby`);
  await page.keyboard.press("s");
  await page.locator('.stage[data-phase="question"]').waitFor();
  await sleep(1800);
  await shot(page, `${prefix}-13-crowd-question`);
  // Two thirds answer, spread unevenly across the platforms.
  for (const [i, ws] of sockets.entries()) {
    if (i % 3 === 2) continue;
    ws.send(JSON.stringify({ t: "pick", zone: i % 5 === 0 ? 0 : i % 4 === 1 ? 2 : i % 2 ? 1 : 3 }));
    await sleep(30);
  }
  await sleep(2200);
  await shot(page, `${prefix}-14-crowd-answered`);
  for (const ws of sockets) ws.close();
  await context.close();
}
if (want.includes("crowd")) {
  await crowd("/host/2d", "screen");
  await crowd("/host", "arena");
}

// ---- system settings the look has to respect (Chromium only: set over CDP)
async function settings(name, features, playwrightMedia) {
  const context = await browser.newContext({ viewport: PROJECTOR });
  const page = await context.newPage();
  if (playwrightMedia) await page.emulateMedia(playwrightMedia);
  if (features.length) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features });
  }
  await page.goto(BASE + "/host");
  await page.locator('.stage[data-room="live"]').waitFor();
  const code = (await page.getByTestId("room-code").first().textContent()).trim();
  const sockets = [];
  for (const [i, who] of ["maya", "kofi", "ana", "rin"].entries()) {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?code=${code}&role=player`);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    ws.send(JSON.stringify({ t: "join", pid: `settings-pid-${i}`, name: who, color: i * 2 }));
    sockets.push(ws);
  }
  await sleep(1200);
  await page.keyboard.press("s");
  await page.locator('.stage[data-phase="question"]').waitFor();
  sockets.forEach((ws, i) => ws.send(JSON.stringify({ t: "pick", zone: i % 4 })));
  await sleep(2500);
  await shot(page, name);
  for (const ws of sockets) ws.close();
  await context.close();
}
if (want.includes("settings")) {
  console.log("settings");
  await settings("arena-15-reduced-transparency", [{ name: "prefers-reduced-transparency", value: "reduce" }]);
  await settings("arena-16-more-contrast", [{ name: "prefers-contrast", value: "more" }]);
  await settings("arena-17-reduced-motion", [], { reducedMotion: "reduce" });
}

// ---- the landing page: what `/` shows a visitor with no room code
if (wants("landing")) {
  console.log("landing");
  const LAPTOP = { width: 1440, height: 900 };
  const mobile = ENGINE === "firefox" ? {} : { deviceScaleFactor: 2, isMobile: true };
  const open = async (viewport, extra = {}) => {
    const context = await browser.newContext({ viewport, ...extra });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.getByTestId("landing-video").waitFor();
    await page.waitForLoadState("networkidle"); // the poster
    return page;
  };
  const land = async (name, viewport, extra, code) => {
    const page = await open(viewport, extra);
    if (code) await page.getByTestId("landing-room").fill(code);
    await shot(page, name);
    await page.context().close();
  };
  await land("landing-1-laptop", LAPTOP);
  await land("landing-2-phone", PHONE, { hasTouch: true, ...mobile });
  await land("landing-3-laptop-code", LAPTOP, {}, "vgjw");
  await land("landing-4-phone-code", PHONE, { hasTouch: true, ...mobile }, "vgjw");
  await land("landing-5-phone-reduced-motion", PHONE, { hasTouch: true, ...mobile, reducedMotion: "reduce" });
  await land("landing-6-laptop-small", { width: 1280, height: 720 });
  await land("landing-7-phone-small", { width: 375, height: 667 }, { hasTouch: true, ...mobile });
}

// ---- contact sheets: every shot of a kind on one image, for a quick look
async function sheet(prefix, columns, width) {
  const files = readdirSync(OUT)
    .filter((f) => f.startsWith(prefix + "-") && f.endsWith(".png"))
    .sort((a, b) => parseInt(a.slice(prefix.length + 1)) - parseInt(b.slice(prefix.length + 1)));
  if (files.length === 0) return;
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const cells = files.map((f) => `<figure><img src="${f}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`).join("");
  // A real file, so the images load from the same folder.
  const html = resolve(OUT, "sheet.html");
  writeFileSync(
    html,
    `<style>body{margin:0;padding:16px;background:#111;color:#999;font:12px sans-serif;display:grid;gap:14px;grid-template-columns:repeat(${columns},1fr)}figure{margin:0}img{width:100%;display:block;border-radius:6px}figcaption{padding-top:4px}</style>${cells}`,
  );
  await page.goto(pathToFileURL(html).href);
  await page.waitForLoadState("load");
  await sleep(300);
  await page.screenshot({ path: `${OUT}/sheet-${prefix}.png`, fullPage: true });
  await page.close();
  console.log(`  sheet-${prefix}.png`);
}
await sheet("phone", 7, 1900);
await sheet("screen", 3, 1900);
await sheet("arena", 3, 1900);
await sheet("landing", 4, 1900);

rmSync(resolve(OUT, "sheet.html"), { force: true });
await browser.close();
console.log("done");
