/**
 * The mode HUD (Normal and Crazy): a strip by each player card (powers left, duel tokens, the other hand),
 * a chip with the round, wheel and card countdowns and the die, and a dock above the bottom card that shows
 * the card hand, the selected piece's power, or the aiming prompt. `setModeState(null)` hides all of it (Classic).
 */
import type { Card, DieValue, GameOptions, ModeState, PieceId, PieceKind, PieceState, SelectionInfo, Side } from '../../contracts/types';
import { POWER_OF, isArenaMode } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { POWER_ORDER, otherSide, powerCounts } from '../format';
import { animalIcon } from '../icons';
import { ARENA_POWER_TEXT, POWER_BLOCK_TEXT, POWER_TEXT, SUIT, kindFromId } from '../modeText';

/** Pips of a die face, for the chip and the big die. */
export function dieFace(value: DieValue): HTMLElement {
  const spots: Record<DieValue, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const f = h('span', { class: 'mc-pips', 'data-v': value });
  for (let i = 1; i <= 9; i++) f.append(h('i', { class: spots[value].includes(i) ? 'on' : '' }));
  return f;
}

/** A playing card face: big suit, name. `mini` is the strip size. */
export function cardFace(card: Card, mini = false): HTMLElement {
  const s = SUIT[card.suit];
  return h('span', { class: `mc-cardface${mini ? ' mc-cardface--mini' : ''}`, 'data-suit': card.suit, 'data-red': String(s.red) },
    h('span', { class: 'mc-cardface__suit', 'aria-hidden': 'true', text: s.symbol }),
    mini ? null : h('span', { class: 'mc-cardface__name', text: s.name }));
}

interface Strip {
  el: HTMLElement;
  powers: HTMLElement;
  tokens: HTMLElement;
  hand: HTMLElement;
}

export class ModeHud {
  /** Placed by the Hud next to each player card. */
  readonly strips: Record<Side, HTMLElement>;
  /** Top bar, between the card and the tools (wraps under them on phones). */
  readonly chip: HTMLElement;
  /** Bottom bar, between the card and the tools (wraps above them on phones). */
  readonly dock: HTMLElement;
  private strip: Record<Side, Strip>;
  private fan: HTMLElement;
  private selPanel: HTMLElement;
  private promptBar: HTMLElement;
  private promptText: HTMLElement;
  private state: ModeState | null = null;
  private info: GameOptions | null = null;
  private turn: Side = 'land';
  private sel: SelectionInfo | null = null;
  private prompt: string | null = null;
  private pieces: PieceState[] | null = null;
  private kinds = new Map<PieceId, PieceKind>();
  private seenCards = new Set<string>();
  private activeCard: string | null = null;
  /** Phase 4: a party-mode game is showing (no ModeState; the turn bar sits in the dock). */
  private arenaOn = false;

  constructor(private ctx: UiCtx) {
    this.strip = { land: this.makeStrip('land'), sea: this.makeStrip('sea') };
    this.strips = { land: this.strip.land.el, sea: this.strip.sea.el };
    this.chip = h('div', { class: 'mc-chip', role: 'status', 'aria-live': 'off', hidden: true });
    this.fan = h('div', { class: 'mc-fan', role: 'group', 'aria-label': 'Your chaos cards' });
    this.selPanel = h('div', { class: 'mc-sel', role: 'region', 'aria-label': 'Selected piece' });
    this.promptText = h('span', { class: 'mc-prompt__text' });
    this.promptBar = h('div', { class: 'mc-prompt', role: 'status' },
      h('span', { class: 'mc-prompt__icon', 'aria-hidden': 'true', text: '✨' }),
      this.promptText,
      button('Cancel', { variant: 'ghost', class: 'mc-btn--sm', sfx: 'back', onClick: () => ctx.emit('cancelAction', {}) }));
    this.dock = h('div', { class: 'mc-dock' }, this.fan, this.selPanel, this.promptBar);
    this.render();
  }

  private makeStrip(side: Side): Strip {
    const powers = h('span', { class: 'mc-strip__powers' });
    const tokens = h('span', { class: 'mc-strip__tokens' });
    const hand = h('span', { class: 'mc-strip__hand' });
    const el = h('div', { class: 'mc-strip', 'data-side': side, hidden: true }, powers, tokens, hand);
    return { el, powers, tokens, hand };
  }

  // ---------- inputs ----------

  setInfo(info: GameOptions | null): void {
    this.info = info;
    this.state = null;
    this.sel = null;
    this.prompt = null;
    this.pieces = null;
    this.kinds.clear();
    this.seenCards.clear();
    this.activeCard = null;
    this.render();
  }

  setTurn(turn: Side): void {
    this.turn = turn;
    this.render();
  }

  /** Phase 4: put the party turn bar at the top of the dock, and show it (with the selected animal's power) while on. */
  setArena(bar: HTMLElement, on: boolean): void {
    if (bar.parentElement !== this.dock) this.dock.prepend(bar);
    if (on === this.arenaOn) return;
    this.arenaOn = on;
    if (!on) {
      this.sel = null;
      this.prompt = null;
    }
    this.render();
  }

  setState(state: ModeState | null): void {
    this.state = state;
    if (!state) {
      this.sel = null;
      this.prompt = null;
    }
    // A requested card stays lit until it leaves the hand or aiming ends.
    if (this.activeCard && state && ![...state.land.hand, ...state.sea.hand].some((c) => c.id === this.activeCard)) this.activeCard = null;
    this.render();
  }

  setSelection(sel: SelectionInfo | null): void {
    this.sel = sel;
    if (sel) this.kinds.set(sel.pieceId, sel.kind);
    this.render();
  }

  setPrompt(text: string | null): void {
    this.prompt = text;
    if (!text) this.activeCard = null;
    this.render();
  }

  /** Extra: the live pieces, for exact power counts and animal names in duels. */
  setPieces(pieces: PieceState[]): void {
    this.pieces = pieces.slice();
    for (const p of pieces) this.kinds.set(p.id, p.kind);
    this.render();
  }

  get promptOpen(): boolean {
    return this.prompt !== null;
  }

  get modeState(): ModeState | null {
    return this.state;
  }

  /** Kind of any piece seen so far (live pieces, captures, selections), else read from its id. */
  kindOf = (id: PieceId): PieceKind | null => {
    if (this.kinds.has(id)) return this.kinds.get(id)!;
    for (const s of ['land', 'sea'] as const) {
      const p = this.state?.[s].captured.find((c) => c.id === id);
      if (p) return p.kind;
    }
    return kindFromId(id);
  };

  /** Where a side's cards live on screen: the fan for the side whose hand is shown big, else its strip. */
  handRect(side: Side): DOMRect | null {
    const el = side === this.handSide() && !this.fan.hidden && this.fan.offsetParent ? this.fan : this.strip[side].hand;
    if (!el.offsetParent) return this.strip[side].el.offsetParent ? this.strip[side].el.getBoundingClientRect() : null;
    return el.getBoundingClientRect();
  }

  /** The human side in a bot game, else null. */
  private you(): Side | null {
    return this.info?.opponent.type === 'bot' ? otherSide(this.info.opponent.botSide) : null;
  }

  /** Whose hand gets the big tappable fan: yours vs the bot, the side to move in a local game. */
  private handSide(): Side {
    return this.you() ?? this.turn;
  }

  // ---------- render ----------

  private render(): void {
    const st = this.state;
    const crazy = st?.mode === 'crazy';
    for (const side of ['land', 'sea'] as const) this.renderStrip(side, st, crazy);
    this.renderChip(st, crazy);
    this.renderDock(st, crazy);
  }

  private renderStrip(side: Side, st: ModeState | null, crazy: boolean): void {
    const s = this.strip[side];
    s.el.hidden = !st;
    if (!st) return;
    const ss = st[side];
    const counts = powerCounts(side, ss, this.pieces, this.kindOf);
    const names: string[] = [];
    s.powers.replaceChildren(...POWER_ORDER.filter((k) => counts[k].total > 0).map((k) => {
      const c = counts[k];
      const power = POWER_TEXT[POWER_OF[k]].name;
      names.push(`${power} ${c.left} of ${c.total}`);
      return h('span', { class: `mc-pw${c.left === 0 ? ' is-used' : ''}`, title: `${ANIMAL_NAME[side][k]}: ${power}, ${c.left} left` },
        h('span', { class: 'mc-pw__icon', html: animalIcon(side, k) }),
        c.total > 1 ? h('b', { class: 'mc-pw__n', text: String(c.left) }) : null);
    }));
    s.powers.setAttribute('aria-label', `${SIDE_NAME[side]} powers left: ${names.join(', ')}`);
    s.powers.setAttribute('role', 'img');

    s.tokens.hidden = !crazy;
    s.hand.hidden = !crazy || side === this.handSide();
    if (!crazy) return;
    const max = Math.max(3, ss.duelTokens);
    s.tokens.replaceChildren(h('span', { class: 'mc-strip__k', 'aria-hidden': 'true', text: '✊' }),
      ...Array.from({ length: max }, (_, i) => h('i', { class: i < ss.duelTokens ? 'on' : '' })));
    s.tokens.setAttribute('role', 'img');
    s.tokens.setAttribute('aria-label', `${ss.duelTokens} duel token${ss.duelTokens === 1 ? '' : 's'}`);
    s.tokens.title = `${ss.duelTokens} duel token${ss.duelTokens === 1 ? '' : 's'} left`;
    s.hand.replaceChildren(...ss.hand.map((c) => cardFace(c, true)));
    s.hand.setAttribute('role', 'img');
    s.hand.setAttribute('aria-label', ss.hand.length ? `${SIDE_NAME[side]} cards: ${ss.hand.map((c) => SUIT[c.suit].name).join(', ')}` : `${SIDE_NAME[side]} has no cards`);
  }

  private renderChip(st: ModeState | null, crazy: boolean): void {
    this.chip.hidden = !st;
    if (!st) return;
    const parts: (HTMLElement | null)[] = [h('span', { class: 'mc-chip__item', text: `Round ${st.round}` })];
    if (crazy && st.nextWheelIn !== null) {
      parts.push(h('span', { class: `mc-chip__item${st.nextWheelIn <= 1 ? ' is-soon' : ''}`, title: 'Wheel of Chaos' },
        h('span', { 'aria-hidden': 'true', text: '🎡 ' }), st.nextWheelIn === 0 ? 'Wheel now' : `Wheel in ${st.nextWheelIn}`));
    }
    if (crazy) {
      const n = st[this.turn].nextCardIn;
      parts.push(h('span', { class: 'mc-chip__item', title: `${SIDE_NAME[this.turn]}'s next card` },
        h('span', { 'aria-hidden': 'true', text: '🃏 ' }), n <= 0 ? 'Card now' : `Card in ${n}`));
    }
    if (crazy && st.die) {
      const d = st.die;
      parts.push(h('span', { class: 'mc-chip__die', 'data-effect': d.effect, title: d.effect === 'banana' ? 'Banana peel' : d.effect === 'lucky' ? 'Lucky!' : `Rolled ${d.value}`, 'aria-label': `Die: ${d.value}` }, dieFace(d.value)));
    }
    this.chip.replaceChildren(...parts.filter(Boolean) as HTMLElement[]);
  }

  private renderDock(st: ModeState | null, crazy: boolean): void {
    // One thing at a time: aiming prompt > selected piece > card hand.
    const showPrompt = this.prompt !== null;
    const showSel = !showPrompt && !!this.sel?.power && (!!st || this.arenaOn);
    const handSide = this.handSide();
    const hand = crazy && st ? st[handSide].hand : [];
    const showFan = !showPrompt && !showSel && crazy && hand.length > 0;

    this.promptBar.hidden = !showPrompt;
    if (showPrompt) this.promptText.textContent = this.prompt;

    this.selPanel.hidden = !showSel;
    if (showSel) this.renderSel();

    this.fan.hidden = !showFan;
    if (showFan && st) {
      const canTap = this.you() !== null || handSide === this.turn;
      const playable = new Set(st[handSide].playableCards);
      const n = hand.length;
      this.fan.setAttribute('aria-label', `${SIDE_NAME[handSide]}'s chaos cards`);
      this.fan.replaceChildren(...hand.map((c, i) => {
        const ok = canTap && playable.has(c.id);
        const s = SUIT[c.suit];
        const b = h('button', {
          type: 'button', class: `mc-fan__card${this.seenCards.has(c.id) ? '' : ' is-new'}${this.activeCard === c.id ? ' is-active' : ''}`,
          'data-sfx': 'click', style: `--i:${i - (n - 1) / 2}`, disabled: !ok,
          'aria-label': `${s.name} (${s.symbol}): ${s.line}${ok ? '' : ' Not playable now.'}`, title: `${s.name}: ${s.line}`,
        }, cardFace(c));
        b.addEventListener('click', () => {
          this.activeCard = c.id;
          b.classList.add('is-active');
          this.ctx.emit('cardRequested', { cardId: c.id });
        });
        return b;
      }));
      hand.forEach((c) => this.seenCards.add(c.id));
    }
    this.dock.hidden = !showPrompt && !showSel && !showFan && !this.arenaOn;
    this.dock.classList.toggle('mc-dock--arena', this.arenaOn);
  }

  private renderSel(): void {
    const sel = this.sel!;
    const p = sel.power!;
    const mode = this.info?.mode;
    // Core's own name and line (Phase 4) win over ours; ours stay as the fallback.
    const t = { ...POWER_TEXT[p.power], ...(isArenaMode(mode) ? ARENA_POWER_TEXT[mode][p.power] : undefined) };
    if (p.name) t.name = p.name;
    if (p.line) t.line = p.line;
    const name = ANIMAL_NAME[sel.side][sel.kind];
    const use = button(`Use ${t.name}`, { variant: sel.side === 'sea' ? 'sea' : 'primary', class: 'mc-sel__use', onClick: () => this.ctx.emit('powerRequested', { pieceId: sel.pieceId }) });
    this.selPanel.dataset.side = sel.side;
    this.selPanel.replaceChildren(
      h('span', { class: 'mc-sel__art', html: animalIcon(sel.side, sel.kind, { disc: true }) }),
      h('div', { class: 'mc-sel__text' },
        h('span', { class: 'mc-sel__name' }, h('strong', { text: t.name }), h('span', { text: ` · ${name}` })),
        h('span', { class: 'mc-sel__line', text: t.line })),
      p.available ? use : h('span', { class: 'mc-sel__why', 'data-reason': p.reason ?? '', text: p.note ?? POWER_BLOCK_TEXT[p.reason ?? 'wrongPhase'] }));
    this.selPanel.setAttribute('aria-label', `${name}: ${t.name}. ${t.line}`);
  }
}
