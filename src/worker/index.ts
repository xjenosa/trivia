// Worker entry: mints rooms, upgrades sockets into a room's Durable Object,
// and leaves everything else to the static assets.

import { CODE_CHARS, CODE_LENGTH, CODE_PATTERN } from "../shared/config";

export { Room } from "./room";

const CLAIM_ATTEMPTS = 8;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/new") {
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
        const code = randomCode();
        const hostKey = await env.ROOMS.get(env.ROOMS.idFromName(code)).claim(code);
        if (hostKey) return json({ code, hostKey });
      }
      return json({ error: "no free room code" }, 503);
    }

    if (url.pathname === "/api/ws") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "bad room code" }, 400);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "expected websocket" }, 426);
      }
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
