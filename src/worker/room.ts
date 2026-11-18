// The Room Durable Object: the only authority on a game's state.
//
// INVARIANTS (also in CLAUDE.md; test/room.test.ts asserts them):
// - Clients only render. Every rule runs here, through src/shared/rules.ts.
// - The correct answer never leaves this object before the reveal (see snapshot()).
// - Phones never get other players' picks or positions during a question.
// - Host commands are honored only on sockets that connected with the host key.
// - Every incoming message is validated and clamped; bad input is dropped silently.
//
// COST GUARDRAILS:
// - Sockets use the Hibernation API, so an idle room bills nothing. Per-socket facts
//   live in the socket attachment; everything else is reloaded from storage.
// - Phase timers are alarms (setTimeout dies with hibernation). The one setTimeout
//   left is the 100 ms position batch, which is fine to lose.
// - State is persisted on every change except raw positions.

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  COLOR_COUNT,
  GAME_QUESTIONS,
  LIVES,
  MAX_PLAYERS,
  MOVES_PER_QUESTION,
  MSG_MAX_CHARS,
  MSG_PER_SEC,
  PID_PATTERN,
  POS_BATCH_MS,
  QUESTION_MS,
  REVEAL_MS,
  ROOM_TTL_MS,
} from "../shared/config";
import type { Phase, PosTuple, PublicPlayer, StateMsg, Status, Winner, You } from "../shared/protocol";
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
} from "../shared/rules";
import { DEFAULT_PACK, getPack, getQuestion } from "../../content/packs";

interface StoredPlayer {
  pid: string;
  name: string;
  color: number;
  lives: number;
  status: Status;
  zone: number | null; // this question's answer, for a player in the round
  ghostZone: number | null; // an out player's one guess per question
  inRound: boolean; // was alive when this question began
  hit: boolean; // lost a life at this reveal
  moves: number;
}

interface RoomState {
  code: string;
  hostKey: string;
  packId: string;
  phase: Phase;
  paused: boolean;
  remaining: number; // ms left on the timer while paused
  deadline: number;
  questionNumber: number;
  questionCount: number;
  suddenDeath: boolean;
  suddenDeathAsked: number;
  queue: string[]; // this game's question ids; the current one is queue[questionNumber - 1]
  asked: string[]; // every id this room has asked, so games do not repeat
  floorHeld: boolean;
  players: StoredPlayer[];
  blocked: string[]; // kicked pids, for the session
  winners: Winner[];
  startedCount: number;
  emptySince: number | null; // when the last socket left; null while anyone is connected
}

type Attachment = { role: "screen" } | { role: "player"; pid: string | null };

const STORAGE_KEY = "room";
const BLOCKED_MAX = 200;

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null; // null until /api/new claims this code
  // In memory only: raw positions are never persisted (zones are).
  private pos = new Map<string, [number, number]>();
  private dirty = new Set<string>();
  private posTimer: ReturnType<typeof setTimeout> | null = null;
  private rate = new WeakMap<WebSocket, { since: number; count: number }>();
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null;
    });
  }

  // ---- RPC from the Worker

  // Claims this code for a new room. Null when the code is already in use.
  async claim(code: string): Promise<string | null> {
    if (this.s) return null;
    this.s = {
      code,
      hostKey: crypto.randomUUID(),
      packId: DEFAULT_PACK,
      phase: "lobby",
      paused: false,
      remaining: 0,
      deadline: 0,
      questionNumber: 0,
      questionCount: GAME_QUESTIONS,
      suddenDeath: false,
      suddenDeathAsked: 0,
      queue: [],
      asked: [],
      floorHeld: false,
      players: [],
      blocked: [],
      winners: [],
      startedCount: 0,
      emptySince: Date.now(),
    };
    await this.commit();
    return this.s.hostKey;
  }

  // ---- sockets

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "screen" ? "screen" : "player";
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const s = this.s;

    // Refusals still upgrade, then close with a code the page can read.
    const refuse = (code: number, reason: string) => {
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!s) return refuse(CLOSE.noRoom, "no room");
    if (role === "screen" && url.searchParams.get("hostKey") !== s.hostKey) return refuse(CLOSE.badKey, "bad host key");

    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = role === "screen" ? { role } : { role, pid: null };
    server.serializeAttachment(attachment);
    if (s.emptySince !== null) {
      s.emptySince = null;
      await this.commit();
    }
    server.send(JSON.stringify(this.snapshot()));
    if (role === "screen") this.sendAllPositions(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.s || typeof raw !== "string" || raw.length > MSG_MAX_CHARS) return;
    if (!this.withinRate(ws)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const msg = parsed as Record<string, unknown>;
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    if (attachment.role === "screen") return this.onHost(msg);

    if (msg.t === "join") return this.join(ws, msg);
    const player = attachment.pid ? this.player(attachment.pid) : undefined;
    if (!player) return;
    if (msg.t === "move") return this.move(player, msg);
    if (msg.t === "pick") return this.pick(player, msg);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed, or a code that cannot be echoed (1005, 1006).
    }
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  private async socketGone(ws: WebSocket): Promise<void> {
    const s = this.s;
    if (!s) return;
    if (this.ctx.getWebSockets().some((other) => other !== ws)) return;
    s.emptySince = Date.now();
    await this.commit();
  }

  private withinRate(ws: WebSocket): boolean {
    const now = Date.now();
    let window = this.rate.get(ws);
    if (!window || now - window.since >= 1000) {
      window = { since: now, count: 0 };
      this.rate.set(ws, window);
    }
    window.count += 1;
    return window.count <= MSG_PER_SEC;
  }

  // ---- timers

  async alarm(): Promise<void> {
    this.alarmAt = null;
    const s = this.s;
    if (!s) return;
    const now = Date.now();

    if (s.emptySince !== null && now >= s.emptySince + ROOM_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.s = null;
      return;
    }
    if (!s.paused && now >= s.deadline) {
      if (s.phase === "question") return this.closeQuestion();
      if (s.phase === "reveal") return this.advance();
    }
    await this.schedule();
  }

  // One alarm serves both the phase timer and the six-hour cleanup.
  private async schedule(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const times: number[] = [];
    if ((s.phase === "question" || s.phase === "reveal") && !s.paused) times.push(s.deadline);
    if (s.emptySince !== null) times.push(s.emptySince + ROOM_TTL_MS);
    const at = times.length ? Math.min(...times) : null;
    if (at === this.alarmAt) return;
    this.alarmAt = at;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private async commit(): Promise<void> {
    if (!this.s) return;
    await this.ctx.storage.put(STORAGE_KEY, this.s);
    await this.schedule();
  }

  // ---- players

  private player(pid: string): StoredPlayer | undefined {
    return this.s?.players.find((p) => p.pid === pid);
  }

  private async join(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const s = this.s!;
    const pid = msg.pid;
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return;
    if (s.blocked.includes(pid)) {
      ws.close(CLOSE.kicked, "kicked");
      return;
    }
    const name = sanitizeName(msg.name);
    const color =
      typeof msg.color === "number" && Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLOR_COUNT
        ? msg.color
        : 0;

    const existing = this.player(pid);
    if (existing) {
      // A reconnect: lives and status are kept.
      existing.name = name;
      existing.color = color;
    } else {
      if (s.players.length >= MAX_PLAYERS) {
        ws.close(CLOSE.full, "full");
        return;
      }
      s.players.push({
        pid,
        name,
        color,
        lives: LIVES,
        // Anyone arriving mid-game waits for the next one.
        status: s.phase === "lobby" ? "alive" : "waiting",
        zone: null,
        ghostZone: null,
        inRound: false,
        hit: false,
        moves: 0,
      });
    }
    const attachment: Attachment = { role: "player", pid };
    ws.serializeAttachment(attachment);
    await this.commit();
    this.broadcast();
  }

  private async move(player: StoredPlayer, msg: Record<string, unknown>): Promise<void> {
    if (this.s!.phase !== "question" || !player.inRound || player.status !== "alive") return;
    const x = clampUnit(msg.x);
    const y = clampUnit(msg.y);
    if (x === null || y === null) return;
    player.moves += 1;
    if (player.moves > MOVES_PER_QUESTION * 2) return;
    await this.place(player, x, y, zoneFromPosition(x, y));
  }

  private async pick(player: StoredPlayer, msg: Record<string, unknown>): Promise<void> {
    if (this.s!.phase !== "question" || !isZone(msg.zone)) return;
    if (player.inRound && player.status === "alive") {
      const [x, y] = zoneCenter(msg.zone);
      await this.place(player, x, y, msg.zone);
      return;
    }
    // A ghost gets one guess per question; it never counts.
    if (player.status === "out" && player.ghostZone === null) {
      player.ghostZone = msg.zone;
      await this.commit();
      this.sendTo(player.pid);
    }
  }

  private async place(player: StoredPlayer, x: number, y: number, zone: number | null): Promise<void> {
    this.pos.set(player.pid, [x, y]);
    this.dirty.add(player.pid);
    this.pumpPositions();
    if (zone === player.zone) return;
    const hadAnswer = player.zone !== null;
    player.zone = zone;
    await this.commit();
    // Everyone learns that someone answered; only the player learns what.
    if (hadAnswer !== (zone !== null)) this.broadcast();
    else this.sendTo(player.pid);
  }

  // ---- host commands

  private async onHost(msg: Record<string, unknown>): Promise<void> {
    switch (msg.t) {
      case "start":
        return this.start();
      case "next":
        if (this.s!.phase === "question") return this.closeQuestion();
        if (this.s!.phase === "reveal") return this.advance();
        return;
      case "pause":
        return this.pause();
      case "revive":
        return this.revive();
      case "reset":
        return this.reset();
      case "kick":
        return this.kick(msg.pid);
    }
  }

  private async start(): Promise<void> {
    const s = this.s!;
    if ((s.phase !== "lobby" && s.phase !== "over") || s.players.length === 0) return;
    const draw = drawGame(getPack(s.packId).questions, s.asked);
    if (draw.ids.length === 0) return;
    s.queue = draw.ids;
    s.asked = draw.asked;
    s.questionCount = draw.ids.length;
    s.questionNumber = 0;
    s.suddenDeath = false;
    s.suddenDeathAsked = 0;
    for (const p of s.players) {
      p.lives = LIVES;
      p.status = "alive";
    }
    s.startedCount = s.players.length;
    await this.beginQuestion();
  }

  private async beginQuestion(): Promise<void> {
    const s = this.s!;
    s.questionNumber += 1;
    if (s.suddenDeath) s.suddenDeathAsked += 1;
    s.phase = "question";
    s.paused = false;
    s.remaining = 0;
    s.deadline = Date.now() + QUESTION_MS;
    s.floorHeld = false;
    for (const p of s.players) {
      p.zone = null;
      p.ghostZone = null;
      p.hit = false;
      p.moves = 0;
      p.inRound = p.status === "alive";
    }
    this.pos.clear();
    this.dirty.clear();
    await this.commit();
    this.broadcast();
  }

  private async closeQuestion(): Promise<void> {
    const s = this.s!;
    if (s.phase !== "question") return;
    const question = this.currentQuestion();
    if (!question) return this.finish([]);
    const { floorHeld, hits } = resolveQuestion(s.players, question.correct);
    const hit = new Set(hits);
    s.players = applyHits(s.players, hits).map((p) => ({ ...p, hit: hit.has(p.pid) }));
    s.floorHeld = floorHeld;
    s.phase = "reveal";
    s.paused = false;
    s.remaining = 0;
    s.deadline = Date.now() + REVEAL_MS;
    await this.commit();
    this.broadcast();
  }

  private async advance(): Promise<void> {
    const s = this.s!;
    if (s.phase !== "reveal") return;
    const outcome = nextStep(s.players, {
      questionNumber: s.questionNumber,
      questionCount: s.questionCount,
      suddenDeath: s.suddenDeath,
      suddenDeathAsked: s.suddenDeathAsked,
      startedCount: s.startedCount,
    });
    if (outcome.kind === "over") return this.finish(outcome.winners);
    if (outcome.kind === "suddenDeath") {
      s.suddenDeath = true;
      s.suddenDeathAsked = 0;
      s.players = enterSuddenDeath(s.players, outcome.contenders);
    }
    if (s.questionNumber >= s.queue.length) {
      // Past the planned questions: sudden death draws hard ones, one at a time.
      const draw = drawTier(getPack(s.packId).questions, 3, 1, s.asked);
      if (draw.ids.length === 0) {
        return this.finish(s.players.filter((p) => p.status === "alive").map((p) => p.pid));
      }
      s.queue.push(...draw.ids);
      s.asked = draw.asked;
    }
    await this.beginQuestion();
  }

  private async finish(winnerPids: readonly string[]): Promise<void> {
    const s = this.s!;
    s.phase = "over";
    s.paused = false;
    s.remaining = 0;
    s.deadline = 0;
    s.winners = winnerPids.flatMap((pid) => {
      const p = this.player(pid);
      return p ? [{ pid: p.pid, name: p.name, color: p.color }] : [];
    });
    await this.commit();
    this.broadcast();
  }

  private async pause(): Promise<void> {
    const s = this.s!;
    if (s.phase !== "question" && s.phase !== "reveal") return;
    const now = Date.now();
    if (s.paused) {
      s.paused = false;
      s.deadline = now + s.remaining;
      s.remaining = 0;
    } else {
      s.paused = true;
      s.remaining = Math.max(0, s.deadline - now);
    }
    await this.commit();
    this.broadcast();
  }

  // Everyone back to full lives, late joiners included.
  private async revive(): Promise<void> {
    const s = this.s!;
    if (s.phase !== "question" && s.phase !== "reveal") return;
    for (const p of s.players) {
      p.lives = LIVES;
      p.status = "alive";
      p.ghostZone = null;
      if (s.phase === "question" && !p.inRound) {
        p.inRound = true;
        p.zone = null;
      }
    }
    s.suddenDeath = false;
    s.suddenDeathAsked = 0;
    s.startedCount = s.players.length;
    await this.commit();
    this.broadcast();
  }

  private async reset(): Promise<void> {
    const s = this.s!;
    s.phase = "lobby";
    s.paused = false;
    s.remaining = 0;
    s.deadline = 0;
    s.questionNumber = 0;
    s.suddenDeath = false;
    s.suddenDeathAsked = 0;
    s.queue = [];
    s.floorHeld = false;
    for (const p of s.players) {
      p.lives = LIVES;
      p.status = "alive";
      p.zone = null;
      p.ghostZone = null;
      p.inRound = false;
      p.hit = false;
    }
    this.pos.clear();
    this.dirty.clear();
    await this.commit();
    this.broadcast();
  }

  private async kick(pid: unknown): Promise<void> {
    const s = this.s!;
    if (typeof pid !== "string") return;
    const index = s.players.findIndex((p) => p.pid === pid);
    if (index < 0) return;
    s.players.splice(index, 1);
    if (!s.blocked.includes(pid)) s.blocked = [...s.blocked, pid].slice(-BLOCKED_MAX);
    this.pos.delete(pid);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment?.role === "player" && attachment.pid === pid) ws.close(CLOSE.kicked, "kicked");
    }
    await this.commit();
    this.broadcast();
  }

  // ---- outgoing

  private currentQuestion() {
    const s = this.s!;
    const id = s.queue[s.questionNumber - 1];
    return id ? getQuestion(id) : undefined;
  }

  // The one place a snapshot is built. `correct`, `floorHeld` and every `zone`
  // are added only once the phase is reveal or over.
  private snapshot(): StateMsg {
    const s = this.s!;
    const now = Date.now();
    const revealed = s.phase === "reveal" || s.phase === "over";
    const timed = s.phase === "question" || s.phase === "reveal";
    const question = timed ? this.currentQuestion() : undefined;

    const msg: StateMsg = {
      t: "state",
      code: s.code,
      phase: s.phase,
      paused: s.paused,
      questionNumber: s.questionNumber,
      questionCount: s.questionCount,
      suddenDeath: s.suddenDeath,
      deadline: timed ? (s.paused ? now + s.remaining : s.deadline) : 0,
      serverNow: now,
      question: question ? { text: question.text, answers: question.answers } : null,
      players: s.players.map((p) => {
        const pub: PublicPlayer = {
          pid: p.pid,
          name: p.name,
          color: p.color,
          lives: p.lives,
          status: p.status,
          answered: p.inRound && p.zone !== null,
        };
        if (revealed) {
          pub.zone = p.inRound ? p.zone : null;
          pub.hit = p.hit;
        }
        return pub;
      }),
      winners: s.winners,
    };
    if (revealed && question) {
      msg.correct = question.correct;
      msg.floorHeld = s.floorHeld;
    }
    return msg;
  }

  private you(pid: string): You | undefined {
    const s = this.s!;
    const p = this.player(pid);
    if (!p) return undefined;
    let result: You["result"] = null;
    if (s.phase === "reveal") {
      if (p.inRound) {
        result = p.hit ? "hit" : "safe";
      } else if (p.status === "out" && p.ghostZone !== null) {
        const correct = this.currentQuestion()?.correct;
        result = p.ghostZone === correct || s.floorHeld ? "safe" : "hit";
      }
    }
    return { pid: p.pid, zone: p.inRound ? p.zone : p.ghostZone, result };
  }

  private send(ws: WebSocket, base: StateMsg, text: string): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    try {
      const you = attachment?.role === "player" && attachment.pid ? this.you(attachment.pid) : undefined;
      ws.send(you ? JSON.stringify({ ...base, you }) : text);
    } catch {
      // A socket that is closing; its close handler cleans up.
    }
  }

  private broadcast(): void {
    const base = this.snapshot();
    const text = JSON.stringify(base);
    for (const ws of this.ctx.getWebSockets()) this.send(ws, base, text);
  }

  private sendTo(pid: string): void {
    const base = this.snapshot();
    const text = JSON.stringify(base);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment?.role === "player" && attachment.pid === pid) this.send(ws, base, text);
    }
  }

  // ---- positions (screens only)

  private tuples(only?: Set<string>): PosTuple[] {
    const out: PosTuple[] = [];
    this.s!.players.forEach((p, index) => {
      if (only && !only.has(p.pid)) return;
      if (!p.inRound) return;
      // After a hibernation the raw position is gone; the persisted zone stands in.
      const xy = this.pos.get(p.pid) ?? (p.zone !== null ? zoneCenter(p.zone) : undefined);
      if (xy) out.push([index, Math.round(xy[0] * 1000) / 1000, Math.round(xy[1] * 1000) / 1000]);
    });
    return out;
  }

  private sendAllPositions(ws: WebSocket): void {
    if (this.s!.phase !== "question") return;
    const p = this.tuples();
    if (p.length) ws.send(JSON.stringify({ t: "pos", p }));
  }

  private pumpPositions(): void {
    if (this.posTimer) return;
    this.posTimer = setTimeout(() => {
      this.posTimer = null;
      const s = this.s;
      if (!s || s.phase !== "question" || this.dirty.size === 0) {
        this.dirty.clear();
        return;
      }
      const text = JSON.stringify({ t: "pos", p: this.tuples(this.dirty) });
      this.dirty.clear();
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Attachment | null;
        if (attachment?.role !== "screen") continue;
        try {
          ws.send(text);
        } catch {
          // Closing socket.
        }
      }
    }, POS_BATCH_MS);
  }
}
