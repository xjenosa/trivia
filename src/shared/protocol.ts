// Wire messages, JSON, discriminated on `t`. The Room Durable Object is the only
// authority: pages send intents and render the snapshots they get back.

export type Phase = "lobby" | "question" | "reveal" | "over";
export type Status = "alive" | "out" | "waiting";

// ---- player to server
export type JoinMsg = { t: "join"; pid: string; name: string; color: number };
export type MoveMsg = { t: "move"; x: number; y: number };
export type PickMsg = { t: "pick"; zone: number };
export type PlayerMsg = JoinMsg | MoveMsg | PickMsg;

// ---- screen to server (honored only on sockets that connected with the host key)
export type HostMsg =
  | { t: "start" }
  | { t: "next" }
  | { t: "pause" }
  | { t: "revive" }
  | { t: "reset" }
  | { t: "kick"; pid: string };
export type HostCommand = HostMsg["t"];

// ---- server to everyone
export interface PublicPlayer {
  pid: string;
  name: string;
  color: number;
  lives: number;
  status: Status;
  // Has an answer right now. Never says which one.
  answered: boolean;
  // Present only during reveal and over.
  zone?: number | null;
  hit?: boolean;
}

export interface Winner {
  pid: string;
  name: string;
  color: number;
}

// Present only on a joined phone's own socket.
export interface You {
  pid: string;
  zone: number | null;
  // During reveal: what happened to this player. For a ghost, what would have.
  result: "safe" | "hit" | null;
}

export interface StateMsg {
  t: "state";
  code: string;
  phase: Phase;
  paused: boolean;
  questionNumber: number;
  questionCount: number;
  suddenDeath: boolean;
  // Epoch ms on the server clock; 0 when no timer runs. While paused it is
  // serverNow plus the time left, so `deadline - serverNow` is always the remainder.
  deadline: number;
  serverNow: number;
  question: { text: string; answers: [string, string, string, string] } | null;
  // Present only during reveal. INVARIANT: never sent before it.
  correct?: number;
  floorHeld?: boolean;
  players: PublicPlayer[];
  // The last finished game's winners; kept through the next lobby.
  winners: Winner[];
  you?: You;
}

// ---- server to screens only: [index into state.players, x, y], batched.
export type PosTuple = [number, number, number];
export type PosMsg = { t: "pos"; p: PosTuple[] };

export type ServerMsg = StateMsg | PosMsg;
