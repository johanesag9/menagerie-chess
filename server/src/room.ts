/**
 * The room Durable Object: the Cloudflare plumbing around `Room` (./logic/room.ts).
 * SQLite storage, hibernating WebSockets (idle rooms cost nothing) and one alarm for every timer.
 */
import { DurableObject } from 'cloudflare:workers';
import type { SentInput } from '../../src/contracts/net';
import { CLOSE, MAX_MESSAGE_BYTES, Room, type Effect, type Meta, type RoomStore } from './logic/room';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
  ALLOWED_ORIGINS?: string;
}

interface Attachment {
  token: string | null;
}

/** More than this many messages in a second closes the socket. */
const RATE_LIMIT = 20;

class SqlStore implements RoomStore {
  constructor(private sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS inputs (n INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  }
  loadMeta(): Meta | null {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'room'").toArray()[0];
    return row ? JSON.parse(row.v) : null;
  }
  saveMeta(meta: Meta): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('room', ?)", JSON.stringify(meta));
  }
  loadInputs(): SentInput[] {
    return this.sql.exec<{ v: string }>('SELECT v FROM inputs ORDER BY n').toArray().map((r) => JSON.parse(r.v));
  }
  appendInputs(from: number, list: SentInput[]): void {
    list.forEach((s, k) => this.sql.exec('INSERT OR REPLACE INTO inputs (n, v) VALUES (?, ?)', from + k, JSON.stringify(s)));
  }
  clearInputs(): void {
    this.sql.exec('DELETE FROM inputs');
  }
  wipe(): void {
    this.sql.exec('DELETE FROM inputs');
    this.sql.exec('DELETE FROM meta');
  }
}

export class RoomObject extends DurableObject<Env> {
  private room: Room;
  /** The alarm time last set (memory only; after a wake the first change sets it again). */
  private alarmAt: number | null | undefined;
  /** Per-socket message counts for the rate limit (memory only is fine: a hibernated socket is a quiet one). */
  private rate = new WeakMap<WebSocket, { second: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.room = new Room({ store: new SqlStore(ctx.storage.sql) });
    // Pings are answered without waking the room (and aren't billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------- RPC from the Worker ----------

  async create(code: string, options: unknown) {
    const res = this.room.create(code, options);
    await this.syncAlarm();
    return res;
  }

  info() {
    return this.room.info();
  }

  // ---------- WebSockets ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!this.room.exists()) return new Response('No such room', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (this.overLimit(ws)) {
      ws.close(CLOSE.rateLimited, 'too many messages');
      return;
    }
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return;
    const at = ws.deserializeAttachment() as Attachment;
    await this.run(this.room.message(at.token, data), ws);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    this.alarmAt = null; // it just fired
    await this.run(this.room.alarm(), null);
  }

  // ---------- helpers ----------

  private async socketGone(ws: WebSocket): Promise<void> {
    const token = (ws.deserializeAttachment() as Attachment | null)?.token;
    if (!token) return;
    const still = this.ctx.getWebSockets().some((s) => s !== ws && s.readyState === WebSocket.OPEN && (s.deserializeAttachment() as Attachment).token === token);
    if (!still) await this.run(this.room.closed(token), null);
  }

  /** Carry out the room's effects, in order. `ws` is the socket the call came from. */
  private async run(effects: Effect[], ws: WebSocket | null): Promise<void> {
    let destroy = false;
    for (const e of effects) {
      switch (e.kind) {
        case 'reply':
          trySend(ws, e.msg);
          break;
        case 'send':
          for (const s of this.socketsOf(e.token)) trySend(s, e.msg);
          break;
        case 'bind':
          // An older socket for the same player (another tab, or a reload before the close arrived) is replaced.
          for (const s of this.socketsOf(e.token)) if (s !== ws) tryClose(s, CLOSE.replaced, 'opened somewhere else');
          ws?.serializeAttachment({ token: e.token } satisfies Attachment);
          break;
        case 'close':
          tryClose(ws, e.code, e.reason);
          break;
        case 'destroy':
          destroy = true;
          break;
      }
    }
    if (destroy) {
      for (const s of this.ctx.getWebSockets()) tryClose(s, CLOSE.expired, 'room expired');
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.alarmAt = null;
      return;
    }
    await this.syncAlarm();
  }

  private socketsOf(token: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => (s.deserializeAttachment() as Attachment | null)?.token === token);
  }

  private async syncAlarm(): Promise<void> {
    const at = this.room.nextAlarm();
    if (at === this.alarmAt) return;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
    this.alarmAt = at;
  }

  private overLimit(ws: WebSocket): boolean {
    const second = Math.floor(Date.now() / 1000);
    const r = this.rate.get(ws);
    if (!r || r.second !== second) {
      this.rate.set(ws, { second, count: 1 });
      return false;
    }
    return ++r.count > RATE_LIMIT;
  }
}

function trySend(ws: WebSocket | null, msg: unknown): void {
  try {
    ws?.send(JSON.stringify(msg));
  } catch {
    // the socket is closing; its close handler deals with presence
  }
}

function tryClose(ws: WebSocket | null, code: number, reason: string): void {
  try {
    ws?.close(code, reason);
  } catch {
    // already closed
  }
}
