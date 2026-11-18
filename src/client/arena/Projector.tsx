// The projector shell, shared by /host (3D) and /host/2d (2D): the room link,
// host controls, and the glass chrome. Each page supplies only its board.
// Host controls live here and nowhere else: there is no separate host screen.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import qrcode from "qrcode-generator";
import type { PublicPlayer, StateMsg } from "../../shared/protocol";
import { Ring, Token, useTimeLeft } from "../common/bits";
import { cn } from "../common/cn";
import { Icon } from "../common/icons";
import { KEYS, store } from "../common/store";
import { Glass, GlassPanel } from "../ui/glass";
import { HostDock, type DockItem } from "../ui/host-dock";
import { Confetti } from "./Confetti";
import { DROP_MS, RESPAWN_MS, type Positions, type RevealStage } from "./layout";
import { useRoom, type RoomStatus } from "./useRoom";
import { Ticker, useSound } from "./useSound";

export interface BoardProps {
  state: StateMsg | null;
  positions: Positions;
  tick: number;
  stage: RevealStage;
}

const KEYMAP: Record<string, string> = {
  s: "start",
  n: "next",
  " ": "next",
  p: "pause",
  r: "revive",
  escape: "lobby",
  m: "mute",
  f: "full",
};

const ARM_MS = 2500;

export function Projector({ Board, mode }: { Board: ComponentType<BoardProps>; mode: "3d" | "2d" }) {
  const room = useRoom();
  const { state, send } = room;
  const stageEl = useRef<HTMLDivElement>(null);
  const unit = useStageUnit(stageEl);
  const stage = useRevealStage(state);
  const [muted, setMuted] = useState(() => store.get(KEYS.muted) === "1");
  const { sound, audio } = useSound(state, stage, muted);
  // Leaving a running game takes two presses, so a stray Esc cannot end it.
  const [armed, setArmed] = useState(false);

  const phase = state?.phase ?? "lobby";
  const inGame = phase === "question" || phase === "reveal";

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => setArmed(false), [phase]);

  const act = useCallback(
    (id: string) => {
      switch (id) {
        case "start":
          return send({ t: "start" });
        case "next":
          return send({ t: "next" });
        case "pause":
          return send({ t: "pause" });
        case "revive":
          return send({ t: "revive" });
        case "lobby":
          if (inGame && !armed) return setArmed(true);
          setArmed(false);
          return send({ t: "reset" });
        case "mute":
          return setMuted((was) => {
            store.set(KEYS.muted, was ? "0" : "1");
            return !was;
          });
        case "full":
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen().catch(() => undefined);
          return;
      }
    },
    [send, inGame, armed],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Leave browser shortcuts alone (Ctrl+R must still reload).
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const id = KEYMAP[event.key.toLowerCase()];
      if (!id) return;
      event.preventDefault();
      act(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  const items: DockItem[] = [
    { id: "start", label: "Start", icon: "play_fill", hotkey: "S", lit: phase === "lobby" || phase === "over", disabled: !state || state.players.length === 0 },
    { id: "next", label: "Next", icon: "forward_end_fill", hotkey: "N" },
    { id: "pause", label: state?.paused ? "Resume" : "Pause", icon: "pause_fill", hotkey: "P", lit: state?.paused === true },
    { id: "revive", label: "Revive everyone", icon: "heart_fill", hotkey: "R" },
    { id: "lobby", label: "Back to the lobby", icon: "house_fill", hotkey: "Esc", lit: armed },
    { id: "mute", label: muted ? "Unmute" : "Mute", icon: muted ? "speaker_slash_fill" : "speaker_2_fill", hotkey: "M" },
    { id: "full", label: "Full screen", icon: "arrow_up_left_arrow_down_right", hotkey: "F" },
  ];

  const alive = state ? state.players.filter((p) => p.status === "alive").length : 0;
  const count = state ? (state.suddenDeath ? "Sudden death" : `${state.questionNumber} of ${state.questionCount}`) : "";

  return (
    <div className="fit">
      <div
        className="stage"
        ref={stageEl}
        data-phase={phase}
        data-room={room.status}
        data-paused={state?.paused ? "" : undefined}
        data-muted={muted ? "" : undefined}
        data-audio={audio}
      >
        <Ticker state={state} sound={sound} />
        <Board state={state} positions={room.positions} tick={room.tick} stage={stage} />
        <div className="ov">
          <header className="hud">
            <span className="title">Trivia</span>
            <span className="hud-side">
              {room.status === "live" && !room.online ? <Icon name="wifi_slash" className="offline" /> : null}
              <ModeSwitch mode={mode} code={room.code} />
              <Glass className={cn("pill", phase === "lobby" && "hide")} data-testid="progress">
                {count}
              </Glass>
            </span>
          </header>

          <QuestionCard state={state} />
          <WinnerCard state={state} />
          <LobbyPanel state={state} code={room.code} onKick={(pid) => send({ t: "kick", pid })} />

          {/* The code steps aside at the reveal so the status pill keeps the glass budget. */}
          <Glass className={cn("corner left pill", (phase === "lobby" || phase === "reveal" || !state) && "hide")}>{room.code}</Glass>
          <Glass className={cn("corner right pill", !(phase === "reveal" && stage === 2) && "hide")} data-testid="alive">
            {alive} left
          </Glass>

          <Notice status={room.status} onNewRoom={room.newRoom} />
          <HostDock items={items} unit={unit} onAction={act} />
        </div>
        <Confetti run={phase === "over" && (state?.winners.length ?? 0) > 0} />
      </div>
    </div>
  );
}

// The same room on the other board: 3D for show, 2D for a weak venue laptop. The
// host key is in localStorage, so the switch works mid-game.
function ModeSwitch({ mode, code }: { mode: "3d" | "2d"; code: string }) {
  const query = code ? `?room=${code}` : "";
  return (
    <nav className="seg" aria-label="Board">
      <a href={`/host${query}`} aria-current={mode === "3d" ? "page" : undefined} data-testid="mode-3d">
        3D
      </a>
      <a href={`/host/2d${query}`} aria-current={mode === "2d" ? "page" : undefined} data-testid="mode-2d">
        2D
      </a>
    </nav>
  );
}

// 1% of the stage width, in px: the dock's fisheye math needs it.
function useStageUnit(ref: React.RefObject<HTMLDivElement | null>): number {
  const [unit, setUnit] = useState(16);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setUnit(el.clientWidth / 100));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return unit;
}

function useRevealStage(state: StateMsg | null): RevealStage {
  const key = state?.phase === "reveal" ? state.questionNumber : -1;
  const [stage, setStage] = useState<RevealStage>(0);
  useEffect(() => {
    setStage(0);
    if (key < 0) return;
    const drop = setTimeout(() => setStage(1), DROP_MS);
    const respawn = setTimeout(() => setStage(2), RESPAWN_MS);
    return () => {
      clearTimeout(drop);
      clearTimeout(respawn);
    };
  }, [key]);
  return key < 0 ? 0 : stage;
}

function QuestionCard({ state }: { state: StateMsg | null }) {
  const { seconds, fraction } = useTimeLeft(state);
  // Keep the last question on screen while the card fades out.
  const last = useRef<StateMsg | null>(null);
  const show = state !== null && (state.phase === "question" || state.phase === "reveal") && state.question !== null;
  if (show) last.current = state;
  const shown = last.current;
  const text = shown?.question?.text ?? "";
  const correct = show && state.phase === "reveal" ? state.correct : undefined;
  const size = text.length <= 30 ? "l" : text.length <= 60 ? "m" : "s";

  return (
    <GlassPanel className={cn("qcard", !show && "hide")} bodyClassName="qcard-body">
      <div className={cn("qtext", correct !== undefined && "answered")} data-size={size}>
        <div className="qline" data-testid="question">
          {text}
        </div>
        {correct !== undefined ? (
          <div className="ans-line" data-testid="answer">
            {shown?.question?.answers[correct]}
          </div>
        ) : null}
      </div>
      <div className="qside">
        {correct !== undefined ? (
          <span className="check">
            <Icon name="checkmark_circle_fill" />
          </span>
        ) : (
          <Ring seconds={seconds} fraction={fraction} paused={state?.paused} />
        )}
      </div>
    </GlassPanel>
  );
}

function WinnerCard({ state }: { state: StateMsg | null }) {
  const show = state?.phase === "over";
  const last = useRef<StateMsg["winners"]>([]);
  if (show) last.current = state.winners;
  const winners = last.current;
  return (
    <GlassPanel className={cn("wcard", !show && "hide")} bodyClassName="wcard-body" data-testid="winner">
      {winners.length > 0 ? (
        <div className="faces">
          {winners.slice(0, 6).map((w) => (
            <Token key={w.pid} color={w.color} name={w.name} />
          ))}
        </div>
      ) : null}
      <div className="who">
        <span className="caption">{winners.length === 0 ? "Game over" : winners.length === 1 ? "Winner" : "Winners"}</span>
        {winners.length > 0 ? <span className="names">{winners.map((w) => w.name).join(", ")}</span> : null}
      </div>
    </GlassPanel>
  );
}

function LobbyPanel({ state, code, onKick }: { state: StateMsg | null; code: string; onKick(pid: string): void }) {
  const show = state?.phase === "lobby";
  const players = state?.players ?? [];
  const url = `${location.origin}/?room=${code}`;
  const last = state?.winners ?? [];
  return (
    <GlassPanel className={cn("lobby", !show && "hide", players.length > 6 && "busy")} bodyClassName="lobby-body">
      <QrCode value={url} />
      <span className="code" data-testid="room-code">
        {code}
      </span>
      <span className="where">{location.host}</span>
      <span className="joined" data-testid="joined">
        {players.length} joined
      </span>
      <Roster players={players} onKick={onKick} />
      {last.length > 0 ? (
        <span className="last">
          Last winner <b>{last.map((w) => w.name).join(", ")}</b>
        </span>
      ) : null}
    </GlassPanel>
  );
}

// Click a name to arm it, click again to remove that player for the session.
function Roster({ players, onKick }: { players: PublicPlayer[]; onKick(pid: string): void }) {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <div className="roster" data-testid="roster">
      {players.map((p) => (
        <button
          key={p.pid}
          type="button"
          className={cn("chip", armed === p.pid && "armed")}
          aria-label={armed === p.pid ? `Confirm removing ${p.name}` : `Remove ${p.name}`}
          onClick={() => {
            if (armed !== p.pid) return setArmed(p.pid);
            setArmed(null);
            onKick(p.pid);
          }}
        >
          {armed === p.pid ? <Icon name="xmark_circle_fill" /> : <Token color={p.color} name={p.name} />}
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}

function QrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d, size: n + 4 };
  }, [value]);
  return (
    <div className="qr">
      <svg viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code to join">
        <path className="qr-dark" d={path.d} />
      </svg>
    </div>
  );
}

const NOTICES: Partial<Record<RoomStatus, { title: string; action: string }>> = {
  elsewhere: { title: "This room is hosted on another device", action: "New room" },
  gone: { title: "This room has ended", action: "New room" },
  failed: { title: "No connection", action: "Try again" },
};

function Notice({ status, onNewRoom }: { status: RoomStatus; onNewRoom(): void }) {
  const notice = NOTICES[status];
  return (
    <GlassPanel className={cn("notice", !notice && "hide")} bodyClassName="notice-body" data-testid="notice">
      {notice ? (
        <>
          <h2>{notice.title}</h2>
          <button type="button" onClick={onNewRoom}>
            {notice.action}
          </button>
        </>
      ) : null}
    </GlassPanel>
  );
}
