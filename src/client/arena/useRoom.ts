// The projector's link to its room. Both projector pages use it, so the host can
// switch between /host and /host/2d mid-game: same room, same host key.
//
// HOST KEY: /api/new returns it once. It lives in this laptop's localStorage as
// trivia.host.<CODE>; the URL carries only ?room=CODE, so the key never shows on
// the projector.

import { useCallback, useEffect, useRef, useState } from "react";
import { CLOSE, CODE_PATTERN } from "../../shared/config";
import type { HostMsg, StateMsg } from "../../shared/protocol";
import { openRoomSocket, type RoomSocket } from "../common/socket";
import { KEYS, store } from "../common/store";
import type { Positions } from "./layout";

export type RoomStatus =
  | "starting" // minting a room or connecting
  | "live"
  | "elsewhere" // this device has no host key for the room
  | "gone" // the room no longer exists
  | "failed"; // the server could not be reached

export interface Room {
  status: RoomStatus;
  code: string;
  state: StateMsg | null;
  online: boolean;
  // Mutated in place (10 updates a second); `tick` changes when it does.
  positions: Positions;
  tick: number;
  send(msg: HostMsg): void;
  newRoom(): void;
}

// Keys minted this visit, for browsers where localStorage is unavailable.
const memoryKeys = new Map<string, string>();

const roomFromUrl = () => (new URLSearchParams(location.search).get("room") ?? "").toUpperCase();

export function useRoom(): Room {
  const [code, setCode] = useState(roomFromUrl);
  const [status, setStatus] = useState<RoomStatus>("starting");
  const [state, setState] = useState<StateMsg | null>(null);
  const [online, setOnline] = useState(false);
  const [tick, setTick] = useState(0);
  const positions = useRef<Positions>(new Map()).current;
  const players = useRef<string[]>([]);
  const socket = useRef<RoomSocket | null>(null);
  const minting = useRef(false);

  const newRoom = useCallback(() => {
    if (minting.current) return;
    minting.current = true;
    setStatus("starting");
    setState(null);
    fetch("/api/new")
      .then((res) => (res.ok ? (res.json() as Promise<{ code: string; hostKey: string }>) : Promise.reject(res.status)))
      .then(({ code: fresh, hostKey }) => {
        memoryKeys.set(fresh, hostKey);
        store.set(KEYS.hostKey(fresh), hostKey);
        history.replaceState(null, "", `${location.pathname}?room=${fresh}`);
        setCode(fresh);
      })
      .catch(() => setStatus("failed"))
      .finally(() => {
        minting.current = false;
      });
  }, []);

  useEffect(() => {
    if (!CODE_PATTERN.test(code)) {
      newRoom();
      return;
    }
    const hostKey = memoryKeys.get(code) ?? store.get(KEYS.hostKey(code));
    if (!hostKey) {
      setStatus("elsewhere");
      return;
    }
    setStatus("starting");
    let phaseKey = "";
    const opened = openRoomSocket({
      code,
      role: "screen",
      hostKey,
      onState: (next) => {
        // Positions belong to one question.
        const key = `${next.phase}:${next.questionNumber}`;
        if (key !== phaseKey && next.phase !== "reveal") positions.clear();
        phaseKey = key;
        players.current = next.players.map((p) => p.pid);
        setState(next);
        setStatus("live");
      },
      onPos: (tuples) => {
        for (const [index, x, y] of tuples) {
          const pid = players.current[index];
          if (pid) positions.set(pid, [x, y]);
        }
        setTick((n) => n + 1);
      },
      onOnline: setOnline,
      onFatal: (close) => {
        if (close === CLOSE.noRoom) store.remove(KEYS.hostKey(code));
        setState(null);
        setStatus(close === CLOSE.noRoom ? "gone" : "elsewhere");
      },
    });
    socket.current = opened;
    return () => {
      opened.close();
      socket.current = null;
    };
  }, [code, newRoom, positions]);

  const send = useCallback((msg: HostMsg) => socket.current?.send(msg), []);
  return { status, code, state, online, positions, tick, send, newRoom };
}
