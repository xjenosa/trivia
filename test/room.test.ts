// Room integration tests, run inside workerd: real sockets against the real
// Durable Object. Each test opens its own room.

import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CLOSE, CODE_PATTERN, LIVES, MAX_PLAYERS, ROOM_TTL_MS } from "../src/shared/config";
import type { StateMsg } from "../src/shared/protocol";
import { computerScience } from "../content/packs/computer-science";

type AnyMsg = Record<string, any>;

// The Room keeps its state private; these tests reach in on purpose.
const inRoom = runInDurableObject as unknown as (stub: unknown, fn: (room: any) => Promise<void>) => Promise<void>;

class Client {
  readonly msgs: AnyMsg[] = [];
  readonly raw: string[] = [];
  closed: number | null = null;

  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener("message", (event) => {
      const text = String(event.data);
      this.raw.push(text);
      this.msgs.push(JSON.parse(text));
    });
    ws.addEventListener("close", (event) => {
      this.closed = event.code;
    });
  }

  send(msg: AnyMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  get states(): StateMsg[] {
    return this.msgs.filter((m) => m.t === "state") as StateMsg[];
  }

  get state(): StateMsg {
    const last = this.states.at(-1);
    if (!last) throw new Error("no state yet");
    return last;
  }

  async until(done: (c: Client) => boolean, what = "condition"): Promise<this> {
    const end = Date.now() + 3000;
    const ready = () => {
      try {
        return done(this);
      } catch {
        return false; // nothing received yet
      }
    };
    while (!ready()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    return this;
  }

  untilPhase(phase: StateMsg["phase"], questionNumber?: number): Promise<this> {
    return this.until(
      (c) => c.states.length > 0 && c.state.phase === phase && (questionNumber === undefined || c.state.questionNumber === questionNumber),
      `phase ${phase} ${questionNumber ?? ""}`,
    );
  }
}

async function newRoom(): Promise<{ code: string; hostKey: string }> {
  const res = await exports.default.fetch("http://trivia.test/api/new");
  expect(res.status).toBe(200);
  return (await res.json()) as { code: string; hostKey: string };
}

async function connect(code: string, role: "player" | "screen", hostKey?: string): Promise<Client> {
  const params = new URLSearchParams({ code, role });
  if (hostKey !== undefined) params.set("hostKey", hostKey);
  const res = await exports.default.fetch(`http://trivia.test/api/ws?${params}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  return new Client(res.webSocket!);
}

const pidOf = (name: string) => `pid-${name}-0000`;

async function join(code: string, name: string, color = 0): Promise<Client> {
  const client = await connect(code, "player");
  client.send({ t: "join", pid: pidOf(name), name, color });
  await client.until((c) => c.states.some((s) => s.you?.pid === pidOf(name)), `${name} to join`);
  return client;
}

async function setup(names: string[]) {
  const { code, hostKey } = await newRoom();
  const screen = await connect(code, "screen", hostKey);
  const players: Client[] = [];
  for (const name of names) players.push(await join(code, name));
  await screen.until((c) => c.state.players.length === names.length, "everyone on the roster");
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return { code, hostKey, screen, players, stub };
}

function correctOf(state: StateMsg): number {
  const question = computerScience.questions.find((q) => q.text === state.question?.text);
  if (!question) throw new Error(`unknown question: ${state.question?.text}`);
  return question.correct;
}

const lives = (state: StateMsg, name: string) => state.players.find((p) => p.pid === pidOf(name))?.lives;
const playerOf = (state: StateMsg, name: string) => state.players.find((p) => p.pid === pidOf(name));

// Plays one question: each entry of `picks` is a zone, "right", "wrong" or null (no answer).
async function playQuestion(
  screen: Client,
  players: Client[],
  number: number,
  picks: Array<number | "right" | "wrong" | null>,
): Promise<StateMsg> {
  // The room drops anything over 20 messages a second per socket, the host's
  // included, so a scripted game has to leave a beat between questions.
  await new Promise((resolve) => setTimeout(resolve, 110));
  await screen.untilPhase("question", number);
  const correct = correctOf(screen.state);
  let expected = 0;
  for (const [i, pick] of picks.entries()) {
    const client = players[i]!;
    await client.untilPhase("question", number);
    if (pick === null) continue;
    const zone = pick === "right" ? correct : pick === "wrong" ? (correct + 1) % 4 : pick;
    client.send({ t: "pick", zone });
    await client.until((c) => c.state.you?.zone === zone, "the pick to land");
    if (client.state.players.find((p) => p.pid === client.state.you?.pid)?.status === "alive") expected += 1;
  }
  await screen.until((c) => c.state.players.filter((p) => p.answered).length === expected, "answers on the screen");
  screen.send({ t: "next" });
  await screen.untilPhase("reveal", number);
  for (const client of players) await client.untilPhase("reveal", number);
  return screen.state;
}

describe("rooms", () => {
  it("mints a four-character code and a host key", async () => {
    const a = await newRoom();
    const b = await newRoom();
    expect(a.code).toMatch(CODE_PATTERN);
    expect(a.hostKey.length).toBeGreaterThan(20);
    expect(b.code).not.toBe(a.code);
    expect(b.hostKey).not.toBe(a.hostKey);
  });

  it("refuses a room that does not exist", async () => {
    const client = await connect("ZZZZ", "player");
    await client.until((c) => c.closed !== null, "close");
    expect(client.closed).toBe(CLOSE.noRoom);
    expect(client.msgs).toHaveLength(0);
  });

  it("rejects malformed codes before reaching a room", async () => {
    const res = await exports.default.fetch("http://trivia.test/api/ws?code=ab&role=player", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(400);
    const plain = await exports.default.fetch("http://trivia.test/api/ws?code=ABCD&role=player");
    expect(plain.status).toBe(426);
  });
});

describe("a full scripted game", () => {
  it("plays 15 questions, keeps the answer secret until each reveal, and ends with a winner", async () => {
    const { screen, players } = await setup(["ace", "bob", "cy"]);
    const [ace, bob, cy] = players as [Client, Client, Client];
    screen.send({ t: "start" });

    const asked: string[] = [];
    for (let n = 1; n <= 15; n++) {
      // ace is always right. bob is always wrong, so he is out after question 3.
      // cy is wrong once, on question 1.
      const reveal = await playQuestion(screen, players, n, ["right", "wrong", n === 1 ? "wrong" : "right"]);
      asked.push(reveal.question!.text);

      expect(reveal.correct).toBe(correctOf(reveal));
      expect(reveal.floorHeld).toBe(false);
      expect(playerOf(reveal, "ace")).toMatchObject({ lives: 3, hit: false, zone: reveal.correct });
      expect(lives(reveal, "bob")).toBe(Math.max(0, LIVES - n));
      expect(playerOf(reveal, "bob")?.status).toBe(n >= 3 ? "out" : "alive");
      expect(lives(reveal, "cy")).toBe(2);

      // Phones are told what happened to them, ghosts what would have.
      expect(ace.state.you).toMatchObject({ result: "safe", zone: reveal.correct });
      expect(bob.state.you?.result).toBe("hit");
      if (n > 3) expect(playerOf(reveal, "bob")).toMatchObject({ zone: null, hit: false });

      screen.send({ t: "next" });
    }

    await screen.untilPhase("over");
    expect(screen.state.winners).toEqual([{ pid: pidOf("ace"), name: "ace", color: 0 }]);
    await cy.untilPhase("over");
    expect(cy.state.winners.map((w) => w.name)).toEqual(["ace"]);

    // The difficulty ramps: 5 easy, 5 medium, 5 hard, with no repeats.
    const tiers = asked.map((text) => computerScience.questions.find((q) => q.text === text)!.difficulty);
    expect(tiers).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect(new Set(asked).size).toBe(15);

    // INVARIANT: nothing sent before a reveal carries the answer or anyone's pick.
    for (const client of [screen, ...players]) {
      client.msgs.forEach((msg, i) => {
        if (msg.t !== "state" || msg.phase === "reveal" || msg.phase === "over") return;
        expect(client.raw[i]).not.toContain('"correct"');
        expect(client.raw[i]).not.toContain('"floorHeld"');
        expect(msg.players.every((p: AnyMsg) => !("zone" in p) && !("hit" in p))).toBe(true);
      });
    }
    // INVARIANT: phones never get positions. (That the screen does is asserted in
    // "tracks a dragged token"; here questions end before the 100 ms batch fires.)
    for (const client of players) expect(client.msgs.some((m) => m.t === "pos")).toBe(false);
    // A phone's own zone is the only zone it sees during a question.
    for (const client of players) {
      for (const msg of client.states) {
        if (msg.phase === "question" && msg.you) expect(Object.keys(msg.you).sort()).toEqual(["pid", "result", "zone"]);
      }
    }
  });

  it("holds the floor when everyone is wrong", async () => {
    const { screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    const reveal = await playQuestion(screen, players, 1, ["wrong", null]);
    expect(reveal.floorHeld).toBe(true);
    expect(reveal.players.map((p) => p.lives)).toEqual([LIVES, LIVES]);
    expect(reveal.players.some((p) => p.hit)).toBe(false);
    expect(players[0]!.state.you?.result).toBe("safe");
  });

  it("ends early when one player has lives left", async () => {
    const { screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    for (let n = 1; n <= 3; n++) {
      const reveal = await playQuestion(screen, players, n, ["right", "wrong"]);
      expect(lives(reveal, "bob")).toBe(LIVES - n);
      screen.send({ t: "next" });
    }
    await screen.untilPhase("over");
    expect(screen.state.questionNumber).toBe(3);
    expect(screen.state.winners.map((w) => w.name)).toEqual(["ace"]);
  });

  it("goes to sudden death on a tie and shares the win if it stays tied", async () => {
    const { screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    for (let n = 1; n <= 18; n++) {
      const reveal = await playQuestion(screen, players, n, ["right", "right"]);
      expect(reveal.suddenDeath).toBe(n > 15);
      if (n > 15) expect(reveal.players.map((p) => p.lives)).toEqual([1, 1]);
      screen.send({ t: "next" });
    }
    await screen.untilPhase("over");
    expect(screen.state.winners.map((w) => w.name).sort()).toEqual(["ace", "bob"]);
  });

  it("tells a ghost whether it would have survived, and takes one guess per question", async () => {
    const { screen, players } = await setup(["ace", "bob", "cy"]);
    const bob = players[1]!;
    screen.send({ t: "start" });
    for (let n = 1; n <= 3; n++) {
      await playQuestion(screen, players, n, ["right", "wrong", "right"]);
      screen.send({ t: "next" });
    }
    await bob.untilPhase("question", 4);
    expect(playerOf(bob.state, "bob")?.status).toBe("out");
    const correct = correctOf(bob.state);
    bob.send({ t: "pick", zone: correct });
    await bob.until((c) => c.state.you?.zone === correct, "ghost guess");
    bob.send({ t: "pick", zone: (correct + 1) % 4 }); // a second guess is ignored
    screen.send({ t: "next" });
    await bob.untilPhase("reveal", 4);
    expect(bob.state.you).toMatchObject({ zone: correct, result: "safe" });
    // The projector never shows a ghost's guess.
    expect(playerOf(screen.state, "bob")).toMatchObject({ zone: null, answered: false, lives: 0 });
  });
});

describe("host authority", () => {
  it("refuses a screen without the host key", async () => {
    const { code } = await newRoom();
    for (const key of [undefined, "", "not-the-key"]) {
      const screen = await connect(code, "screen", key);
      await screen.until((c) => c.closed !== null, "close");
      expect(screen.closed).toBe(CLOSE.badKey);
      expect(screen.msgs).toHaveLength(0);
    }
  });

  it("ignores host commands sent from a phone", async () => {
    const { code, screen, players } = await setup(["ace", "bob"]);
    const [ace] = players as [Client, Client];
    for (const t of ["start", "next", "pause", "revive", "reset"]) ace.send({ t });
    ace.send({ t: "kick", pid: pidOf("bob") });
    // A round trip through the room proves the commands above were processed first.
    const probe = await join(code, "probe");
    expect(probe.state.phase).toBe("lobby");
    expect(probe.state.players.map((p) => p.name)).toEqual(["ace", "bob", "probe"]);
    expect(screen.state.phase).toBe("lobby");
  });

  it("pauses and resumes the timer", async () => {
    const { screen, stub } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    await screen.untilPhase("question", 1);
    screen.send({ t: "pause" });
    await screen.until((c) => c.state.paused, "pause");
    const left = screen.state.deadline - screen.state.serverNow;
    expect(left).toBeGreaterThan(15_000);
    expect(left).toBeLessThanOrEqual(20_000);
    // While paused there is no phase alarm to fire.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    screen.send({ t: "pause" });
    await screen.until((c) => !c.state.paused, "resume");
    expect(screen.state.phase).toBe("question");
    expect(screen.state.deadline - screen.state.serverNow).toBeLessThanOrEqual(left + 5);
  });

  it("revives everyone, late joiners included", async () => {
    const { code, screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    await playQuestion(screen, players, 1, ["right", "wrong"]);
    const late = await join(code, "late");
    expect(playerOf(late.state, "late")?.status).toBe("waiting");
    screen.send({ t: "revive" });
    await screen.until((c) => c.state.players.every((p) => p.status === "alive" && p.lives === LIVES), "revive");
    expect(screen.state.players).toHaveLength(3);
  });

  it("returns to the lobby and keeps the last winner", async () => {
    const { screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    for (let n = 1; n <= 3; n++) {
      await playQuestion(screen, players, n, ["right", "wrong"]);
      screen.send({ t: "next" });
    }
    await screen.untilPhase("over");
    screen.send({ t: "reset" });
    await screen.untilPhase("lobby");
    expect(screen.state.winners.map((w) => w.name)).toEqual(["ace"]);
    expect(screen.state.players.every((p) => p.lives === LIVES && p.status === "alive")).toBe(true);
    expect(screen.state.question).toBeNull();
  });

  it("kicks a player and keeps them out", async () => {
    const { code, screen, players } = await setup(["ace", "bob"]);
    const bob = players[1]!;
    screen.send({ t: "kick", pid: pidOf("bob") });
    await bob.until((c) => c.closed !== null, "kick");
    expect(bob.closed).toBe(CLOSE.kicked);
    await screen.until((c) => c.state.players.length === 1, "roster update");
    expect(screen.state.players.map((p) => p.name)).toEqual(["ace"]);

    const again = await connect(code, "player");
    again.send({ t: "join", pid: pidOf("bob"), name: "bob", color: 0 });
    await again.until((c) => c.closed !== null, "second close");
    expect(again.closed).toBe(CLOSE.kicked);
    expect(screen.state.players).toHaveLength(1);
  });
});

describe("players", () => {
  it("makes a late joiner wait for the next game", async () => {
    const { code, screen, players } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    await screen.untilPhase("question", 1);
    const late = await join(code, "late");
    expect(playerOf(late.state, "late")?.status).toBe("waiting");
    late.send({ t: "pick", zone: correctOf(late.state) });
    const reveal = await playQuestion(screen, players, 1, ["right", "wrong"]);
    expect(playerOf(reveal, "late")).toMatchObject({ status: "waiting", zone: null, answered: false });
    screen.send({ t: "reset" });
    await late.untilPhase("lobby");
    expect(playerOf(late.state, "late")?.status).toBe("alive");
  });

  it("restores lives and status on reconnect", async () => {
    const { code, screen, players } = await setup(["ace", "bob"]);
    const bob = players[1]!;
    screen.send({ t: "start" });
    await playQuestion(screen, players, 1, ["right", "wrong"]);
    bob.ws.close(1000, "bye");

    const back = await connect(code, "player");
    back.send({ t: "join", pid: pidOf("bob"), name: "bobby", color: 5 });
    await back.until((c) => c.states.some((s) => s.you?.pid === pidOf("bob")), "rejoin");
    expect(playerOf(back.state, "bob")).toMatchObject({ lives: LIVES - 1, status: "alive", name: "bobby", color: 5 });
    expect(back.state.players).toHaveLength(2);
  });

  it("tracks a dragged token and treats the middle as no answer", async () => {
    const { screen, players } = await setup(["ace", "bob"]);
    const ace = players[0]!;
    screen.send({ t: "start" });
    await ace.untilPhase("question", 1);
    ace.send({ t: "move", x: 0.6, y: -0.6 });
    await ace.until((c) => c.state.you?.zone === 1, "zone from a drag");
    await screen.until((c) => c.msgs.some((m) => m.t === "pos"), "positions on the screen");
    const pos = screen.msgs.filter((m) => m.t === "pos").at(-1)!;
    expect(pos.p).toEqual([[0, 0.6, -0.6]]);
    ace.send({ t: "move", x: 0.02, y: 0.9 });
    await ace.until((c) => c.state.you?.zone === null, "dead zone");
    await screen.until((c) => playerOf(c.state, "ace")?.answered === false, "the answer to clear");
  });

  it("drops bad input silently", async () => {
    const { code, screen, players } = await setup(["ace"]);
    const ace = players[0]!;
    screen.send({ t: "start" });
    await ace.untilPhase("question", 1);
    ace.ws.send("not json");
    ace.ws.send(JSON.stringify(["an", "array"]));
    ace.ws.send("x".repeat(2000));
    ace.send({ t: "pick", zone: 7 });
    ace.send({ t: "pick", zone: "1" });
    ace.send({ t: "move", x: "left", y: 0 });
    ace.send({ t: "move", x: null, y: Number.NaN });
    ace.send({ t: "nonsense" });
    ace.send({ t: "move", x: 99, y: -99 }); // clamped to the corner, zone 1
    await ace.until((c) => c.state.you?.zone === 1, "the one valid message");
    expect(ace.closed).toBeNull();

    const odd = await connect(code, "player");
    odd.send({ t: "join", pid: "short", name: "x", color: 0 });
    odd.send({ t: "join", pid: pidOf("odd"), name: "  a\u0000very \u0007long name that goes on  ", color: 99 });
    await odd.until((c) => c.states.some((s) => s.you?.pid === pidOf("odd")), "join");
    expect(playerOf(odd.state, "odd")).toMatchObject({ name: "avery long name", color: 0 });
    expect(odd.state.players).toHaveLength(2);
  });

  it("caps each socket at 20 messages a second", async () => {
    const { players } = await setup(["ace"]);
    const ace = players[0]!;
    for (let i = 1; i <= 30; i++) ace.send({ t: "join", pid: pidOf("ace"), name: `n${i}`, color: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    ace.send({ t: "join", pid: pidOf("ace"), name: "ace", color: 1 });
    await ace.until((c) => playerOf(c.state, "ace")?.color === 1, "the window to reopen");
    const names = ace.states.map((s) => playerOf(s, "ace")?.name);
    // setup() already spent one message of the first second on the join.
    expect(names).toContain("n19");
    expect(names).not.toContain("n20");
    expect(names).not.toContain("n30");
  });

  it("caps a room at 40 players", async () => {
    const { code, screen } = await setup([]);
    const sockets: Client[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = await connect(code, "player");
      client.send({ t: "join", pid: pidOf(`p${i}`), name: `p${i}`, color: i % 8 });
      sockets.push(client);
    }
    await screen.until((c) => c.state.players.length === MAX_PLAYERS, "a full room");
    const extra = await connect(code, "player");
    extra.send({ t: "join", pid: pidOf("extra"), name: "extra", color: 0 });
    await extra.until((c) => c.closed !== null, "close");
    expect(extra.closed).toBe(CLOSE.full);
    expect(screen.state.players).toHaveLength(MAX_PLAYERS);
  });
});

describe("durability", () => {
  it("survives the object being evicted and rebuilt mid-question", async () => {
    const { screen, players, stub } = await setup(["ace", "bob"]);
    const [ace, bob] = players as [Client, Client];
    screen.send({ t: "start" });
    await playQuestion(screen, players, 1, ["right", "wrong"]);
    screen.send({ t: "next" });
    await screen.untilPhase("question", 2);
    const correct = correctOf(screen.state);
    ace.send({ t: "pick", zone: correct });
    bob.send({ t: "pick", zone: (correct + 1) % 4 });
    await screen.until((c) => c.state.players.every((p) => p.answered), "both answers");
    const before = screen.state;

    await evictDurableObject(stub);

    // Same sockets, new instance: state comes back from storage, answers included.
    screen.send({ t: "next" });
    await screen.untilPhase("reveal", 2);
    const reveal = screen.state;
    expect(reveal.question).toEqual(before.question);
    expect(reveal.correct).toBe(correct);
    expect(playerOf(reveal, "ace")).toMatchObject({ lives: LIVES, zone: correct, hit: false });
    expect(playerOf(reveal, "bob")).toMatchObject({ lives: LIVES - 2, zone: (correct + 1) % 4, hit: true });
    await bob.untilPhase("reveal", 2);
    expect(bob.state.you).toMatchObject({ pid: pidOf("bob"), result: "hit" });
  });

  it("advances phases from the alarm", async () => {
    const { screen, players, stub } = await setup(["ace", "bob"]);
    screen.send({ t: "start" });
    await screen.untilPhase("question", 1);
    players[0]!.send({ t: "pick", zone: correctOf(screen.state) });
    await screen.until((c) => c.state.players.some((p) => p.answered), "an answer");

    // An alarm that fires early changes nothing.
    await runDurableObjectAlarm(stub);
    expect(screen.state.phase).toBe("question");

    const expire = () =>
      inRoom(stub, async (room) => {
        room.s.deadline = Date.now() - 1;
        await room.alarm();
      });
    await expire();
    await screen.untilPhase("reveal", 1);
    expect(lives(screen.state, "bob")).toBe(LIVES - 1);
    await expire();
    await screen.untilPhase("question", 2);
  });

  it("deletes itself six hours after the last socket leaves", async () => {
    const { code, hostKey, screen, stub } = await setup([]);
    screen.ws.close(1000, "bye");
    await inRoom(stub, async (room) => {
      const end = Date.now() + 3000;
      while (room.s.emptySince === null && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 4));
      expect(room.s.emptySince).not.toBeNull();
      // Not yet: the room is only idle for a moment.
      await room.alarm();
      expect(room.s).not.toBeNull();
      room.s.emptySince = Date.now() - ROOM_TTL_MS - 1;
      await room.alarm();
      expect(room.s).toBeNull();
    });
    const gone = await connect(code, "screen", hostKey);
    await gone.until((c) => c.closed !== null, "close");
    expect(gone.closed).toBe(CLOSE.noRoom);
  });
});
