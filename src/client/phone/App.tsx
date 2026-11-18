// Phone controller: join a room, then drag or tap your token onto an answer.
// It renders what the room sends and sends intents back; it decides nothing.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CLOSE, CODE_LENGTH, CODE_PATTERN, COLOR_COUNT, NAME_MAX } from "../../shared/config";
import type { PublicPlayer, StateMsg } from "../../shared/protocol";
import { Hearts, Token } from "../common/bits";
import { Icon } from "../common/icons";
import { openRoomSocket, type RoomSocket } from "../common/socket";
import { KEYS, store } from "../common/store";
import { Answer } from "./Answer";

// Its own chunk: a phone that scans the QR code never downloads the landing page.
const Landing = lazy(() => import("./Landing"));

interface Session {
  code: string;
  name: string;
  color: number;
}

// Identity survives reloads so a reconnect restores lives and status.
let memoryPid = "";
function getPid(): string {
  let pid = store.get(KEYS.pid) ?? memoryPid;
  if (!pid) {
    pid = crypto.randomUUID();
    memoryPid = pid;
    store.set(KEYS.pid, pid);
  }
  return pid;
}

const cleanCode = (raw: string | null) => (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
const roomInUrl = () => cleanCode(new URLSearchParams(location.search).get("room"));

function storedColor(): number {
  const raw = Number(store.get(KEYS.color));
  return Number.isInteger(raw) && raw >= 0 && raw < COLOR_COUNT ? raw : Math.floor(Math.random() * COLOR_COUNT);
}

const NOTES: Record<number, string> = {
  [CLOSE.noRoom]: "Room not found",
  [CLOSE.full]: "Room is full",
  [CLOSE.kicked]: "Removed by the host",
};

export function App() {
  const pid = useMemo(getPid, []);
  // The landing page puts a typed code in the URL, so Back returns to it.
  const [urlRoom, setUrlRoom] = useState(roomInUrl);
  useEffect(() => {
    const sync = () => setUrlRoom(roomInUrl());
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  const [session, setSession] = useState<Session | null>(() => {
    // A reload mid-game goes straight back in; a fresh scan shows the form.
    const room = store.get(KEYS.room);
    const name = store.get(KEYS.name);
    const sameRoom = room && (!urlRoom || urlRoom === room);
    if (store.get(KEYS.active) === "1" && sameRoom && name) return { code: room, name, color: storedColor() };
    return null;
  });
  const [state, setState] = useState<StateMsg | null>(null);
  const [online, setOnline] = useState(false);
  const [fatal, setFatal] = useState<number | null>(null);
  const socket = useRef<RoomSocket | null>(null);

  useEffect(() => {
    if (!session) return;
    const opened = openRoomSocket({
      code: session.code,
      role: "player",
      onOpen: (s) => s.send({ t: "join", pid, name: session.name, color: session.color }),
      onState: setState,
      onOnline: setOnline,
      onFatal: (code) => {
        store.remove(KEYS.active);
        setFatal(code);
        setSession(null);
        setState(null);
      },
    });
    socket.current = opened;
    return () => {
      opened.close();
      socket.current = null;
    };
  }, [session, pid]);

  const me = state?.you ? state.players.find((p) => p.pid === pid) : undefined;
  useWakeLock(Boolean(me) && state?.phase !== "lobby");

  // No room code, no game to rejoin and nothing to report: a visitor, not a player.
  if (!session && urlRoom === "" && fatal === null) {
    return (
      <Suspense fallback={null}>
        <Landing
          clean={cleanCode}
          onRoom={(code) => {
            history.pushState(null, "", `/?room=${code}`);
            setUrlRoom(code);
          }}
        />
      </Suspense>
    );
  }

  if (!session || !state || !me) {
    return (
      <Join
        key={urlRoom}
        urlRoom={urlRoom}
        note={fatal === null ? null : (NOTES[fatal] ?? null)}
        busy={session !== null}
        onJoin={(next) => {
          store.set(KEYS.room, next.code);
          store.set(KEYS.name, next.name);
          store.set(KEYS.color, String(next.color));
          store.set(KEYS.active, "1");
          setFatal(null);
          setSession(next);
        }}
      />
    );
  }

  return (
    <div className="phone">
      <main className="screen" data-phase={state.phase} data-status={me.status}>
        <header className="ph-top">
          <span className="who">
            <Token color={me.color} name={me.name} />
            <span>{me.name}</span>
          </span>
          <span className="side">
            {online ? null : <Icon name="wifi_slash" className="offline" />}
            <Hearts lives={me.status === "waiting" ? 0 : me.lives} />
          </span>
        </header>
        <Body state={state} me={me} send={(msg) => socket.current?.send(msg)} />
      </main>
    </div>
  );
}

function Body({ state, me, send }: { state: StateMsg; me: PublicPlayer; send: RoomSocket["send"] }) {
  const you = state.you!;
  if (state.phase === "lobby") return <Lobby state={state} me={me} />;
  if (state.phase === "over") return <Over state={state} me={me} />;
  if (me.status === "waiting") {
    return (
      <section className="result">
        <Token color={me.color} name={me.name} className="ghost" />
        <h1 className="lt" data-testid="title">
          Next game
        </h1>
        <Rows rows={[["Room", <b key="v">{state.code}</b>]]} />
      </section>
    );
  }
  if (state.phase === "question") return <Answer state={state} me={me} send={send} />;
  return <Result state={state} me={me} result={you.result} picked={you.zone} />;
}

// Answers are named by their text alone; the bracket is only the box's mark.
const label = (state: StateMsg, zone: number) => state.question?.answers[zone] ?? "";

function Rows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="cell">
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Lobby({ state, me }: { state: StateMsg; me: PublicPlayer }) {
  const winner = state.winners.map((w) => w.name).join(", ");
  const rows: Array<[string, React.ReactNode]> = [
    ["Room", <b key="v">{state.code}</b>],
    ["Players", <b key="v">{state.players.length}</b>],
  ];
  if (winner) rows.push(["Last winner", <b key="v">{winner}</b>]);
  return (
    <section className="result">
      <Token color={me.color} name={me.name} className="pop" />
      <h1 className="lt" data-testid="title">
        Ready
      </h1>
      <Rows rows={rows} />
    </section>
  );
}

// Safe and Lost a life share this layout, so nothing jumps between them.
function Result({
  state,
  me,
  result,
  picked,
}: {
  state: StateMsg;
  me: PublicPlayer;
  result: "safe" | "hit" | null;
  picked: number | null;
}) {
  const answer = state.correct === undefined ? "" : label(state, state.correct);
  const ghost = me.hit === false && me.status === "out";

  if (ghost && result === null) {
    return (
      <section className="result">
        <Token color={me.color} name={me.name} className="ghost" />
        <h1 className="lt" data-testid="title">
          Out
        </h1>
        <Rows rows={[["Answer", <b key="v">{answer}</b>]]} />
      </section>
    );
  }

  const safe = result === "safe";
  const title = ghost ? (safe ? "Right" : "Wrong") : safe ? "Safe" : me.status === "out" ? "Out" : "Lost a life";
  const rows: Array<[string, React.ReactNode]> = [["Answer", <b key="v">{answer}</b>]];
  if (!safe || state.floorHeld) rows.push(["You picked", picked === null ? "Nothing" : label(state, picked)]);
  return (
    <section className="result" style={{ "--c": safe ? "var(--color-right)" : "var(--color-wrong)" } as React.CSSProperties}>
      <div className={ghost ? "symbol quiet pop" : "symbol pop"} data-result={safe ? "safe" : "hit"}>
        <Icon name={safe ? "checkmark_circle_fill" : "xmark_circle_fill"} />
      </div>
      <h1 className="lt" data-testid="title">
        {title}
      </h1>
      <Rows rows={rows} />
    </section>
  );
}

function Over({ state, me }: { state: StateMsg; me: PublicPlayer }) {
  const won = state.winners.some((w) => w.pid === me.pid);
  const first = state.winners[0];
  return (
    <section className="result">
      {first ? <Token color={won ? me.color : first.color} name={won ? me.name : first.name} className="pop" /> : null}
      <h1 className="lt" data-testid="title">
        {won ? "You win" : "Game over"}
      </h1>
      {state.winners.length > 0 ? (
        <Rows rows={state.winners.map((w, i) => [i === 0 ? "Winner" : " ", <b key="v">{w.name}</b>] as [string, React.ReactNode])} />
      ) : null}
    </section>
  );
}

function Join({
  urlRoom,
  note,
  busy,
  onJoin,
}: {
  urlRoom: string;
  note: string | null;
  busy: boolean;
  onJoin(session: Session): void;
}) {
  const [code, setCode] = useState(() => urlRoom || cleanCode(store.get(KEYS.room)));
  const [name, setName] = useState(() => store.get(KEYS.name) ?? "");
  const [color, setColor] = useState(storedColor);
  // A code from the QR shows as a subtitle; it becomes a field if the room is gone.
  const fixedRoom = urlRoom !== "" && note === null;
  const ready = CODE_PATTERN.test(code) && name.trim() !== "" && !busy;

  return (
    <div className="phone">
      <form
        className="screen"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onJoin({ code, name: name.trim(), color });
        }}
      >
        <h1 className="lt">Trivia</h1>
        {fixedRoom ? <div className="ph-sub">{code}</div> : null}
        <div className="cell">
          {fixedRoom ? null : (
            <label className="row">
              <span className="k">Room</span>
              <input
                className="code"
                data-testid="join-room"
                value={code}
                onChange={(event) => setCode(cleanCode(event.target.value))}
                maxLength={CODE_LENGTH}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
              />
            </label>
          )}
          <label className="row">
            <span className="k">Name</span>
            <input
              data-testid="join-name"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
              maxLength={NAME_MAX}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </label>
        </div>
        {note ? (
          <p className="note" role="alert">
            {note}
          </p>
        ) : null}
        <div className="cell colors" role="radiogroup" aria-label="Color">
          {Array.from({ length: COLOR_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === color}
              aria-label={`Color ${i + 1}`}
              onClick={() => setColor(i)}
            >
              <Token color={i} />
            </button>
          ))}
        </div>
        <div className="preview">
          <Token color={color} name={name} />
        </div>
        <button className="cta" type="submit" disabled={!ready} data-testid="join-button">
          Join
        </button>
      </form>
    </div>
  );
}

// Keeps the screen awake during a game. Phones play no sound, on purpose.
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((held) => {
          if (cancelled) void held.release();
          else sentinel = held;
        })
        .catch(() => {
          // Denied (low battery, no gesture yet). The game still works.
        });
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release();
    };
  }, [active]);
}
