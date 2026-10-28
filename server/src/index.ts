/**
 * The Worker: HTTP routes for rooms (see src/contracts/net.ts) and the WebSocket hand-off to each room's Durable Object.
 *   POST /rooms               CreateRoomRequest -> CreateRoomResponse
 *   GET  /rooms/:room         RoomInfo (404 when unknown or expired)
 *   GET  /rooms/:room/ws      WebSocket upgrade
 */
import type { CreateRoomRequest } from '../../src/contracts/net';
import { BadRequest, isCode, randomCode } from './logic/room';
import type { Env } from './room';

export { RoomObject } from './room';

/** Any localhost port (dev), plus the comma-separated ALLOWED_ORIGINS (the real site). */
export function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true; // not a browser (the smoke test, curl)
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin);
}

function cors(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !originAllowed(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const h = cors(origin, env);
    if (!originAllowed(origin, env)) return json({ error: 'Origin not allowed' }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return json({ ok: true, name: 'menagerie-chess-online' }, 200, h);
    if (parts[0] !== 'rooms') return json({ error: 'Not found' }, 404, h);

    // POST /rooms
    if (parts.length === 1) {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405, h);
      if (Number(request.headers.get('Content-Length') ?? 0) > 8192) return json({ error: 'Too big' }, 413, h);
      let body: CreateRoomRequest;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Body must be JSON' }, 400, h);
      }
      for (let tries = 0; tries < 5; tries++) {
        const code = randomCode();
        try {
          const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).create(code, body?.options);
          if (res) return json(res, 201, h);
        } catch (err) {
          // RPC errors arrive as plain Errors; BadRequest's message says what's wrong.
          const msg = err instanceof Error ? err.message : String(err);
          if (err instanceof BadRequest || /opponent|mode/.test(msg)) return json({ error: msg }, 400, h);
          throw err;
        }
      }
      return json({ error: 'Could not find a free room code' }, 503, h);
    }

    const code = parts[1].toUpperCase();
    if (!isCode(code)) return json({ error: 'No such room' }, 404, h);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));

    // GET /rooms/:room
    if (parts.length === 2 && request.method === 'GET') {
      const info = await stub.info();
      return info ? json(info, 200, h) : json({ error: 'No such room' }, 404, h);
    }

    // GET /rooms/:room/ws
    if (parts.length === 3 && parts[2] === 'ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket' }, 426, h);
      return stub.fetch(request);
    }

    return json({ error: 'Not found' }, 404, h);
  },
} satisfies ExportedHandler<Env>;
