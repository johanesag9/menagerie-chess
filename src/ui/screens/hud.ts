/**
 * In-game HUD: two player cards on the top and bottom edges, a collapsible move list,
 * the emote picker, and the check banner / Weird Mode toast. The middle stays clear for the board.
 */
import type { ActionRecord, EmoteKind, GameOptions, ModeState, MoveResult, PieceKind, Side, WeirdEvent } from '../../contracts/types';
import { ANIMAL_NAME, EMOTES, SIDE_NAME, WEIRD_TEXT, botName } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { formatClock, listRows, otherSide, spokenClock, tallyCaptures, tallyFromCaptured, type CapturedTally, type ListEntry } from '../format';
import { animalIcon } from '../icons';
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

interface Card {
  el: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  tray: HTMLElement;
  adv: HTMLElement;
  clock: HTMLElement;
  clockText: HTMLElement;
  bubble: HTMLElement;
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
  private info: GameOptions | null = null;
  private turn: Side = 'land';
  private thinking = false;
  private lastTick = -1;
  private tense = false;
  private emoteCooldown = 0;
  private timers = new Set<number>();
  /** Music the HUD wants while the game screen shows. */
  track: 'game' | 'tense' = 'game';
  onTrack: (t: 'game' | 'tense') => void = () => {};

  constructor(private ctx: UiCtx) {
    this.cards = { land: this.card('land'), sea: this.card('sea') };
    this.mode = new ModeHud(ctx);

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

    this.top = h('div', { class: 'mc-hud__bar mc-hud__bar--top' }, h('div', { class: 'mc-hud__slot' }), this.mode.chip, h('div', { class: 'mc-hud__tools' }, this.movesBtn, menuBtn));
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
    const el = h('div', { class: 'mc-card', 'data-side': side },
      h('span', { class: 'mc-card__avatar', html: animalIcon(side, 'k', { disc: true }) }),
      h('div', { class: 'mc-card__main' },
        h('div', { class: 'mc-card__line' }, name, status),
        h('div', { class: 'mc-card__line mc-card__line--tray' }, tray, adv)),
      clock, bubble);
    return { el, name, status, tray, adv, clock, clockText, bubble };
  }

  /** Who is who. Bot games put the human at the bottom; local games put Land at the bottom. */
  setInfo(info: GameOptions | null): void {
    this.info = info;
    const bot = info?.opponent.type === 'bot' ? info.opponent : null;
    const bottomSide: Side = bot ? otherSide(bot.botSide) : 'land';
    const topSide = otherSide(bottomSide);
    this.top.firstElementChild!.replaceChildren(this.cards[topSide].el, this.mode.strips[topSide]);
    this.bottom.firstElementChild!.replaceChildren(this.cards[bottomSide].el, this.mode.strips[bottomSide]);
    this.mode.setInfo(info);
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const isBot = bot?.botSide === side;
      c.name.textContent = bot ? (isBot ? botName(bot.level) : 'You') : SIDE_NAME[side];
      c.el.dataset.bot = String(isBot);
      c.el.setAttribute('aria-label', `${c.name.textContent}, ${SIDE_NAME[side]}`);
    }
    const timed = info ? info.time.initialMs !== null : false;
    this.el.classList.toggle('is-untimed', !timed);
    // No undo in Crazy: luck is luck.
    this.undoBtn.hidden = info?.mode === 'crazy';
    this.refresh();
  }

  reset(info: GameOptions | null): void {
    this.resetMoves();
    this.turn = info?.fen?.split(' ')[1] === 'b' ? 'sea' : 'land';
    this.thinking = false;
    this.lastTick = -1;
    this.setTense(false);
    for (const s of ['land', 'sea'] as const) this.cards[s].el.classList.remove('in-check', 'is-low');
    this.setInfo(info);
    const ms = info?.time.initialMs ?? null;
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
    this.refresh();
  }

  private refresh(): void {
    const bot = this.info?.opponent.type === 'bot' ? this.info.opponent : null;
    for (const side of ['land', 'sea'] as const) {
      const c = this.cards[side];
      const isTurn = side === this.turn;
      c.el.classList.toggle('is-turn', isTurn);
      const thinking = isTurn && this.thinking && (!bot || bot.botSide === side);
      c.el.classList.toggle('is-thinking', thinking);
      c.status.innerHTML = '';
      if (thinking) c.status.append(h('span', { class: 'mc-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')));
      else if (isTurn) c.status.textContent = bot && bot.botSide !== side ? 'Your move' : 'To move';
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

  /** A non-move line (power, card, bonus, bonk, wheel, pass). Records of kind 'move' are skipped: addMove shows moves. */
  addLog(r: ActionRecord): void {
    if (r.kind === 'move') return;
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

  private renderMoves(): void {
    const rows = listRows(this.entries);
    const icon: Record<ActionRecord['kind'], string> = { move: '', power: '⚡', card: '🃏', bonus: '🍀', bonk: '💫', wheel: '🎡', pass: '💤' };
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

  get moveCount(): number {
    return this.entries.length;
  }

  hideTransient(): void {
    this.toggleEmotes(false);
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.timers.forEach((t) => window.clearTimeout(t));
  }
}

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
