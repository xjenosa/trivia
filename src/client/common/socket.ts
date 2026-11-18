// One socket to the room, with reconnect and the server clock offset.
// No heartbeats: the room hibernates between messages, and a ping would wake it.

import { useEffect, useState } from "react";
import { CLOSE } from "../../shared/config";
import type { HostMsg, PlayerMsg, PosTuple, ServerMsg, StateMsg } from "../../shared/protocol";

const FATAL: readonly number[] = Object.values(CLOSE);
const RETRY_MS = [400, 800, 1600, 3000];

// Server time minus this device's time, refreshed by every snapshot.
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

export interface RoomSocket {
  send(msg: PlayerMsg | HostMsg): void;
  close(): void;
}

export interface SocketOptions {
  code: string;
  role: "player" | "screen";
  hostKey?: string;
  onOpen?(socket: RoomSocket): void;
  onState(state: StateMsg): void;
  onPos?(tuples: PosTuple[]): void;
  onOnline?(online: boolean): void;
  // The room said no (gone, wrong key, kicked, full). No reconnect follows.
  onFatal(code: number): void;
}

export function openRoomSocket(options: SocketOptions): RoomSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const api: RoomSocket = {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    },
  };

  const connect = () => {
    const params = new URLSearchParams({ code: options.code, role: options.role });
    if (options.hostKey) params.set("hostKey", options.hostKey);
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/ws?${params}`);
    ws = socket;

    socket.addEventListener("open", () => {
      attempt = 0;
      options.onOnline?.(true);
      options.onOpen?.(api);
    });
    socket.addEventListener("message", (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "state") {
        clockOffset = msg.serverNow - Date.now();
        options.onState(msg);
      } else if (msg.t === "pos") {
        options.onPos?.(msg.p);
      }
    });
    socket.addEventListener("close", (event) => {
      if (closed || ws !== socket) return;
      if (FATAL.includes(event.code)) {
        closed = true;
        options.onFatal(event.code);
        return;
      }
      options.onOnline?.(false);
      retry = setTimeout(connect, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
      attempt += 1;
    });
  };

  connect();
  return api;
}

// Re-renders about ten times a second while `running`, returning server time.
export function useNow(running: boolean): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!running) return;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [running]);
  return running ? now : serverNow();
}
