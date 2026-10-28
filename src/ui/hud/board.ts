/**
 * Phase 6: the board-game HUD (Sandcastle King, Stepping Stones). No die, no AP, no duels: it shows the stage instead.
 * - a strip by each player card: castle, the drafted animals with their traits (and height, and a crown);
 *   stones, the six animals with a dot on each unused power
 * - a chip in the top bar: round and cap, "Tide in N" (castle) or both path lengths (stones), and the loud crown warning
 * - a turn bar in the bottom dock: whose turn and the stage in plain words, End turn only in stage 'more'
 * - the Build/Dig (Raise/Sink) toggle under it, big enough for a thumb (`setShape`)
 * The Hud routes `setArenaState` here for 'castle' and 'stones' (and to ArenaHud for Sumo and Raid).
 */
import './board.css';
import type { ArenaState, BoardMode, GameOptions, PieceKind, PieceState, Side } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME, playerName } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { isOnline, otherSide, youSide } from '../format';
import { animalIcon } from '../icons';
import { STONES_POWER_TEXT, TRAIT_TEXT, crownWords, stageWords, tideWords } from '../boardText';
import { POWER_OF } from '../../contracts/types';

export interface ShapeState {
  dir: 'up' | 'down';
  canUp: boolean;
  canDown: boolean;
  mode: BoardMode;
  upBy?: number;
}

type Trait = { name: string; line: string };

const ARROW = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 L20 13 H15 V20 H9 V13 H4 Z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 L4 11 H9 V4 H15 V11 H20 Z" fill="currentColor"/></svg>',
};

/** Words and keys on the toggle, per mode. */
const SHAPE_WORDS: Record<BoardMode, { up: string; down: string; upKey: string; downKey: string; label: string }> = {
  castle: { up: 'Build', down: 'Dig', upKey: 'b', downKey: 'd', label: 'Build or dig' },
  stones: { up: 'Raise', down: 'Sink', upKey: 'r', downKey: 's', label: 'Raise or sink' },
};

/** Start file of an id ("land-b-c2" → 'c'), for a stable roster order. */
const startFile = (id: string): string => id.split('-')[2]?.[0] ?? 'z';

export class BoardHud {
  readonly strips: Record<Side, HTMLElement>;
  readonly chip: HTMLElement;
  /** Bottom dock: the turn bar and the toggle. */
  readonly bar: HTMLElement;
  private turnBar: HTMLElement;
  private art: HTMLElement;
  private who: HTMLElement;
  private stage: HTMLElement;
  private right: HTMLElement;
  private endBtn: HTMLButtonElement;
  private toggle: HTMLElement;
  private upBtn: HTMLButtonElement;
  private downBtn: HTMLButtonElement;
  private crown: HTMLElement;
  private state: ArenaState | null = null;
  /** Online: the side whose draft pick just arrived (its newest slot pops in). */
  private freshPick: Side | null = null;
  private info: GameOptions | null = null;
  private shape: ShapeState | null = null;
  private thinking = false;
  private ending = false;
  private endTimer = 0;
  private crownKey = '';
  /** Trait words from core (askDraft); ours are the fallback. */
  private traits: Partial<Record<PieceKind, Trait>> = {};

  constructor(private ctx: UiCtx) {
    this.strips = { land: this.makeStrip('land'), sea: this.makeStrip('sea') };
    this.crown = h('div', { class: 'mc-crown', role: 'alert', hidden: true });
    this.chip = h('div', { class: 'mc-chip mc-chip--arena mc-chip--board', role: 'status', 'aria-live': 'off', hidden: true });

    this.art = h('span', { class: 'mc-bturn__art', 'aria-hidden': 'true' });
    this.who = h('span', { class: 'mc-turnbar__who' });
    this.stage = h('span', { class: 'mc-bturn__stage' });
    this.endBtn = button('End turn', { variant: 'primary', class: 'mc-turnbar__end', title: 'End turn (E)', onClick: () => this.endTurn() });
    this.right = h('span', { class: 'mc-turnbar__right' });
    this.turnBar = h('div', { class: 'mc-turnbar mc-bturn', role: 'group', 'aria-label': 'Turn' },
      this.art, h('span', { class: 'mc-turnbar__mid' }, this.who, this.stage), this.right);

    this.upBtn = this.shapeBtn('up');
    this.downBtn = this.shapeBtn('down');
    this.toggle = h('div', { class: 'mc-shape', role: 'radiogroup', hidden: true }, this.upBtn, this.downBtn);
    this.toggle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      this.pick(this.shape?.dir === 'up' ? 'down' : 'up', true);
    });

    this.bar = h('div', { class: 'mc-board-dock', hidden: true }, this.turnBar, this.toggle);
    document.addEventListener('keydown', this.onKey);
  }

  private makeStrip(side: Side): HTMLElement {
    return h('div', { class: 'mc-strip mc-strip--arena mc-strip--board', 'data-side': side, hidden: true });
  }

  private shapeBtn(dir: 'up' | 'down'): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'mc-shape__opt', role: 'radio', 'data-dir': dir, 'data-sfx': 'click' });
    b.addEventListener('click', () => this.pick(dir, false));
    return b;
  }

  // ---------- inputs ----------

  setInfo(info: GameOptions | null): void {
    this.info = info;
    this.state = null;
    this.shape = null;
    this.thinking = false;
    this.crownKey = '';
    this.clearEnding();
    this.render();
  }

  setState(st: ArenaState | null): void {
    if (!st || st.turn !== this.state?.turn || st.stage !== this.state?.stage || st.phase !== 'action') this.clearEnding();
    // Online, your friend's draft picks arrive from the room: the new one pops in with the pick sound (yours plays on click).
    const you = youSide(this.info);
    const friend = you && isOnline(this.info) ? otherSide(you) : null;
    const was = this.state?.draft?.picks[friend ?? 'land'].length ?? 0;
    this.freshPick = friend && st?.draft && this.state?.draft && st.draft.picks[friend].length > was ? friend : null;
    if (this.freshPick) this.ctx.audio.play('draftPick');
    this.state = st;
    if (!st) this.shape = null;
    this.render();
  }

  setThinking(on: boolean): void {
    this.thinking = on;
    this.renderBar();
  }

  /** Core's trait words from the draft. */
  setTraits(traits: Partial<Record<PieceKind, Trait>>): void {
    this.traits = { ...traits };
    this.render();
  }

  trait(kind: PieceKind): Trait {
    return this.traits[kind] ?? TRAIT_TEXT[kind];
  }

  setShape(s: ShapeState | null): void {
    this.shape = s ? { ...s } : null;
    this.renderShape();
    this.bar.hidden = !this.barVisible();
  }

  get arenaState(): ArenaState | null {
    return this.state;
  }

  /** True while End turn is live (stage 'more', a human side to move). */
  get canEnd(): boolean {
    return !this.bar.hidden && !this.endBtn.hidden && !this.endBtn.disabled && this.endBtn.isConnected && this.right.contains(this.endBtn);
  }

  endTurn(): void {
    if (!this.canEnd) return;
    this.ending = true;
    this.ctx.audio.play('endTurn');
    this.ctx.emit('endTurn', {});
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.clearEnding(true), 1500);
    this.renderBar();
  }

  private clearEnding(render = false): void {
    window.clearTimeout(this.endTimer);
    this.ending = false;
    if (render) this.renderBar();
  }

  /** Toggle by click, arrow keys or the letter keys. */
  private pick(dir: 'up' | 'down', focus: boolean): void {
    const s = this.shape;
    if (!s || (dir === 'up' ? !s.canUp : !s.canDown)) return;
    if (focus) (dir === 'up' ? this.upBtn : this.downBtn).focus({ preventScroll: true });
    if (s.dir === dir) return;
    s.dir = dir;
    this.renderShape();
    this.ctx.emit('shapeMode', { dir });
  }

  /** B/D (castle) or R/S (stones) flip the toggle; E ends the turn in stage 'more'. Only while the game screen is live. */
  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || this.bar.hidden || this.bar.closest('[inert]')) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [role="dialog"]:not(.mc-hud)')) return;
    if (document.querySelector('.mc-ui .mc-ask:not([hidden]), .mc-ui .mc-cover:not([hidden]), .mc-ui .mc-promo:not([hidden])')) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && this.canEnd) {
      e.preventDefault();
      this.endTurn();
      return;
    }
    const s = this.shape;
    if (!s || this.toggle.hidden) return;
    const w = SHAPE_WORDS[s.mode];
    if (k === w.upKey || k === w.downKey) {
      e.preventDefault();
      const dir = k === w.upKey ? 'up' : 'down';
      if (s.dir !== dir) this.ctx.audio.play('uiClick');
      this.pick(dir, false);
    }
  };

  /** Your side vs the bot or a friend online, else null. */
  private you(): Side | null {
    return youSide(this.info);
  }

  private nameOf(side: Side): string {
    return playerName(this.info, side);
  }

  private barVisible(): boolean {
    return (!!this.state && this.state.phase !== 'over') || (!!this.shape && !this.state);
  }

  // ---------- render ----------

  private render(): void {
    const st = this.state;
    for (const side of ['land', 'sea'] as const) this.renderStrip(side, st);
    this.renderChip(st);
    this.renderBar();
    this.renderShape();
  }

  private renderStrip(side: Side, st: ArenaState | null): void {
    const el = this.strips[side];
    el.hidden = !st;
    if (!st) return;
    if (st.mode === 'castle') this.castleStrip(el, side, st);
    else this.stonesStrip(el, side, st);
  }

  /** Castle: each drafted animal with its trait name (empty slots while drafting), its height and a crown. */
  private castleStrip(el: HTMLElement, side: Side, st: ArenaState): void {
    const onBoard = st.pieces.filter((p) => p.side === side).sort((a, b) => startFile(a.id).localeCompare(startFile(b.id)));
    const picks = st.draft?.picks[side] ?? [];
    const size = st.draft?.size ?? 2;
    const drafting = st.phase === 'draft';
    const rows: { kind: PieceKind; p?: PieceState }[] = drafting || !onBoard.length ? picks.map((kind) => ({ kind })) : onBoard.map((p) => ({ kind: p.kind, p }));
    const items = rows.map(({ kind, p }, i) => {
      const t = this.trait(kind);
      const fresh = drafting && this.freshPick === side && i === rows.length - 1;
      const lvl = p ? st.levels?.[p.square] ?? 0 : 0;
      const crowned = !!p && st.crowned?.pieceId === p.id;
      const mover = !!p && st.mover === p.id;
      const name = ANIMAL_NAME[side][kind];
      return h('span', { class: `mc-bani${crowned ? ' is-crowned' : ''}${mover ? ' is-mover' : ''}${fresh ? ' is-fresh' : ''}`, title: `${name}, ${t.name}: ${t.line}${p ? ` (level ${lvl})` : ''}` },
        h('span', { class: 'mc-ani' }, h('span', { class: 'mc-ani__icon', html: animalIcon(side, kind) }),
          crowned ? h('span', { class: 'mc-bani__crown', 'aria-hidden': 'true', text: '👑' }) : null,
          lvl > 0 && !crowned ? h('span', { class: 'mc-bani__lvl', 'aria-hidden': 'true', text: String(lvl) }) : null),
        h('span', { class: 'mc-bani__trait', text: t.name }));
    });
    const empty = drafting ? Math.max(0, size - picks.length) : 0;
    const now = drafting && st.turn === side;
    for (let i = 0; i < empty; i++) items.push(h('span', { class: `mc-bani mc-bani--empty${now && i === 0 ? ' is-now' : ''}` }, h('span', { class: 'mc-ani' }), h('span', { class: 'mc-bani__trait', text: now && i === 0 ? 'picking…' : '?' })));
    el.replaceChildren(...items);
    const words = rows.map(({ kind }) => `${ANIMAL_NAME[side][kind]} (${this.trait(kind).name})`).join(', ');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${SIDE_NAME[side]}: ${words || 'no animals picked yet'}${empty ? `, ${empty} to pick` : ''}`);
  }

  /** Stones: six animals, a dot on each power not used yet. */
  private stonesStrip(el: HTMLElement, side: Side, st: ArenaState): void {
    const mine = st.pieces.filter((p) => p.side === side).sort((a, b) => startFile(a.id).localeCompare(startFile(b.id)));
    const used = new Set(st.powersUsed);
    const ready = mine.filter((p) => !used.has(p.id)).length;
    el.replaceChildren(h('span', { class: 'mc-arena__animals' }, ...mine.map((p) => {
      const pw = STONES_POWER_TEXT[POWER_OF[p.kind]];
      const left = !used.has(p.id);
      return h('span', { class: `mc-ani${left ? ' has-power' : ''}`, title: `${ANIMAL_NAME[side][p.kind]}: ${pw.name}${left ? '' : ' (used)'}` },
        h('span', { class: 'mc-ani__icon', html: animalIcon(side, p.kind) }));
    })), h('span', { class: 'mc-bstrip__n', 'aria-hidden': 'true', text: `⚡${ready}` }));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${SIDE_NAME[side]}: ${ready} power${ready === 1 ? '' : 's'} left`);
  }

  private renderChip(st: ArenaState | null): void {
    this.chip.hidden = !st;
    if (!st) {
      this.crown.hidden = true;
      return;
    }
    const parts: HTMLElement[] = [];
    if (st.phase === 'draft') {
      const picked = (st.draft?.picks.land.length ?? 0) + (st.draft?.picks.sea.length ?? 0);
      const total = (st.draft?.size ?? 2) * 2;
      parts.push(h('span', { class: 'mc-chip__item' }, h('span', { 'aria-hidden': 'true', text: '🎴 ' }), `Draft: pick ${Math.min(picked + 1, total)} of ${total}`));
    } else {
      parts.push(h('span', { class: 'mc-chip__item', text: `Round ${Math.min(st.round, st.maxRounds)} / ${st.maxRounds}` }));
    }
    if (st.mode === 'castle' && st.phase !== 'draft') {
      const tide = tideWords(st.nextTideIn);
      if (tide) parts.push(h('span', { class: `mc-chip__item mc-chip__sink${tide.urgent ? ' is-urgent' : ''}` }, h('span', { 'aria-hidden': 'true', text: '🌊 ' }), tide.text));
    }
    if (st.mode === 'stones' && st.pathLength) parts.push(this.pathItem(st));
    this.chip.replaceChildren(...parts, this.crown);
    this.renderCrown(st);
  }

  /** "Your path 3 · Theirs 4" (vs the bot) or "Path: Land 3 · Sea 4". A path of 1 means a win next move: hot. */
  private pathItem(st: ArenaState): HTMLElement {
    const p = st.pathLength!;
    const you = this.you();
    const val = (s: Side) => h('b', { class: p[s] !== null && p[s]! <= 1 ? 'is-hot' : '', 'data-side': s, text: p[s] === null ? '–' : String(p[s]) });
    const spoken = (s: Side) => (p[s] === null ? 'no path' : `${p[s]} step${p[s] === 1 ? '' : 's'}`);
    const el = you
      ? h('span', { class: 'mc-chip__item mc-chip__path' }, 'Your path ', val(you), h('span', { class: 'mc-chip__dash', text: ' · ' }), 'Theirs ', val(otherSide(you)))
      : h('span', { class: 'mc-chip__item mc-chip__path' }, 'Path: Land ', val('land'), h('span', { class: 'mc-chip__dash', text: ' · ' }), 'Sea ', val('sea'));
    el.title = 'Shortest dry path to the far shore, in steps';
    el.setAttribute('aria-label', you ? `Your path: ${spoken(you)}. Theirs: ${spoken(otherSide(you))}.` : `Land's path: ${spoken('land')}. Sea's path: ${spoken('sea')}.`);
    return el;
  }

  /** The loud warning while someone stands on a castle. Pops (and is read out) when it first appears. */
  private renderCrown(st: ArenaState): void {
    const text = st.phase === 'over' ? null : crownWords(st, this.you());
    const c = st.crowned;
    const key = c && text ? `${c.pieceId}@${c.square}` : '';
    this.crown.hidden = !text;
    if (!text || !c) {
      this.crownKey = '';
      return;
    }
    this.crown.dataset.side = c.side;
    this.crown.dataset.mine = String(this.you() === c.side);
    if (key === this.crownKey && this.crown.textContent?.endsWith(text)) return;
    const fresh = key !== this.crownKey;
    this.crownKey = key;
    this.crown.replaceChildren(h('span', { class: 'mc-crown__icon', 'aria-hidden': 'true', text: '👑' }), h('span', { text }));
    if (fresh && !this.ctx.settings.reducedMotion) {
      this.crown.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,1.35,.4,1)' });
    }
  }

  private renderBar(): void {
    const st = this.state;
    this.bar.hidden = !this.barVisible();
    this.turnBar.hidden = !st || st.phase === 'over';
    if (!st || this.turnBar.hidden) return;
    const you = this.you();
    const human = you === null || you === st.turn;
    this.turnBar.dataset.side = st.turn;
    this.turnBar.dataset.stage = st.stage ?? '';
    // Online draft: the friend picks on their own screen; their picks show in the strip as they come in.
    const friendPicking = isOnline(this.info) && !human && st.phase === 'draft';
    this.who.textContent = friendPicking ? 'Friend is picking…' : you === null ? `${SIDE_NAME[st.turn]}'s turn` : human ? 'Your turn' : `${this.nameOf(st.turn)}'s turn`;
    this.stage.textContent = friendPicking ? 'Their picks show up as they come in' : stageWords(st, human);

    // Castle: the animal that builds or digs, beside the words.
    const mover = st.mode === 'castle' && (st.stage === 'shape' || st.stage === 'more') ? st.pieces.find((p) => p.id === st.mover) : undefined;
    this.art.hidden = !mover;
    if (mover && this.art.dataset.id !== mover.id) this.art.innerHTML = animalIcon(mover.side, mover.kind, { disc: true });
    this.art.dataset.id = mover?.id ?? '';

    const more = st.stage === 'more' && st.phase === 'action';
    this.endBtn.disabled = this.ending;
    if (human && more) {
      // Keep the same node so keyboard focus stays on it.
      if (this.right.firstChild !== this.endBtn || this.right.childNodes.length !== 1) this.right.replaceChildren(this.endBtn);
    } else {
      this.right.replaceChildren(!human && (this.thinking || friendPicking) ? h('span', { class: 'mc-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')) : h('span'));
    }
  }

  private renderShape(): void {
    const s = this.shape;
    this.toggle.hidden = !s;
    if (!s) return;
    const w = SHAPE_WORDS[s.mode];
    this.toggle.dataset.mode = s.mode;
    this.toggle.dataset.dir = s.dir;
    this.toggle.setAttribute('aria-label', w.label);
    const fill = (b: HTMLButtonElement, dir: 'up' | 'down') => {
      const on = s.dir === dir;
      const can = dir === 'up' ? s.canUp : s.canDown;
      const word = dir === 'up' ? w.up : w.down;
      const extra = dir === 'up' && (s.upBy ?? 1) > 1 ? `×${s.upBy}` : '';
      b.disabled = !can;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.title = `${word}${extra ? ` ${extra}` : ''} (${(dir === 'up' ? w.upKey : w.downKey).toUpperCase()})${can ? '' : ': nothing to ' + word.toLowerCase() + ' here'}`;
      b.setAttribute('aria-label', `${word}${extra ? ` times ${s.upBy}` : ''}`);
      b.replaceChildren(h('span', { class: 'mc-shape__ico', html: ARROW[dir] }), h('span', { class: 'mc-shape__word', text: word }),
        ...(extra ? [h('span', { class: 'mc-shape__x', text: extra })] : []),
        h('kbd', { text: (dir === 'up' ? w.upKey : w.downKey).toUpperCase() }));
    };
    fill(this.upBtn, 'up');
    fill(this.downBtn, 'down');
  }

  dispose(): void {
    window.clearTimeout(this.endTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}
