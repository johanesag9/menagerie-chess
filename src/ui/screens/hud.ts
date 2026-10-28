/**
 * In-game HUD: two player cards on the top and bottom edges, a collapsible move list,
 * the emote picker, and the check banner / Weird Mode toast. The middle stays clear for the board.
 */
import type { ActionRecord, ArenaState, EmoteKind, GameOptions, ModeState, MoveResult, PieceKind, Side, WeirdEvent } from '../../contracts/types';
import { isArenaMode } from '../../contracts/types';
import type { OnlineHud } from '../../contracts/net';
import { ANIMAL_NAME, EMOTES, SIDE_NAME, WEIRD_TEXT, playerName } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { formatClock, formatSeconds, isOnline, listRows, otherSide, spokenClock, spokenSeconds, tallyCaptures, tallyFromCaptured, youSide, type CapturedTally, type ListEntry } from '../format';
import { animalIcon } from '../icons';
import { ArenaHud } from './arenaHud';
import { ModeHud } from './modeHud';

export const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
  moves: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="2.6" rx="1.3"/><rect x="4" y="10.7" width="16" height="2.6" rx="1.3"/><rect x="4" y="16.4" width="10" height="2.6" rx="1.3"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6 L4 10.5 L9 15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10.5 H14 a5 5 0 0 1 0 10 H11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  emote: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="9" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/><path d="M8 14 Q12 18 16 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

/** Below this the clock turns red; below 10s it ticks every second. */
const LOW_MS = 20_000;
const TICK_MS = 10_000;
/** Phase 5: the online turn timer (GAME_SPEC "Online play": 60s), urgent in the last 10s. */
const TURN_MS = 60_000;
const URGENT_MS = 10_000;

interface Card {
  el: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  tray: HTMLElement;
  adv: HTMLElement;
  clock: HTMLElement;
  clockText: HTMLElement;
  bubble: HTMLElement;
  /** Phase 5: the online turn timer by the side to move. */
  timer: HTMLElement;
  timerText: HTMLElement;
}

export class Hud {
  readonly el: HTMLElement;
  private cards: Record<Side, Card>;
  private top: HTMLElement;
  private bottom: HTMLElement;
  private movesPanel: HTMLElement;
  private movesList: HTMLElement;
  private movesBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private emoteBtn: HTMLButtonElement;
  private emotePicker: HTMLElement;
  private banner: HTMLElement;
  private toast: HTMLElement;
  private live: HTMLElement;
  private moves: MoveResult[] = [];
  /** Moves and log lines in order (Normal/Crazy add log lines between moves). */
  private entries: ListEntry[] = [];
  private lastTally: CapturedTally | null = null;
  readonly mode: ModeHud;
  /** Phase 4: the party-mode HUD (Sumo, Raid). */
  readonly arena: ArenaHud;
  private info: GameOptions | null = null;
  private turn: Side = 'land';
  private thinking = false;
  private lastTick = -1;
  private tense = false;
  private emoteCooldown = 0;
  private timers = new Set<number>();
  /** Phase 5: the online state (null offline), the pills under the friend's card and the countdown ticker. */
  private online: OnlineHud | null = null;
  private onlineEl: HTMLElement;
  private onlineTicker = 0;
  private turnTotal = TURN_MS;
  private turnSide: Side | null = null;
  private lowPlayed = false;
  /** Music the HUD wants while the game screen shows. */
  track: 'game' | 'tense' = 'game';
  onTrack: (t: 'game' | 'tense') => void = () => {};

  constructor(private ctx: UiCtx) {
    this.cards = { land: this.card('land'), sea: this.card('sea') };
    this.onlineEl = h('div', { class: 'mc-online', hidden: true });
    this.mode = new ModeHud(ctx);
    this.arena = new ArenaHud(ctx);
    this.mode.setArena(this.arena.bar, false);

    this.movesBtn = button('', { variant: 'icon', label: 'Move list', icon: ICON.moves, onClick: () => this.toggleMoves() });
    this.movesBtn.setAttribute('aria-expanded', 'false');
    this.movesBtn.setAttribute('aria-controls', 'mc-moves');
    const menuBtn = button('', { variant: 'icon', label: 'Pause menu', icon: ICON.menu, onClick: () => ctx.show('pause') });
    this.undoBtn = button('', { variant: 'icon', label: 'Undo move', icon: ICON.undo, onClick: () => ctx.emit('undo', {}) });
    this.emoteBtn = button('', { variant: 'icon', label: 'Emotes', icon: ICON.emote, onClick: () => this.toggleEmotes() });
    this.emoteBtn.setAttribute('aria-expanded', 'false');
    this.emoteBtn.setAttribute('aria-haspopup', 'true');

    this.emotePicker = h('div', { class: 'mc-emotes', role: 'menu', 'aria-label': 'Send an emote', hidden: true });
    EMOTES.forEach((e, i) => {
      const b = h('button', { type: 'button', class: 'mc-emotes__btn', role: 'menuitem', 'data-sfx': 'none', 'aria-label': e.label, title: e.label, style: `--i:${i}`, text: e.icon });
      b.addEventListener('click', () => this.sendEmote(e.kind));
      this.emotePicker.append(b);
    });
    this.emotePicker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.toggleEmotes(false);
        this.emoteBtn.focus();
      }
      const items = Array.from(this.emotePicker.querySelectorAll<HTMLElement>('button'));
      const i = items.indexOf(document.activeElement as HTMLElement);
      const step = ({ ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 } as Record<string, number>)[e.key];
      if (step && i >= 0) {
        e.preventDefault();
        items[(i + step + items.length) % items.length].focus();
      }
    });

    this.movesList = h('ol', { class: 'mc-moves__list' });
    this.movesPanel = h('aside', { class: 'mc-moves', id: 'mc-moves', 'aria-label': 'Moves', hidden: true },
      h('header', { class: 'mc-moves__head' },
        h('h2', { text: 'Moves' }),
        button('', { variant: 'icon', class: 'mc-btn--sm', sfx: 'back', label: 'Hide move list', icon: ICON.close, onClick: () => this.toggleMoves(false) })),
      this.movesList,
      h('p', { class: 'mc-moves__empty', text: 'No moves yet.' }));

    this.banner = h('div', { class: 'mc-banner', 'aria-hidden': 'true' });
    this.toast = h('div', { class: 'mc-toast', 'aria-hidden': 'true' });
    this.live = h('div', { class: 'mc-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });

    this.top = h('div', { class: 'mc-hud__bar mc-hud__bar--top' }, h('div', { class: 'mc-hud__slot' }), this.mode.chip, this.arena.chip, h('div', { class: 'mc-hud__tools' }, this.movesBtn, menuBtn));
    this.bottom = h('div', { class: 'mc-hud__bar mc-hud__bar--bottom' }, h('div', { class: 'mc-hud__slot' }), this.mode.dock, h('div', { class: 'mc-hud__tools' }, this.undoBtn, h('div', { class: 'mc-emote-anchor' }, this.emotePicker, this.emoteBtn)));

    this.el = h('section', { class: 'mc-screen mc-hud', 'aria-label': 'Game' }, this.top, this.movesPanel, this.banner, this.toast, this.bottom, this.live);
    document.addEventListener('pointerdown', this.onOutside, true);
    this.setInfo(null);
    if (window.matchMedia?.('(min-width: 900px)').matches) this.toggleMoves(true, true);
  }

  private card(side: Side): Card {
    const name = h('span', { class: 'mc-card__name' });
    const status = h('span', { class: 'mc-card__status' });
    const tray = h('span', { class: 'mc-card__tray', 'aria-label': 'Captured' });
    const adv = h('span', { class: 'mc-card__adv' });
    const clockText = h('span', { class: 'mc-card__clocktext', 'aria-hidden': 'true' });
    const clock = h('span', { class: 'mc-card__clock', role: 'timer' }, clockText);
    const bubble = h('span', { class: 'mc-bubble', 'aria-hidden': 'true' });
    const timerText = h('span', { class: 'mc-card__timertext', 'aria-hidden': 'true' });
    const timer = h('span', { class: 'mc-card__timer', role: 'timer', hidden: true },
      h('span', { class: 'mc-card__timericon', 'aria-hidden': 'true', html: TIMER_ICON }), timerText);
    const el = h('div', { class: 'mc-card', 'data-side': side },
      h('span', { class: 'mc-card__avatar', html: animalIcon(side, 'k', { disc: true }) }),
      h('div', { class: 'mc-card__main' },
        h('div', { class: 'mc-card__line' }, name, status),
        h('div', { class: 'mc-card__line mc-card__line--tray' }, tray, adv)),
      clock, timer, bubble);
    return { el, name, status, tray, adv, clock, clockText, bubble, timer, timerText };
  }

  /** Who is who. Bot and online games put you at the bottom; local games put Land at the bottom. */
  setInfo(info: GameOptions | null): void {
    this.info = info;
    const bot = info?.opponent.type === 'bot' ? info.opponent : null;
    const bottomSide: Side = youSide(info) ?? 'land';
    const topSide = otherSide(bottomSide);
    this.top.firstElementChild!.replaceChildren(this.cards[topSide].el, this.mode.strips[topSide], this.arena.strips[topSide], this.onlineEl);
    this.bottom.firstElementChild!.replaceChildren(this.cards[bottomSide].el, this.mode.strips[bottomSide], this.arena.strips[bottomSide]);
    this.mode.setInfo(info);
    this.arena.setInfo(info);
    this.mode.setArena(this.arena.bar, false);
    this.lastTally = null;
    this.renderTrays();
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const isBot = bot?.botSide === side;
      c.name.textContent = playerName(info, side);
      c.el.dataset.bot = String(isBot);
      c.el.dataset.friend = String(isOnline(info) && youSide(info) !== side);
      c.el.setAttribute('aria-label', `${c.name.textContent}, ${SIDE_NAME[side]}`);
    }
    const timed = info && !isArenaMode(info.mode) ? info.time.initialMs !== null : false;
    this.el.classList.toggle('is-untimed', !timed);
    // No undo in Crazy (luck is luck), in the party modes or online.
    this.undoBtn.hidden = info?.mode === 'crazy' || isArenaMode(info?.mode) || isOnline(info);
    this.el.classList.toggle('is-party', isArenaMode(info?.mode));
    this.refresh();
  }

  reset(info: GameOptions | null): void {
    this.resetMoves();
    this.turn = info?.fen?.split(' ')[1] === 'b' ? 'sea' : 'land';
    this.thinking = false;
    this.lastTick = -1;
    this.setTense(false);
    for (const s of ['land', 'sea'] as const) this.cards[s].el.classList.remove('in-check', 'is-low');
    // An offline game drops any online state; an online one keeps it (integration may send it first).
    if (!isOnline(info)) this.setOnline(null);
    this.setInfo(info);
    // Party modes have no clock.
    const ms = isArenaMode(info?.mode) ? null : info?.time.initialMs ?? null;
    this.setClocks(ms, ms, null);
  }

  setTurn(turn: Side): void {
    this.turn = turn;
    this.mode.setTurn(turn);
    this.refresh();
    this.announce(`${this.cards[turn].name.textContent} to move.`);
  }

  setBotThinking(thinking: boolean): void {
    this.thinking = thinking;
    this.arena.setThinking(thinking);
    this.refresh();
  }

  private refresh(): void {
    const bot = this.info?.opponent.type === 'bot' ? this.info.opponent : null;
    const you = youSide(this.info);
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const isTurn = side === this.turn;
      c.el.classList.toggle('is-turn', isTurn);
      const thinking = isTurn && this.thinking && (!bot || bot.botSide === side);
      c.el.classList.toggle('is-thinking', thinking);
      c.status.innerHTML = '';
      if (thinking) c.status.append(h('span', { class: 'mc-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')));
      else if (isTurn) c.status.textContent = you === side ? 'Your move' : 'To move';
    }
    // Undo needs a move to take back (and, vs the bot, one of yours).
    this.undoBtn.disabled = this.entries.length === 0 || this.thinking;
  }

  setClocks(landMs: number | null, seaMs: number | null, running: Side | null): void {
    const ms: Record<Side, number | null> = { land: landMs, sea: seaMs };
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const v = ms[side];
      c.clock.hidden = v === null;
      c.clockText.textContent = formatClock(v);
      c.clock.setAttribute('aria-label', `${SIDE_NAME[side]} clock: ${spokenClock(v)}`);
      c.el.classList.toggle('is-low', v !== null && v < LOW_MS);
      c.clock.classList.toggle('is-running', running === side);
    }
    const r = running ? ms[running] : null;
    if (running && r !== null && r < TICK_MS && r > 0) {
      const sec = Math.ceil(r / 1000);
      if (sec !== this.lastTick) {
        this.lastTick = sec;
        this.ctx.audio.play('clockLow', { rate: sec <= 3 ? 1.25 : 1 });
      }
    } else {
      this.lastTick = -1;
    }
    // Tense music under 30s, back to calm above 45s (gap so increments don't flip-flop it).
    const lowest = Math.min(landMs ?? Infinity, seaMs ?? Infinity);
    if (running && lowest < 30_000) this.setTense(true);
    else if (lowest > 45_000 || !running) this.setTense(false);
  }

  private setTense(on: boolean): void {
    if (on === this.tense) return;
    this.tense = on;
    this.track = on ? 'tense' : 'game';
    this.onTrack(this.track);
  }

  addMove(m: MoveResult): void {
    this.moves.push(m);
    this.entries.push({ move: m });
    for (const s of ['land', 'sea'] as const) this.cards[s].el.classList.remove('in-check');
    this.renderMoves();
    this.renderTrays();
    this.refresh();
    const who = ANIMAL_NAME[m.side][m.kind];
    this.announce(m.captured ? `${who} takes ${ANIMAL_NAME[m.captured.side][m.captured.kind]}. ${m.san}` : `${who} ${m.san}`);
  }

  /** A non-move line (power, card, bonus, bonk, wheel, pass). Records of kind 'move' are skipped (addMove shows moves), except in the party modes, which have no addMove. */
  addLog(r: ActionRecord): void {
    if (r.kind === 'move' && !isArenaMode(this.info?.mode)) return;
    this.entries.push({ log: r });
    this.renderMoves();
    this.refresh();
    this.announce(r.side ? `${SIDE_NAME[r.side]}: ${r.label}` : r.label);
  }

  resetMoves(): void {
    this.moves = [];
    this.entries = [];
    this.lastTally = null;
    this.renderMoves();
    this.renderTrays();
    this.refresh();
  }

  setModeState(st: ModeState | null): void {
    this.mode.setState(st);
    this.renderTrays();
  }

  /** Phase 4: the party HUD. The live and fallen animals also feed names to the duel and selection panels. */
  setArenaState(st: ArenaState | null): void {
    if (st) this.mode.setPieces([...st.pieces, ...st.out]);
    this.arena.setState(st);
    this.mode.setArena(this.arena.bar, !!st);
  }

  private renderMoves(): void {
    const rows = listRows(this.entries, isArenaMode(this.info?.mode));
    const icon: Record<ActionRecord['kind'], string> = { move: '👣', power: '⚡', card: '🃏', bonus: '🍀', bonk: '💫', wheel: '🎡', pass: '💤' };
    this.movesList.replaceChildren(...rows.map((r) => r.type === 'log'
      ? h('li', { class: 'mc-moves__log', 'data-side': r.record.side ?? 'none', 'data-kind': r.record.kind },
        h('span', { class: 'mc-moves__logicon', 'aria-hidden': 'true', text: icon[r.record.kind] }),
        h('span', { class: 'mc-moves__logtext', text: r.record.label }))
      : h('li', { class: 'mc-moves__row' },
        h('span', { class: 'mc-moves__n', text: `${r.n}.` }),
        h('span', { class: 'mc-moves__san', 'data-side': 'land', text: r.land ?? '…' }),
        h('span', { class: 'mc-moves__san', 'data-side': 'sea', text: r.sea ?? '' }))));
    const last = this.movesList.lastElementChild?.matches('.mc-moves__log')
      ? [this.movesList.lastElementChild]
      : Array.from(this.movesList.querySelectorAll('.mc-moves__san:not(:empty)'));
    last[last.length - 1]?.classList.add('is-last');
    this.movesPanel.classList.toggle('is-empty', rows.length === 0);
    this.movesList.scrollTop = this.movesList.scrollHeight;
  }

  /**
   * Captured animals under each card: from the mode state in Normal/Crazy (pigeons, double jumps and revives too),
   * from the moves in Classic. A newly taken animal pops in.
   */
  private renderTrays(): void {
    const st = this.mode.modeState;
    const t = st ? tallyFromCaptured(st.land.captured, st.sea.captured) : tallyCaptures(this.moves);
    const prev = this.lastTally;
    this.lastTally = t;
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const victims = otherSide(side);
      const fresh = prev && t[side].length > prev[side].length ? freshIndex(prev[side], t[side]) : -1;
      c.tray.replaceChildren(...t[side].map((k, i) =>
        h('span', { class: `mc-card__piece${i === fresh ? ' is-new' : ''}`, title: ANIMAL_NAME[victims][k], html: animalIcon(victims, k, { disc: true, label: ANIMAL_NAME[victims][k] }) })));
      const lead = side === 'land' ? t.diff : -t.diff;
      c.adv.textContent = lead > 0 ? `+${lead}` : '';
    }
  }

  toggleMoves(open = this.movesPanel.hidden, quiet = false): void {
    this.movesPanel.hidden = !open;
    this.movesBtn.setAttribute('aria-expanded', String(open));
    this.movesBtn.classList.toggle('is-on', open);
    if (open && !quiet) this.movesList.scrollTop = this.movesList.scrollHeight;
  }

  private toggleEmotes(open = this.emotePicker.hidden): void {
    this.emotePicker.hidden = !open;
    this.emoteBtn.setAttribute('aria-expanded', String(open));
    this.emoteBtn.classList.toggle('is-on', open);
    if (open) (this.emotePicker.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.emotePicker.hidden && !(e.target as Element).closest('.mc-emote-anchor')) this.toggleEmotes(false);
  };

  private sendEmote(kind: EmoteKind): void {
    const now = performance.now();
    this.toggleEmotes(false);
    this.emoteBtn.focus({ preventScroll: true });
    if (now < this.emoteCooldown) return;
    this.emoteCooldown = now + 1200;
    this.ctx.emit('emote', { emote: kind });
  }

  /** Speech bubble by a player's card. */
  showEmote(side: Side, emote: EmoteKind): void {
    const b = this.cards[side].bubble;
    b.textContent = EMOTES.find((e) => e.kind === emote)?.icon ?? '';
    b.classList.remove('is-on');
    void b.offsetWidth; // restart the CSS animation
    b.classList.add('is-on');
    this.ctx.audio.play(`emote:${emote}`, { pan: side === 'land' ? -0.3 : 0.3 });
    this.later(() => b.classList.remove('is-on'), 2200);
    this.announce(`${this.cards[side].name.textContent}: ${EMOTES.find((e) => e.kind === emote)?.label}`);
  }

  showCheck(side: Side): void {
    this.cards[side].el.classList.add('in-check');
    const king = ANIMAL_NAME[side].k;
    // Crazy has no check rule: it's only a warning that the king can be bonked.
    const crazy = this.info?.mode === 'crazy';
    const head = crazy ? 'King in danger!' : 'Check!';
    const sub = crazy ? `${SIDE_NAME[side]}'s ${king} can be bonked` : `${SIDE_NAME[side]}'s ${king} is in danger`;
    this.banner.classList.toggle('is-danger', crazy);
    this.pop(this.banner, `<strong>${head}</strong><span>${sub}</span>`, 1800);
    this.ctx.audio.play('check');
    this.announce(`${head} ${sub}.`);
  }

  showWeirdEvent(e: WeirdEvent): void {
    const t = WEIRD_TEXT[e.kind];
    const turns = e.durationTurns > 1 ? `For ${e.durationTurns} turns.` : 'For one turn.';
    this.pop(this.toast, `<span class="mc-toast__icon" aria-hidden="true">${t.icon}</span><span><small>Weird Mode</small><strong>${t.title}</strong><span>${t.body} ${turns}</span></span>`, 3200);
    this.ctx.audio.play('weird');
    this.announce(`Weird Mode: ${t.title} ${t.body}`);
  }

  private pop(el: HTMLElement, html: string, ms: number): void {
    el.innerHTML = html;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    const id = Number(el.dataset.timer ?? 0);
    if (id) window.clearTimeout(id);
    el.dataset.timer = String(this.later(() => el.classList.remove('is-on'), ms));
  }

  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private announce(text: string): void {
    this.live.textContent = text;
  }

  // ---------- Phase 5: online ----------

  /**
   * Connection pill, the friend's presence (with the forfeit countdown) and the turn timer by the side to move.
   * Plays `friendLeft` when the friend goes away or leaves, `friendJoined` when they come back, and `timeLow` once
   * when your own turn timer reaches 10s. null hides it all.
   */
  setOnline(st: OnlineHud | null): void {
    const prev = this.online;
    this.online = st;
    if (st && prev && st.opponent !== prev.opponent) {
      if ((st.opponent === 'away' || st.opponent === 'left') && prev.opponent !== 'left') {
        this.ctx.audio.play('friendLeft');
        this.announce(st.opponent === 'left' ? 'Your friend left.' : 'Your friend is away. They have a little while to come back.');
      } else if (st.opponent === 'here' && (prev.opponent === 'away' || prev.opponent === 'left')) {
        this.ctx.audio.play('friendJoined');
        this.announce('Your friend is back.');
      }
    }
    if (st && prev && st.connection !== prev.connection && st.connection === 'online' && prev.connection !== 'connecting') this.announce('Connected again.');
    const ticking = !!st && (!!st.timer || (st.opponent === 'away' && st.graceEndsAt !== null));
    if (ticking && !this.onlineTicker) this.onlineTicker = window.setInterval(() => this.renderOnline(), 200);
    if (!ticking && this.onlineTicker) {
      window.clearInterval(this.onlineTicker);
      this.onlineTicker = 0;
    }
    this.renderOnline();
  }

  private renderOnline(now = performance.now()): void {
    const st = this.online;
    const you = youSide(this.info);
    // Pills under the friend's card: your connection, then the friend. Waiting never shows in game.
    const pills: HTMLElement[] = [];
    if (st && st.connection !== 'online') {
      const text = st.connection === 'offline' ? 'Offline' : st.connection === 'connecting' ? 'Connecting…' : 'Reconnecting…';
      pills.push(h('span', { class: 'mc-pill', 'data-kind': st.connection }, h('span', { class: 'mc-pill__spin', 'aria-hidden': 'true' }), text));
    }
    if (st?.opponent === 'away') {
      const left = st.graceEndsAt === null ? null : Math.max(0, st.graceEndsAt - now);
      pills.push(h('span', { class: 'mc-pill', 'data-kind': 'away' }, h('span', { class: 'mc-pill__icon', 'aria-hidden': 'true', text: '💤' }),
        left === null ? 'Friend is away' : `Friend is away · ${formatSeconds(left)}`));
    } else if (st?.opponent === 'left') {
      pills.push(h('span', { class: 'mc-pill', 'data-kind': 'left' }, h('span', { class: 'mc-pill__icon', 'aria-hidden': 'true', text: '👋' }), 'Friend left'));
    }
    this.onlineEl.hidden = !pills.length;
    // Only rebuild when the text changes, so the spinner doesn't restart every tick.
    const sig = pills.map((p) => `${p.dataset.kind}:${p.textContent}`).join('|');
    if (this.onlineEl.dataset.sig !== sig) {
      this.onlineEl.dataset.sig = sig;
      this.onlineEl.replaceChildren(...pills);
    }
    if (you) this.cards[otherSide(you)].el.dataset.presence = st?.opponent === 'away' || st?.opponent === 'left' ? st.opponent : 'here';

    // The turn timer: a ring around the avatar and a countdown, urgent in the last 10s.
    const t = st?.timer ?? null;
    if (!t || t.side !== this.turnSide) {
      this.turnSide = t?.side ?? null;
      this.turnTotal = TURN_MS;
      this.lowPlayed = false;
    }
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const on = !!t && t.side === side;
      c.timer.hidden = !on;
      c.el.classList.toggle('has-timer', on);
      if (!on) {
        c.el.classList.remove('is-urgent');
        continue;
      }
      const left = Math.max(0, t!.endsAt - now);
      this.turnTotal = Math.max(this.turnTotal, left);
      const urgent = left <= URGENT_MS;
      if (left > URGENT_MS) this.lowPlayed = false;
      c.timerText.textContent = formatSeconds(left);
      c.timer.setAttribute('aria-label', `${playerName(this.info, side)}: ${spokenSeconds(left)} left this turn`);
      c.el.style.setProperty('--turn', (left / this.turnTotal).toFixed(4));
      c.el.classList.toggle('is-urgent', urgent);
      if (urgent && left > 0 && side === you && !this.lowPlayed) {
        this.lowPlayed = true;
        this.ctx.audio.play('timeLow');
        this.announce('10 seconds left.');
      }
    }
  }

  get moveCount(): number {
    return this.entries.length;
  }

  hideTransient(): void {
    this.toggleEmotes(false);
  }

  dispose(): void {
    window.clearInterval(this.onlineTicker);
    this.arena.dispose();
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.timers.forEach((t) => window.clearTimeout(t));
  }
}

/** A stopwatch, for the online turn timer. */
const TIMER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 13.5 V9.5 M10 3.5 H14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

/** Index in `now` of the piece that wasn't in `before` (both sorted the same way). */
function freshIndex(before: PieceKind[], now: PieceKind[]): number {
  const left = before.slice();
  for (let i = now.length - 1; i >= 0; i--) {
    const j = left.lastIndexOf(now[i]);
    if (j < 0) return i;
    left.splice(j, 1);
  }
  return -1;
}
