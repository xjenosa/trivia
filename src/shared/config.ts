// Timings, caps and budgets shared by the Worker and every page.

export const LIVES = 3;
export const QUESTION_MS = 20_000;
export const REVEAL_MS = 6_000;

export const TIER_QUESTIONS = 5; // per difficulty tier, so a game is 3 x 5 = 15
export const GAME_QUESTIONS = TIER_QUESTIONS * 3;
export const SUDDEN_DEATH_MAX = 3;

export const MAX_PLAYERS = 40;
export const NAME_MAX = 16;
export const COLOR_COUNT = 8;
export const ZONE_COUNT = 4;

// Half-width of the dead zone on each axis, in -1..1 arena coordinates.
export const GAP = 0.12;
// Where a tapped answer stands a token: the middle of its quadrant.
export const ZONE_CENTER = (1 + GAP) / 2;

// Server side: messages over the cap in any one second are dropped.
export const MSG_PER_SEC = 20;
export const MSG_MAX_CHARS = 512;
export const POS_BATCH_MS = 100;

// Phone send budget (cost guardrail): the server tolerates double before dropping.
export const MOVE_INTERVAL_MS = 250;
export const MOVES_PER_QUESTION = 40;

export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

export const CODE_LENGTH = 4;
export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1
export const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
export const PID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// WebSocket close codes the pages act on. Anything else means "reconnect".
export const CLOSE = {
  noRoom: 4404,
  badKey: 4403,
  kicked: 4409,
  full: 4429,
} as const;

export const BRACKETS = ["( )", "[ ]", "{ }", "< >"] as const;
