/**
 * Smoke test against a running server (the `online-server` launch config, or `npm run server:dev`).
 * Creates a Sumo room over HTTP, opens two sockets (Land and Sea), plays random legal inputs to the end
 * (duels and secret throws included), checks both mirrors agree, and prints the result.
 *
 *   npm run server:smoke                      (http://localhost:8787)
 *   SMOKE_URL=https://… npm run server:smoke  (a deployed Worker)
 */
import type { ClientMsg, CreateRoomResponse, NetInput, RoomInfo, ServerMsg } from '../src/contracts/net';
import type { GameOptions, Side } from '../src/contracts/types';
import { legalActions } from '../src/core/arena/rules';
import { HANDS, Match } from './src/logic/match';

declare const process: { env: Record<string, string | undefined>; exit(code: number): never };

const BASE = (process.env.SMOKE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
/** Stay well under the room's 20 messages a second. */
const GAP_MS = 100;
const MAX_INPUTS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Player {
  ws!: WebSocket;
  mirror: Match | null = null;
  have = 0;
  you: Side | null = null;
  rejects: string[] = [];
  autos = 0;
  private waiters: { want: (m: ServerMsg) => boolean; done: (m: ServerMsg) => void }[] = [];

  constructor(readonly name: string) {}

  open(room: string): Promise<void> {
    this.ws = new WebSocket(`${WS_BASE}/rooms/${room}/ws`);
    this.ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onclose = (e) => console.log(`  ${this.name}: socket closed (${e.code} ${e.reason})`);
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error(`${this.name}: could not connect to ${WS_BASE}`));
    });
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<K extends ServerMsg['t']>(t: K, test: (m: Extract<ServerMsg, { t: K }>) => boolean = () => true, ms = 10_000): Promise<Extract<ServerMsg, { t: K }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: no '${t}' within ${ms}ms`)), ms);
      this.waiters.push({
        want: (m) => m.t === t && test(m as Extract<ServerMsg, { t: K }>),
        done: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: K }>);
        },
      });
    });
  }

  private receive(msg: ServerMsg): void {
    if (msg.t === 'welcome') this.you = msg.you;
    if (msg.t === 'start') {
      this.mirror = new Match(msg.options);
      this.have = 0;
    }
    if (msg.t === 'inputs') {
      msg.list.forEach((s, k) => {
        if (msg.from + k < this.have) return;
        if (s.auto) this.autos++;
        const r = this.mirror!.apply(s.input);
        if (!r.ok) throw new Error(`${this.name}: mirror refused ${JSON.stringify(s.input)} (${r.reason})`);
        this.have++;
      });
    }
    if (msg.t === 'reject') this.rejects.push(msg.reason);
    for (const w of this.waiters.splice(0)) {
      if (w.want(msg)) w.done(msg);
      else this.waiters.push(w);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${BASE}`);
  const options: GameOptions = { mode: 'sumo', opponent: { type: 'online', you: 'land' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };
  const created = await fetch(`${BASE}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options }) });
  if (created.status !== 201) throw new Error(`POST /rooms: ${created.status} ${await created.text()}`);
  const room = (await created.json()) as CreateRoomResponse;
  console.log(`  room ${room.room}, creator plays ${room.you}`);
  const info = (await (await fetch(`${BASE}/rooms/${room.room}`)).json()) as RoomInfo;
  console.log(`  info: ${JSON.stringify(info)}`);
  const missing = await fetch(`${BASE}/rooms/ZZZZZZ`);
  if (missing.status !== 404) throw new Error(`GET unknown room: expected 404, got ${missing.status}`);

  const land = new Player('Land');
  const sea = new Player('Sea');
  await land.open(room.room);
  land.send({ t: 'join', token: room.token, have: 0 });
  await land.waitFor('welcome');
  await sea.open(room.room);
  const started = Promise.all([land.waitFor('start'), sea.waitFor('start')]);
  sea.send({ t: 'join', token: null, have: 0 });
  await sea.waitFor('welcome');
  await started;
  console.log(`  both joined; game started (seed ${land.mirror!.options.seed})`);

  // A third player is refused.
  const third = new Player('Third');
  await third.open(room.room);
  third.send({ t: 'join', token: null, have: 0 });
  const err = await third.waitFor('error');
  console.log(`  a third player is refused: "${err.reason}"`);

  const players: Record<Side, Player> = { land: land.you === 'land' ? land : sea, sea: land.you === 'sea' ? land : sea };
  let id = 0;
  let sent = 0;
  let duels = 0;
  while (land.mirror!.need() && sent < MAX_INPUTS) {
    const m = land.mirror!;
    const need = m.need()!;
    const before = land.have;
    const inputs: NetInput[] = [];
    if (need.kind === 'answer') {
      duels++;
      inputs.push({ k: 'duel', side: need.side, call: Math.random() < 0.7 });
    } else if (need.kind === 'throw') {
      for (const side of [need.defender, need.attacker]) inputs.push({ k: 'throw', side, hand: HANDS[Math.floor(Math.random() * 3)] });
    } else {
      const all = legalActions(m.arenaController!.raw, true);
      const hits = all.filter((a) => a.type === 'hit');
      const pool = hits.length && Math.random() < 0.6 ? hits : all;
      inputs.push({ k: 'arena', side: need.side, action: pool[Math.floor(Math.random() * pool.length)] });
    }
    for (const input of inputs) {
      players[input.side].send({ t: 'input', id: ++id, input });
      sent++;
      await sleep(GAP_MS);
    }
    // Wait until the room has broadcast it (a throw pair arrives together).
    if (land.have <= before) await land.waitFor('inputs', () => land.have > before).catch(() => {
      throw new Error(`no broadcast after ${JSON.stringify(inputs)}; rejects: ${land.rejects.concat(sea.rejects).join(', ')}`);
    });
    // The next screen to act says it has finished animating (starts its turn timer).
    const next = land.mirror!.need();
    if (next) players[next.kind === 'throw' ? next.attacker : next.side].send({ t: 'idle', have: land.have });
  }
  if (land.mirror!.need()) {
    console.log(`  still going after ${sent} inputs; Land resigns`);
    players.land.send({ t: 'input', id: ++id, input: { k: 'resign', side: 'land' } });
    if (land.mirror!.need()) await land.waitFor('inputs', () => !land.mirror!.need());
  }
  await sleep(300);

  const over = land.mirror!.over()!;
  const same = land.mirror!.fingerprint() === sea.mirror!.fingerprint();
  const after = (await (await fetch(`${BASE}/rooms/${room.room}`)).json()) as RoomInfo;
  const st = land.mirror!.arenaController!.state;
  console.log(`  ${land.have} inputs broadcast (${land.autos} auto), ${duels} duel offers, round ${st.round}`);
  console.log(`  result: ${over.winner ? `${over.winner} wins` : 'a draw'} by ${over.reason}; out of the ring: land ${st.out.filter((p) => p.side === 'land').length}, sea ${st.out.filter((p) => p.side === 'sea').length}`);
  console.log(`  mirrors agree: ${same}; rejects: ${land.rejects.length + sea.rejects.length}; room status: ${after.status}`);
  land.ws.close();
  sea.ws.close();
  third.ws.close();
  if (!same || land.rejects.length + sea.rejects.length > 0 || after.status !== 'over') {
    console.log('SMOKE FAILED');
    process.exit(1);
  }
  console.log('SMOKE OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
