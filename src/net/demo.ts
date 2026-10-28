/**
 * net demo: two online clients on one page ("You" and "Friend"), each with its own connection and token storage,
 * playing through the `game` / `arena` proxies on small 2D boards. Fake (in-page) or real (wrangler dev) server.
 */
import type { ActResponse, ActionInput, GameOptions, Hand, PendingAction, PieceKind, PlayMode, Side, Square } from '../contracts/types';
import type { OnlineClientImpl, TokenStore } from './client';
import { FakeServer } from './fakeServer';
import { createOnlineWith, defaultBase } from './index';
import { ARENA_EVENTS, GAME_EVENTS } from './match';
import { ControlledTransport, httpTransport } from './transport';

// Emoji stand-ins, as in core's demo (no seahorse or blobfish emoji exist, so 🐠 and 🐟 stand in).
const EMOJI: Record<Side, Record<PieceKind, string>> = {
  land: { p: '🐕', n: '🐎', b: '🐐', r: '🐘', q: '🐈', k: '🐶' },
  sea: { p: '🦀', n: '🐠', b: '🐡', r: '🐢', q: '🐙', k: '🐟' },
};
const HAND: Record<Hand, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const SUIT: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '🃏' };
const FILES = 'abcdefgh';
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let serverKind: 'fake' | 'real' = new URLSearchParams(location.search).get('server') === 'real' ? 'real' : 'fake';
let fake: FakeServer | null = null;
let room: string | null = null;
let speed = 1;

// ---------- log ----------

const logEl = $<HTMLOListElement>('log');
function log(who: 'you' | 'friend' | 'room', text: string, warn = false): void {
  const li = h('li', warn ? 'warn' : undefined);
  li.append(h('span', `who ${who}`, who === 'room' ? 'Room' : who === 'you' ? 'You' : 'Friend'), ` ${text}`);
  logEl.prepend(li);
  while (logEl.children.length > 300) logEl.lastChild!.remove();
}

/** Each seat keeps its token under its own prefix, so the two players on this page don't share one. */
function storageFor(tag: string): TokenStore {
  const key = (k: string) => `net-demo.${tag}.${k}`;
  return {
    getItem: (k) => { try { return localStorage.getItem(key(k)); } catch { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(key(k), v); } catch { /* no storage */ } },
    removeItem: (k) => { try { localStorage.removeItem(key(k)); } catch { /* no storage */ } },
  };
}

function makeTransport(): ControlledTransport {
  return serverKind === 'fake' ? fake!.transport() : new ControlledTransport(httpTransport(defaultBase()));
}

// ---------- a seat ----------

type Aim = { kind: 'game'; p: PendingAction } | { kind: 'arena'; p: { pieceId: string; targets: Square[] } };

class Seat {
  client!: OnlineClientImpl;
  transport!: ControlledTransport;
  private storage: TokenStore;
  private selected: Square | null = null;
  private aim: Aim | null = null;
  private flash: string | null = null;
  private threw: string | null = null;
  timer: { side: Side | null; endsAt: number | null } = { side: null, endsAt: null };
  presence: { opponent: string; graceEndsAt: number | null } = { opponent: 'waiting', graceEndsAt: null };
  rematch: 'none' | 'youAsked' | 'theyAsked' = 'none';
  private dirty = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private el = {
    root: h('section', 'seat'), title: h('h2'), pill: h('span', 'pill'), presence: h('span', 'presence'),
    timer: h('div', 'timer'), board: h('div', 'board'), status: h('p', 'status'), prompt: h('p', 'prompt'),
    actions: h('div', 'actions'), net: h('div', 'net'),
  };

  constructor(readonly tag: 'you' | 'friend', readonly other: string, parent: HTMLElement) {
    this.storage = storageFor(tag);
    const head = h('div', 'seat-head');
    head.append(this.el.title, this.el.pill, this.el.presence);
    this.el.board.setAttribute('role', 'grid');
    this.el.board.addEventListener('click', (e) => {
      const sq = (e.target as HTMLElement).closest<HTMLElement>('.sq')?.dataset.sq as Square | undefined;
      if (sq) this.onSquare(sq);
    });
    const net = this.el.net;
    net.append(h('span', undefined, 'Connection:'));
    this.button(net, 'Drop', () => {
      this.transport.offline = true;
      this.transport.drop();
      log(this.tag, 'network cut (Drop)');
    });
    this.button(net, 'Restore', () => {
      this.transport.offline = false;
      log(this.tag, 'network back (it reconnects on its next retry, at most 15s)');
    });
    this.button(net, 'Reload page', () => this.reload());
    this.el.root.append(head, this.el.timer, this.el.board, this.el.status, this.el.prompt, this.el.actions, net);
    parent.append(this.el.root);
  }

  private button(parent: HTMLElement, label: string, fn: () => void, opts: { cls?: string; disabled?: boolean; title?: string } = {}) {
    const b = h('button', opts.cls, label);
    b.type = 'button';
    b.disabled = !!opts.disabled;
    if (opts.title) b.title = opts.title;
    b.addEventListener('click', fn);
    parent.append(b);
    return b;
  }

  /** A fresh client (new transport too). */
  reset(): void {
    this.client?.dispose();
    this.transport = makeTransport();
    this.newClient();
  }

  /** Like a page reload: the client goes away and a new one rejoins with the stored token. */
  reload(): void {
    log(this.tag, 'page reloaded: rejoining with the saved token');
    this.newClient();
    if (room) this.client.join(room).catch((e: Error) => log(this.tag, `could not rejoin: ${e.message}`, true));
  }

  private newClient(): void {
    this.client?.dispose();
    this.selected = null;
    this.aim = null;
    this.timer = { side: null, endsAt: null };
    this.rematch = 'none';
    const c = createOnlineWith({ transport: this.transport, storage: this.storage });
    this.client = c;
    const t = this.tag;
    c.on('connection', (e) => (log(t, `connection: ${e.state}`, e.state === 'offline'), this.render()));
    c.on('presence', (e) => {
      this.presence = e;
      log(t, `other player: ${e.opponent}${e.graceEndsAt ? ` (forfeits in ${mmss(e.graceEndsAt - performance.now())})` : ''}`);
      this.render();
    });
    c.on('started', (e) => {
      this.selected = null;
      this.aim = null;
      this.rematch = 'none';
      log(t, `game ${e.game} started: ${cap(e.options.mode ?? 'classic')}, plays ${cap(e.you)}`);
      this.render();
    });
    c.on('resync', (e) => (log(t, `resync: caught up on game ${e.game} silently, board redrawn`), this.render()));
    c.on('timer', (e) => ((this.timer = e), this.render()));
    c.on('emote', (e) => log(t, `${cap(e.side)} sent an emote: ${e.emote}`));
    c.on('rematch', (e) => {
      this.rematch = e.side === c.you ? 'youAsked' : 'theyAsked';
      log(t, `${cap(e.side)} asked for a rematch`);
      this.render();
    });
    c.on('auto', (e) => log(t, e.why === 'timeout' ? `${cap(e.side)}: time's up, the room played for them` : `${cap(e.side)} left: the room resigned for them`));
    c.on('rejected', (e) => (log(t, `the room refused my input: ${e.reason}`, true), this.render()));
    c.on('error', (e) => log(t, `error: ${e.reason}`, true));

    const g = c.game;
    const a = c.arena;
    for (const n of GAME_EVENTS) g.on(n, () => this.render());
    for (const n of ARENA_EVENTS) a.on(n, () => this.render());
    g.on('moved', (m) => g.mode === 'classic' && log(t, `${cap(m.side)}: ${m.san}`));
    g.on('logged', (r) => log(t, r.label));
    a.on('logged', (r) => log(t, r.label));
    for (const src of [g, a] as const) {
      const on = src.on.bind(src) as typeof g.on;
      on('duelOffered', (d) => log(t, `duel offered to ${cap(d.defender)} (${d.tokensLeft} tokens)`));
      on('duelRound', (r) => log(t, `throws: ${HAND[r.attackerHand]} vs ${HAND[r.defenderHand]}: ${r.result}`));
      on('duelEnded', (d) => log(t, d.called ? `duel won by the ${d.winner}` : 'no duel'));
      on('gameOver', (o) => log(t, `game over: ${o.winner ? `${cap(o.winner)} wins` : 'draw'} (${o.reason})`));
    }
    this.render();
  }

  // ---------- input ----------

  private get kind() {
    return this.client.mirror?.match.core.kind ?? null;
  }

  private report(r: ActResponse): void {
    this.flash = r.ok ? null : r.reason;
    if (!r.ok) log(this.tag, `refused here: ${r.reason}`, true);
  }

  private onSquare(sq: Square): void {
    this.flash = null;
    const you = this.client.you;
    if (!this.kind || !you) return;
    if (this.aim) {
      const step = this.aim.kind === 'game' ? this.client.game.targets(this.aim.p) : this.client.arena.targets(this.aim.p);
      if (step.squares.includes(sq)) {
        this.aim = { ...this.aim, p: { ...this.aim.p, targets: [...this.aim.p.targets, sq] } } as Aim;
        this.afterAim();
      } else this.aim = null;
      return this.render();
    }
    if (this.kind === 'game') {
      const g = this.client.game;
      if (this.selected && g.legalTargets(this.selected).includes(sq)) {
        const promotion = g.needsPromotion(this.selected, sq) ? ('q' as const) : undefined;
        this.report(g.act({ type: 'move', from: this.selected, to: sq, ...(promotion ? { promotion } : {}) }));
        this.selected = null;
        return this.render();
      }
      const p = g.pieces.find((x) => x.square === sq);
      this.selected = p?.side === you && this.selected !== sq ? sq : null;
    } else {
      const a = this.client.arena;
      const sel = this.selected && a.state.pieces.find((x) => x.square === this.selected);
      if (sel) {
        const o = a.pieceOptions(sel.id);
        if (o.steps.includes(sq)) {
          this.report(a.act({ type: 'step', pieceId: sel.id, to: sq }));
          this.selected = null;
          return this.render();
        }
        if (o.hits.includes(sq)) {
          this.report(a.act({ type: 'hit', pieceId: sel.id, target: sq }));
          this.selected = null;
          return this.render();
        }
      }
      const p = a.state.pieces.find((x) => x.square === sq);
      this.selected = p?.side === you && this.selected !== sq ? sq : null;
    }
    this.render();
  }

  /** Submit the aimed power/card/bonus once nothing more can be picked. */
  private afterAim(): void {
    const aim = this.aim;
    if (!aim) return;
    const step = aim.kind === 'game' ? this.client.game.targets(aim.p) : this.client.arena.targets(aim.p);
    if (step.squares.length) return;
    this.aim = null;
    this.selected = null;
    if (!step.complete) {
      this.flash = step.prompt || 'Nothing to aim at';
      return;
    }
    this.report(aim.kind === 'game' ? this.client.game.act(aim.p as ActionInput) : this.client.arena.act({ type: 'power', ...aim.p }));
  }

  private startAim(aim: Aim): void {
    this.aim = aim;
    this.afterAim();
    this.render();
  }

  // ---------- drawing ----------

  render(): void {
    if (this.dirty) return;
    this.dirty = true;
    // A timeout, not requestAnimationFrame: the demo should keep drawing in a background tab.
    setTimeout(() => {
      this.dirty = false;
      this.draw();
      // The 3D app calls resume() when its animations finish; here a short beat stands in for that.
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => (this.kind === 'arena' ? this.client.arena.resume() : this.client.game.resume()), 300);
    }, 16);
  }

  tick(): void {
    this.drawTimer();
    this.drawPresence();
  }

  private draw(): void {
    const c = this.client;
    const you = c.you;
    this.el.title.replaceChildren(...(you ? [h('span', `dot ${you}`)] : []), `${this.tag === 'you' ? 'You' : 'Friend'}${you ? ` · ${cap(you)}` : ''}`);
    this.el.pill.className = `pill ${c.connection}`;
    this.el.pill.textContent = { connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…', offline: 'Offline' }[c.connection];
    this.drawPresence();
    this.drawTimer();
    this.drawBoard();
    this.drawStatus();
    this.drawActions();
  }

  private drawPresence(): void {
    const p = this.presence;
    const el = this.el.presence;
    el.className = `presence ${p.opponent}`;
    el.textContent = !this.client.room
      ? ''
      : p.opponent === 'waiting' ? `Waiting for ${this.other.toLowerCase()}…`
      : p.opponent === 'here' ? `${this.other} is here`
      : p.opponent === 'away' ? `${this.other} is away · ${mmss((p.graceEndsAt ?? 0) - performance.now())}`
      : `${this.other} left`;
  }

  private drawTimer(): void {
    const t = this.timer;
    const el = this.el.timer;
    if (!t.side || t.endsAt === null) {
      el.className = 'timer';
      el.textContent = this.kind && !this.client.match?.isOver() ? 'Turn timer starts once the mover’s screen is ready' : 'No turn timer';
      return;
    }
    const left = t.endsAt - performance.now();
    el.className = `timer${left <= 10_000 ? ' urgent' : ''}${t.side === this.client.you ? ' mine' : ''}`;
    el.replaceChildren(h('span', undefined, `${cap(t.side)}${t.side === this.client.you ? ' (you)' : ''} to act`), h('span', undefined, mmss(left)));
  }

  private drawBoard(): void {
    const c = this.client;
    const you = c.you ?? 'land';
    const ranks = you === 'sea' ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = you === 'sea' ? [...FILES].reverse() : [...FILES];
    const kind = this.kind;
    const marks = new Map<Square, string>();
    const cls = new Map<Square, string[]>();
    const add = (sq: Square, k: string) => cls.set(sq, [...(cls.get(sq) ?? []), k]);
    let pieces: { square: Square; side: Side; kind: PieceKind; id: string }[] = [];
    const statuses = new Set<string>();

    if (kind === 'game') {
      const g = c.game;
      pieces = g.pieces;
      const last = g.history.at(-1);
      if (last) [last.from, last.to].forEach((s) => add(s, 'last'));
      if (this.selected) {
        add(this.selected, 'selected');
        for (const s of g.legalTargets(this.selected)) add(s, pieces.some((p) => p.square === s) ? 'capture' : 'target');
      }
      const ms = g.modeState;
      ms?.squares.forEach((b) => marks.set(b.square, b.by === 'land' ? '🏺' : '🫧'));
      ms?.statuses.forEach((s) => statuses.add(s.pieceId));
      if (this.aim?.kind === 'game') g.targets(this.aim.p).squares.forEach((s) => add(s, 'aim'));
    } else if (kind === 'arena') {
      const a = c.arena;
      const s = a.state;
      pieces = s.pieces;
      s.sunk.forEach((q) => add(q, 'sunk'));
      s.sinkingNext.forEach((q) => add(q, 'warn'));
      s.squares.forEach((b) => marks.set(b.square, b.by === 'land' ? '🏺' : '🫧'));
      s.statuses.forEach((x) => statuses.add(x.pieceId));
      for (const t of s.treasures) {
        const icon = t.owner === 'land' ? '🦴' : '🦪';
        if (t.square) marks.set(t.square, icon);
        const carrier = t.carrier && s.pieces.find((p) => p.id === t.carrier);
        if (carrier) marks.set(carrier.square, icon);
      }
      const sel = this.selected && s.pieces.find((p) => p.square === this.selected);
      if (sel) {
        add(sel.square, 'selected');
        const o = a.pieceOptions(sel.id);
        o.steps.forEach((q) => add(q, 'target'));
        o.hits.forEach((q) => add(q, 'capture'));
      }
      if (this.aim?.kind === 'arena') a.targets(this.aim.p).squares.forEach((q) => add(q, 'aim'));
    }

    const cells: HTMLElement[] = [];
    for (const r of ranks) {
      for (const f of files) {
        const sq = `${f}${r}` as Square;
        const fi = FILES.indexOf(f);
        const b = h('button', `sq ${r <= 4 ? 'meadow' : 'beach'} ${(fi + r) % 2 ? 'light' : 'dark'} ${(cls.get(sq) ?? []).join(' ')}`);
        b.type = 'button';
        b.dataset.sq = sq;
        const p = pieces.find((x) => x.square === sq);
        b.setAttribute('aria-label', p ? `${sq} ${p.side} ${p.kind}` : sq);
        if (p) b.append(h('span', `piece ${p.side}${statuses.has(p.id) ? ' status' : ''}`, EMOJI[p.side][p.kind]));
        const m = marks.get(sq);
        if (m) b.append(h('span', 'mark', m));
        if ((you === 'sea' ? f === 'h' : f === 'a') || r === ranks[ranks.length - 1]) b.append(h('span', 'coord', sq));
        cells.push(b);
      }
    }
    this.el.board.replaceChildren(...cells);
  }

  private drawStatus(): void {
    const c = this.client;
    const m = c.match;
    let text = 'No game yet';
    if (m && this.kind === 'game') {
      const g = c.game;
      const over = g.isOver();
      const ms = g.modeState;
      text = over
        ? `${over.winner ? `${cap(over.winner)} wins` : 'Draw'} (${over.reason})`
        : `${cap(g.turn)} to move${g.turn === c.you ? ' (you)' : ''}` +
          (ms ? ` · round ${ms.round}` : '') +
          (ms?.die ? ` · die ${ms.die.value}${ms.die.effect !== 'none' ? ` ${ms.die.effect}` : ''}` : '') +
          (ms && c.you ? ` · ${ms[c.you].duelTokens} duel tokens` : '');
    } else if (m && this.kind === 'arena') {
      const s = c.arena.state;
      text = s.phase === 'over'
        ? `Game over: ${c.arena.log.at(-1)?.label ?? ''}`
        : `${cap(s.turn)} to move${s.turn === c.you ? ' (you)' : ''} · die ${s.die ?? '-'} · ${s.ap} AP · round ${s.round}/${s.maxRounds}` +
          (s.mode === 'raid' ? ` · Land ${s.score.land}, Sea ${s.score.sea} (to ${s.target})` : '') +
          (s.mode === 'sumo' && s.nextSinkIn !== null ? ` · sinks in ${s.nextSinkIn}` : '');
    }
    this.el.status.textContent = text;
    const w = m?.awaiting();
    this.el.prompt.textContent = this.flash
      ?? (this.aim ? (this.aim.kind === 'game' ? c.game.targets(this.aim.p) : c.arena.targets(this.aim.p)).prompt : null)
      ?? (w?.kind === 'answer' && w.side === c.you ? 'Your piece is under attack: call a duel?' : null)
      ?? (w?.kind === 'throw' && w.sides.includes(c.you!) && this.threw !== `${c.mirror!.game}:${c.mirror!.applied}`
        ? 'Pick a hand. It stays secret until both are in.' : null)
      ?? (w?.kind === 'throw' ? 'Waiting for the other throw…' : '');
  }

  private drawActions(): void {
    const c = this.client;
    const box = this.el.actions;
    box.replaceChildren();
    const m = c.match;
    const you = c.you;
    if (!m || !you) return;
    const w = m.awaiting();
    const over = m.isOver();

    if (w.kind === 'answer' && w.side === you) {
      this.button(box, 'Call a duel', () => (this.proxy.answerDuel(true), this.render()), { cls: 'call' });
      this.button(box, 'Let it go', () => (this.proxy.answerDuel(false), this.render()));
    }
    if (w.kind === 'throw' && w.sides.includes(you)) {
      const round = `${c.mirror!.game}:${c.mirror!.applied}`;
      for (const hand of ['rock', 'paper', 'scissors'] as Hand[]) {
        this.button(box, HAND[hand], () => {
          this.proxy.throwHand(you, hand);
          this.threw = round;
          log(this.tag, `threw ${HAND[hand]} (secret)`);
          this.render();
        }, { cls: 'hand', disabled: this.threw === round, title: cap(hand) });
      }
    }

    if (!over && (w.kind === 'action' || w.kind === 'bonus') && w.side === you) {
      if (this.kind === 'game') this.gameActions(box, w.kind === 'bonus');
      else this.arenaActions(box);
    }
    if (this.aim) this.button(box, 'Cancel', () => ((this.aim = null), this.render()));
    if (!over) {
      this.button(box, 'Emote 😂', () => c.sendEmote('laugh'));
      this.button(box, 'Resign', () => this.proxy.resign(you));
    } else {
      const label = this.rematch === 'youAsked' ? 'Waiting for the other player…' : this.rematch === 'theyAsked' ? 'Rematch! (they asked)' : 'Rematch';
      this.button(box, label, () => c.askRematch(), { cls: 'primary', disabled: this.rematch === 'youAsked' });
    }
  }

  private get proxy() {
    return this.kind === 'arena' ? this.client.arena : this.client.game;
  }

  private gameActions(box: HTMLElement, bonus: boolean): void {
    const g = this.client.game;
    const you = this.client.you!;
    if (bonus) {
      const can = (choice: 'recharge' | 'pawnStep') => g.targets({ type: 'bonus', choice, targets: [] }).squares.length > 0;
      this.button(box, 'Lucky: recharge', () => this.startAim({ kind: 'game', p: { type: 'bonus', choice: 'recharge', targets: [] } }), { disabled: !can('recharge') });
      this.button(box, 'Lucky: pawn step', () => this.startAim({ kind: 'game', p: { type: 'bonus', choice: 'pawnStep', targets: [] } }), { disabled: !can('pawnStep') });
      this.button(box, 'Skip bonus', () => (this.report(g.act({ type: 'bonus', choice: 'skip' })), this.render()));
      return;
    }
    const sel = this.selected && g.pieces.find((p) => p.square === this.selected);
    if (sel && g.mode !== 'classic' && !this.aim) {
      const info = g.powerInfo(sel.id);
      this.button(box, `Power: ${info.name ?? info.power}`, () => this.startAim({ kind: 'game', p: { type: 'power', pieceId: sel.id, targets: [] } }), { disabled: !info.available, title: info.reason });
    }
    const ms = g.modeState;
    for (const card of ms?.[you].hand ?? []) {
      const reviveId = card.suit === 'hearts' ? ms![you].captured[0]?.id : undefined; // stand-in: revives the first captured piece
      this.button(box, `${SUIT[card.suit]} card`, () => this.startAim({ kind: 'game', p: { type: 'card', cardId: card.id, ...(reviveId ? { pieceId: reviveId } : {}), targets: [] } }), { disabled: !g.canPlayCard(you, card.id) });
    }
  }

  private arenaActions(box: HTMLElement): void {
    const a = this.client.arena;
    const sel = this.selected && a.state.pieces.find((p) => p.square === this.selected);
    if (sel && !this.aim) {
      const info = a.pieceOptions(sel.id).power;
      this.button(box, `Power: ${info.name ?? info.power}`, () => this.startAim({ kind: 'arena', p: { pieceId: sel.id, targets: [] } }), { disabled: !info.available, title: info.note ?? info.reason });
    }
    this.button(box, 'End turn', () => (this.report(a.act({ type: 'endTurn' })), this.render()), { cls: 'primary' });
  }
}

// ---------- page ----------

const seatsEl = $<HTMLElement>('seats');
const seats = [new Seat('you', 'Friend', seatsEl), new Seat('friend', 'The other player', seatsEl)];
const [you, friend] = seats;

function setServer(kind: 'fake' | 'real'): void {
  serverKind = kind;
  document.querySelectorAll<HTMLButtonElement>('[data-server]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.server === kind)));
  document.querySelectorAll<HTMLButtonElement>('#speed button, #force-timeout').forEach((b) => {
    b.disabled = kind === 'real';
    b.title = kind === 'real' ? 'Fake server only' : '';
  });
  fake?.dispose();
  fake = kind === 'fake' ? new FakeServer({ timeScale: 1 / speed }) : null;
  const hint = $<HTMLElement>('server-hint');
  hint.hidden = true;
  log('room', kind === 'fake' ? 'using the fake server (in this page)' : `using the real server at ${defaultBase()}`);
  newRoom();
}

async function newRoom(): Promise<void> {
  room = null;
  for (const s of seats) s.reset();
  const mode = $<HTMLSelectElement>('mode').value as PlayMode;
  const side = $<HTMLSelectElement>('side').value as Side;
  const options: GameOptions = { mode, opponent: { type: 'online', you: side }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };
  const roomEl = $<HTMLElement>('room');
  roomEl.textContent = 'Creating a room…';
  try {
    const r = await you.client.createRoom(options);
    room = r.room;
    roomEl.textContent = `Room ${r.room}`;
    roomEl.title = r.link;
    log('room', `room ${r.room} created (${cap(mode)}). Invite link: ${r.link}`);
    const info = await friend.client.roomInfo(r.room);
    log('friend', `opened the link: ${info ? `${cap(info.mode)}, plays ${info.openSide ? cap(info.openSide) : '(full)'}` : 'room not found'}`);
    await friend.client.join(r.room);
  } catch (e) {
    roomEl.textContent = 'No room';
    const msg = (e as Error).message;
    log('room', `could not start: ${msg}`, true);
    if (serverKind === 'real') {
      const hint = $<HTMLElement>('server-hint');
      hint.textContent = `Can't reach ${defaultBase()}. Start the online-server launch config (wrangler dev on port 8787), then press New room.`;
      hint.hidden = false;
    }
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-server]').forEach((b) =>
  b.addEventListener('click', () => b.dataset.server !== serverKind && setServer(b.dataset.server as 'fake' | 'real')));
document.querySelectorAll<HTMLButtonElement>('#speed button').forEach((b) =>
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll<HTMLButtonElement>('#speed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (fake) fake.timeScale = 1 / speed;
    log('room', `timers ×${speed} (from the next timer on)`);
  }));
$('new-room').addEventListener('click', () => newRoom());
$('force-timeout').addEventListener('click', () => {
  if (!fake || !room) return;
  log('room', 'force timeout');
  fake.forceTimeout(room);
});
$('clear-log').addEventListener('click', () => logEl.replaceChildren());
setInterval(() => seats.forEach((s) => s.tick()), 250);

setServer(serverKind);
