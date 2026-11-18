// The landing page's gameplay video: `npm run video`.
// Needs `npm run build` (the pages are replayed from dist/client) and a running
// copy for the game itself (`npm run dev`, or TRIVIA_URL), and ffmpeg on the PATH.
//
// A live capture drops frames here (the 3D board renders in software), so this
// works in two passes:
//   1 record  One real game against the server, in real time: the host and five
//             players are plain sockets, maya is a real phone page. Every message
//             the room sends the host and maya is kept with its time.
//   2 replay  The projector and maya's phone are opened again with no server: their
//             sockets are answered from the recording, on a clock this script
//             moves one frame at a time (Playwright's clock for timers and Date,
//             the frame queue and animation stepper in CAPTURE for the rest), with
//             one screenshot per output frame. Nothing depends on how long a
//             frame takes to render.
// The game runs five questions; the video shows the lobby, question 1 and its
// reveal, then cuts to the last question and the winner, and fades back into the
// lobby so it loops.
//
// VIDEO_RECORD=file.json replays an earlier recording instead of playing a new game.
// VIDEO_WORK=dir keeps the frames there; by default they go with the run's temp folder.
// VIDEO_ENCODE=1, with a VIDEO_WORK that still holds frames, only encodes again.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { computerScience } from "../../content/packs/computer-science.ts";
import { chromium, runFolder } from "./tidy-browser.cjs";

const SERVER = process.env.TRIVIA_URL ?? "http://localhost:5173";
// The address the lobby and its QR code show. Pages are served to it from dist/.
const ORIGIN = "https://trivia.xjenosa.workers.dev";
const DIST = resolve("dist/client");
const OUT = resolve("public/video");
const WORK = process.env.VIDEO_WORK ? resolve(process.env.VIDEO_WORK) : join(runFolder, "video");
const FPS = 30;
const MAX_BYTES = 3_000_000;
const SMALL_MAX_BYTES = 1_000_000;

// The frame: projector and phone edge to edge on black. 923 + 24 + 333 = 1280.
const STAGE = { width: 1600, height: 900 }; // captured large, scaled down
const PHONE = { width: 390, height: 844 };
const LAYOUT = { stage: { x: 0, y: 100, w: 923, h: 519, r: 16 }, phone: { x: 947, y: 0, w: 333, h: 720, r: 40 } };

// The shoot, in seconds from the first frame. Record and replay share it.
const T = {
  pre: 0.5, // lobby before the first frame: the end of the video fades into it
  join: 0.7,
  others: [1.3, 1.8, 2.3, 2.8, 3.3],
  start: 4.0,
  picks: { dev_null: 5.2, kofi: 5.9, ana: 7.7, rin: 8.4, segfault: 9.3 },
  drag: [6.1, 7.3],
  next: 11.4,
  cut: 5.0, // of the first reveal, then the cut to the last question
  last: { rival: 1.1, tap: 1.9, next: 3.6, over: 3.2, hold: 5.0 },
  fade: 0.4,
};
const CAST = [
  ["maya", 2],
  ["dev_null", 5],
  ["ana", 7],
  ["kofi", 3],
  ["rin", 6],
  ["segfault", 1],
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const correctOf = (text) => {
  const q = computerScience.questions.find((item) => item.text === text.trim());
  if (!q) throw new Error(`unknown question: ${text}`);
  return q.correct;
};
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const MOBILE = { viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// Where maya's token is `k` of the way (0 to 1) from the middle of the zones box
// to its resting corner in `zone` (Answer.tsx REST_NEAR and REST_FAR), in page px.
function dragPoint(box, zone, k) {
  const cqw = PHONE.width / 100;
  const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const endX = zone % 2 === 1 ? box.width - 9.25 * cqw : box.width / 2 - 10.75 * cqw;
  const endY = zone >= 2 ? box.height - 9.25 * cqw : box.height / 2 - 10.75 * cqw;
  return {
    x: box.x + box.width / 2 + (endX - box.width / 2) * ease,
    y: box.y + box.height / 2 + (endY - box.height / 2) * ease,
  };
}
const boxOf = (page, testId) =>
  page.evaluate((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, testId);
const middle = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// ---------------------------------------------------------------- 1: record

async function record(browser) {
  console.log("record: one real game");
  const { code, hostKey } = await (await fetch(`${SERVER}/api/new`)).json();
  const wsUrl = (role, more = "") => `${SERVER.replace("http", "ws")}/api/ws?code=${code}&role=${role}${more}`;
  const opened = (ws) => new Promise((done) => ws.addEventListener("open", done, { once: true }));

  // The host: every message it gets is the projector's script.
  const hostLog = [];
  let latest = null;
  const host = new WebSocket(wsUrl("screen", `&hostKey=${hostKey}`));
  host.addEventListener("message", (event) => {
    const data = String(event.data);
    hostLog.push({ raw: performance.now(), data });
    const msg = JSON.parse(data);
    if (msg.t === "state") latest = msg;
  });
  await opened(host);
  const cmd = (t) => host.send(JSON.stringify({ t }));
  const state = async (what, test) => {
    const end = performance.now() + 20_000;
    while (!(latest && test(latest))) {
      if (performance.now() > end) throw new Error(`record: the room never reached ${what}`);
      await sleep(10);
    }
    return { raw: hostLog.at(-1).raw, state: latest };
  };
  const question = (n) => state(`question ${n}`, (s) => s.phase === "question" && s.questionNumber === n);
  const reveal = (n) => state(`reveal ${n}`, (s) => s.phase === "reveal" && s.questionNumber === n);

  // maya: a real phone page, so her messages are the phone's own.
  const context = await browser.newContext(MOBILE);
  const maya = await context.newPage();
  let mayaLog = [];
  maya.on("websocket", (socket) => {
    const log = [];
    mayaLog = log; // the dev server's StrictMode opens two; the last one is the live one
    socket.on("framereceived", (frame) => log.push({ raw: performance.now(), data: String(frame.payload) }));
  });
  await maya.goto(`${SERVER}/?room=${code}`);
  await maya.getByTestId("join-name").fill(CAST[0][0]);
  await maya.getByRole("radio", { name: `Color ${CAST[0][1] + 1}` }).click();
  const pid = await maya.evaluate(() => localStorage.getItem("trivia.pid"));
  const joinAt = middle(await boxOf(maya, "join-button"));

  const players = {};
  const join = async (name, color) => {
    const ws = new WebSocket(wsUrl("player"));
    await opened(ws);
    ws.send(JSON.stringify({ t: "join", pid: `video-${name}`.padEnd(12, "0"), name, color }));
    players[name] = { pick: (zone) => ws.send(JSON.stringify({ t: "pick", zone })), close: () => ws.close() };
  };

  const zero = performance.now() + 800;
  const until = (seconds) => sleep(Math.max(0, zero + seconds * 1000 - performance.now()));
  const stamp = (raw) => (raw - zero) / 1000;

  // Lobby.
  await until(T.join);
  await maya.mouse.click(joinAt.x, joinAt.y);
  for (const [i, [name, color]] of CAST.slice(1).entries()) {
    await until(T.others[i]);
    await join(name, color);
  }

  // Question 1: maya, dev_null and kofi are right; ana, rin and segfault are not.
  await until(T.start);
  cmd("start");
  const q1 = await question(1);
  const c1 = correctOf(q1.state.question.text);
  const zones = await boxOf(maya, "zones");
  const drag = (async () => {
    await until(T.drag[0]);
    const from = dragPoint(zones, c1, 0);
    await maya.mouse.move(from.x, from.y);
    await maya.mouse.down();
    for (;;) {
      const k = (stamp(performance.now()) - T.drag[0]) / (T.drag[1] - T.drag[0]);
      const at = dragPoint(zones, c1, Math.min(1, k));
      await maya.mouse.move(at.x, at.y);
      if (k >= 1) break;
      await sleep(30);
    }
    await maya.mouse.up();
  })();
  const others = (async () => {
    const order = Object.entries(T.picks).sort((a, b) => a[1] - b[1]);
    const zoneOf = { dev_null: c1, kofi: c1, ana: (c1 + 1) % 4, rin: (c1 + 2) % 4, segfault: (c1 + 1) % 4 };
    for (const [name, at] of order) {
      await until(at);
      players[name].pick(zoneOf[name]);
    }
  })();
  await Promise.all([drag, others]);
  await until(T.next);
  cmd("next");
  const r1 = await reveal(1);
  const cutAt = stamp(r1.raw) + T.cut;

  // Off camera: questions 2 to 4 leave kofi one life and everyone else but maya none.
  await sleep((T.cut + 0.2) * 1000);
  for (const n of [2, 3, 4]) {
    if (n > 2 || latest.phase === "reveal") cmd("next");
    const q = await question(n);
    const c = correctOf(q.state.question.text);
    await sleep(250);
    if (n === 2) {
      for (const name of ["ana", "kofi", "rin", "segfault"]) players[name].pick(c);
      players.dev_null.pick((c + 1) % 4);
    }
    await maya.getByTestId(`zone-${c}`).click();
    await sleep(350);
    cmd("next");
    await reveal(n);
    await sleep(n === 4 ? 5200 : 1500);
  }

  // The last question: kofi is wrong, maya is right.
  cmd("next");
  const q5 = await question(5);
  const lastAt = stamp(q5.raw);
  const c5 = correctOf(q5.state.question.text);
  await until(lastAt + T.last.rival);
  players.kofi.pick((c5 + 3) % 4);
  await until(lastAt + T.last.tap);
  const tapAt = middle(await boxOf(maya, `zone-${c5}`));
  await maya.mouse.click(tapAt.x, tapAt.y);
  await until(lastAt + T.last.next);
  cmd("next");
  await reveal(5);
  await until(lastAt + T.last.next + T.last.over);
  cmd("next");
  const over = await state("the winner", (s) => s.phase === "over");
  if (over.state.winners.map((w) => w.name).join() !== "maya") throw new Error("record: maya did not win");
  const endAt = stamp(over.raw) + T.last.hold;
  await until(endAt + 0.5);

  const stamped = (log) => log.map(({ raw, data }) => ({ at: stamp(raw), data }));
  const recording = { code, pid, c1, c5, cutAt, lastAt, endAt, host: stamped(hostLog), maya: stamped(mayaLog) };
  for (const p of Object.values(players)) p.close();
  host.close();
  await context.close();
  console.log(`  room ${code}: ${recording.host.length} messages to the host, ${recording.maya.length} to maya`);
  console.log(`  cut at ${cutAt.toFixed(2)} s, last question at ${lastAt.toFixed(2)} s, end at ${endAt.toFixed(2)} s`);
  return recording;
}

// ---------------------------------------------------------------- 2: replay

// Runs in the page. `begin` takes frames away from the browser: after it, queued
// animation frames run only when `frame` says so, once per output frame, and CSS
// animations and transitions move only by the frame's own length.
const CAPTURE = () => {
  const queue = [];
  let handle = 0;
  const seen = new WeakSet();
  // Lets React finish what a message or a timer started (its scheduler is a
  // MessageChannel, which no fake clock touches).
  const hop = () =>
    new Promise((done) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => done();
      channel.port2.postMessage(0);
    });
  window.__capture = {
    begin() {
      window.requestAnimationFrame = (callback) => {
        queue.push([++handle, callback]);
        return handle;
      };
      window.cancelAnimationFrame = (id) => {
        const at = queue.findIndex((entry) => entry[0] === id);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    async frame(ms) {
      await hop();
      await hop();
      const now = performance.now();
      for (const [, callback] of queue.splice(0)) callback(now);
      await hop();
      await hop();
      void document.documentElement.offsetHeight; // style is current: new transitions exist
      for (const animation of document.getAnimations()) {
        if (!seen.has(animation)) {
          seen.add(animation);
          animation.pause();
          animation.currentTime = 0;
          continue;
        }
        const next = Number(animation.currentTime ?? 0) + ms;
        const end = animation.effect?.getComputedTiming().endTime;
        if (typeof end === "number" && Number.isFinite(end) && next >= end) animation.finish();
        else animation.currentTime = next;
      }
    },
  };
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".png": "image/png",
};

async function open(browser, options, recording, role) {
  const context = await browser.newContext(options);
  await context.clock.install({ time: new Date("2026-11-17T20:00:00Z") });
  await context.addInitScript(CAPTURE);
  if (role === "player") await context.addInitScript((pid) => localStorage.setItem("trivia.pid", pid), recording.pid);

  await context.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/new") return route.fulfill({ json: { code: recording.code, hostKey: "replay" } });
    const file = join(DIST, path === "/" ? "index.html" : extname(path) ? path : `${path}.html`);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? "application/octet-stream" });
  });

  // The page's socket, answered from the recording. What the page sends is dropped.
  const link = { socket: null, sent: 0 };
  await context.routeWebSocket(/\/api\/ws/, (socket) => {
    link.socket = socket;
    link.sent = 0;
  });
  const log = role === "screen" ? recording.host : recording.maya;
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  ${role} page error:`, error.message));
  const cdp = await context.newCDPSession(page);
  return {
    page,
    context,
    // Everything recorded up to `t` that the page has not had yet.
    feed(t) {
      if (!link.socket) return;
      while (link.sent < log.length && log[link.sent].at <= t) link.socket.send(log[link.sent++].data);
    },
    async freeze() {
      // A few seconds ahead: the clock keeps running until the pause lands, and a
      // busy page can take a while to answer.
      await context.clock.pauseAt((await page.evaluate(() => Date.now())) + 5000);
      await page.evaluate(() => window.__capture.begin());
    },
    async tick(ms) {
      await context.clock.runFor(ms);
      await page.evaluate((length) => window.__capture.frame(length), ms);
    },
    async shot(file) {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(data, "base64"));
    },
  };
}

async function replay(browser, recording) {
  console.log("replay: frame by frame");
  const stage = await open(browser, { viewport: STAGE }, recording, "screen");
  const phone = await open(browser, MOBILE, recording, "player");

  const start = -T.pre;
  await stage.page.goto(`${ORIGIN}/host`);
  // The lobby as it stood before the first frame.
  for (let tries = 0; tries < 200; tries++) {
    stage.feed(start);
    if (await stage.page.locator('.stage[data-room="live"]').count()) break;
    await sleep(100);
  }
  await stage.page.locator('.stage[data-room="live"]').waitFor();
  await phone.page.goto(`${ORIGIN}/?room=${recording.code}`);
  await phone.page.getByTestId("join-name").fill(CAST[0][0]);
  await phone.page.getByRole("radio", { name: `Color ${CAST[0][1] + 1}` }).click();
  await phone.page.evaluate(() => document.activeElement?.blur());
  for (const { page } of [stage, phone]) await page.evaluate(() => document.fonts.ready);
  await sleep(3000); // the board's first frames and its canvas text
  const joinAt = middle(await boxOf(phone.page, "join-button"));
  await stage.freeze();
  await phone.freeze();

  // Segments of the video: [from, to) in recording seconds, and a folder each.
  const segments = [
    { name: "pre", from: start, to: 0 },
    { name: "a", from: 0, to: recording.cutAt },
    { name: "b", from: recording.lastAt, to: recording.endAt },
  ];
  for (const s of segments) mkdirSync(join(WORK, s.name), { recursive: true });
  const counts = { pre: 0, a: 0, b: 0 };

  let drag = "waiting";
  let zones = null;
  let joined = false;
  let tapped = false;
  const mouse = phone.page.mouse;
  // maya's hands, at the same moments as in the recorded game.
  const hands = async (t) => {
    if (!joined && t >= T.join) {
      joined = true;
      await mouse.click(joinAt.x, joinAt.y);
    }
    if (drag === "waiting" && t >= T.drag[0]) {
      drag = "on";
      zones = await boxOf(phone.page, "zones");
      const from = dragPoint(zones, recording.c1, 0);
      await mouse.move(from.x, from.y);
      await mouse.down();
    } else if (drag === "on") {
      const k = Math.min(1, (t - T.drag[0]) / (T.drag[1] - T.drag[0]));
      const at = dragPoint(zones, recording.c1, k);
      await mouse.move(at.x, at.y);
      if (k >= 1) {
        drag = "done";
        await mouse.up();
      }
    }
    if (!tapped && t >= recording.lastAt + T.last.tap) {
      tapped = true;
      const at = middle(await boxOf(phone.page, `zone-${recording.c5}`));
      await mouse.click(at.x, at.y);
    }
  };

  // VIDEO_UNTIL=seconds stops early, to look at the first frames without the full run.
  const stop = process.env.VIDEO_UNTIL ? Number(process.env.VIDEO_UNTIL) : recording.endAt;
  const frames = Math.round((stop - start) * FPS);
  const began = Date.now();
  let clock = 0;
  for (let f = 0; f < frames; f++) {
    const t = start + f / FPS;
    stage.feed(t);
    phone.feed(t);
    await hands(t);
    const until = Math.round(((f + 1) * 1000) / FPS);
    await Promise.all([stage.tick(until - clock), phone.tick(until - clock)]);
    clock = until;
    const segment = segments.find((s) => t >= s.from - 1e-6 && t < s.to - 1e-6);
    if (segment) {
      const n = String(counts[segment.name]++).padStart(5, "0");
      await Promise.all([
        stage.shot(join(WORK, segment.name, `stage-${n}.png`)),
        phone.shot(join(WORK, segment.name, `phone-${n}.png`)),
      ]);
    }
    if (f % 60 === 59) {
      const spent = (Date.now() - began) / 1000;
      console.log(`  ${(t + T.pre).toFixed(1)} of ${(recording.endAt + T.pre).toFixed(1)} s, ${Math.round(spent)} s in`);
    }
  }
  await stage.context.close();
  await phone.context.close();
  return counts;
}

// ---------------------------------------------------------------- 3: encode

// Black outside the two rounded frames, and a hairline round each.
async function mask(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const rect = ({ x, y, w, h, r }, inset = 0) =>
    `<rect x="${x + inset}" y="${y + inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${r - inset}"/>`;
  const hole = ({ x, y, w, h, r }) =>
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" style="display:block">
      <path fill="#000" fill-rule="evenodd" d="M0 0h1280v720H0z${hole(LAYOUT.stage)}${hole(LAYOUT.phone)}"/>
      <g fill="none" stroke="#fff" stroke-opacity=".13">${rect(LAYOUT.stage, 0.5)}${rect(LAYOUT.phone, 0.5)}</g>
    </svg></body>`,
  );
  await page.screenshot({ path: join(WORK, "mask.png"), omitBackground: true });
  await page.close();
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

function encode(counts) {
  console.log("encode");
  mkdirSync(OUT, { recursive: true });
  const { stage: s, phone: p } = LAYOUT;
  const inputs = [];
  const graph = [];
  for (const [i, name] of ["pre", "a", "b"].entries()) {
    inputs.push("-framerate", String(FPS), "-i", join(WORK, name, "stage-%05d.png"));
    inputs.push("-framerate", String(FPS), "-i", join(WORK, name, "phone-%05d.png"));
    graph.push(
      `[${i * 2}:v]scale=${s.w}:${s.h}:flags=lanczos,pad=1280:720:${s.x}:${s.y}:black[s${i}]`,
      `[${i * 2 + 1}:v]scale=${p.w}:${p.h}:flags=lanczos[p${i}]`,
      `[s${i}][p${i}]overlay=${p.x}:${p.y}:format=rgb[c${i}]`,
      `[c${i}][m${i}]overlay=0:0:format=rgb:shortest=1,fps=${FPS},settb=AVTB,format=gbrp[v${i}]`,
    );
  }
  inputs.push("-loop", "1", "-framerate", String(FPS), "-i", join(WORK, "mask.png"));
  graph.push("[6:v]split=3[m0][m1][m2]");
  // Reveal 1 fades into the last question; the winner fades into the lobby the
  // video opens on, so the last frame leads into the first.
  const a = counts.a / FPS;
  const b = counts.b / FPS;
  const pre = counts.pre / FPS;
  graph.push(
    `[v1][v2]xfade=transition=fade:duration=${T.fade}:offset=${(a - T.fade).toFixed(4)}[ab]`,
    `[ab][v0]xfade=transition=fade:duration=${pre}:offset=${(a + b - T.fade - pre).toFixed(4)}[rgb]`,
    `[rgb]scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos,format=yuv420p[out]`,
  );
  const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
  const master = join(WORK, "master.mp4");
  ffmpeg([...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "8", ...tags, "-an", master]);

  // The smallest quality loss that fits the size budget.
  const fit = (file, scale, budget) => {
    for (let crf = 17; crf <= 36; crf += 1) {
      ffmpeg([
        "-i", master,
        ...(scale ? ["-vf", `scale=${scale}:flags=lanczos`] : []),
        "-c:v", "libx264", "-preset", "veryslow", "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-profile:v", "high", ...tags, "-r", String(FPS), "-an", "-movflags", "+faststart", file,
      ]);
      const bytes = statSync(file).size;
      if (bytes <= budget) return console.log(`  ${file}: ${(bytes / 1e6).toFixed(2)} MB at crf ${crf}`);
    }
    throw new Error(`${file} does not fit ${budget} bytes`);
  };
  fit(join(OUT, "trivia-720.mp4"), null, MAX_BYTES);
  fit(join(OUT, "trivia-360.mp4"), "640:360", SMALL_MAX_BYTES);
  // Posters: the first frame, from the master so they are cleaner than the video.
  for (const [size, scale] of [["720", "1280:720"], ["360", "640:360"]]) {
    ffmpeg(["-i", master, "-frames:v", "1", "-vf", `scale=${scale}:flags=lanczos`, "-c:v", "libwebp", "-quality", "84", join(OUT, `trivia-${size}.webp`)]);
  }
}

// ---------------------------------------------------------------- run

if (!existsSync(join(DIST, "host.html"))) throw new Error("dist/client is missing: run `npm run build` first");
mkdirSync(WORK, { recursive: true });
const browser = await chromium.launch({ args: ARGS });
let counts;
if (process.env.VIDEO_ENCODE) {
  const held = (name) => readdirSync(join(WORK, name)).filter((file) => file.startsWith("stage-")).length;
  counts = { pre: held("pre"), a: held("a"), b: held("b") };
} else {
  let recording;
  if (process.env.VIDEO_RECORD && existsSync(process.env.VIDEO_RECORD)) {
    recording = JSON.parse(readFileSync(process.env.VIDEO_RECORD, "utf8"));
  } else {
    recording = await record(browser);
    if (process.env.VIDEO_RECORD) writeFileSync(process.env.VIDEO_RECORD, JSON.stringify(recording));
  }
  counts = await replay(browser, recording);
}
await mask(browser);
await browser.close();
if (process.env.VIDEO_UNTIL) console.log("stopped early: no video encoded");
else encode(counts);
if (!process.env.VIDEO_WORK) rmSync(WORK, { recursive: true, force: true });
console.log("done");
