/**
 * The party-mode HUD (Sumo, Raid): a strip by each player card (the six animals, fallen ones crossed out, a ⚡ on
 * each unused power, duel tokens, and in Raid where that side's treasure is), a chip in the top bar (round and cap,
 * "Island sinks in N" or the score and "Wheel in N"), and a turn bar in the bottom dock (die, AP pips and the
 * End turn button). `setState(null)` hides all of it.
 */
import type { ArenaState, GameOptions, PieceId, PieceState, Side, TreasureState } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME, playerName } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { otherSide, youSide } from '../format';
import { animalIcon } from '../icons';
import { TREASURE } from '../modeText';
import { dieFace } from './modeHud';

interface Strip {
  el: HTMLElement;
  animals: HTMLElement;
  tokens: HTMLElement;
  treasure: HTMLElement;
}

/** Start file of an arena id ("land-n-b2" → 'b'), for a stable roster order. */
const startFile = (id: PieceId): string => id.split('-')[2]?.[0] ?? 'z';

export class ArenaHud {
  /** Placed by the Hud next to each player card. */
  readonly strips: Record<Side, HTMLElement>;
  /** Top bar, next to the mode chip (only one of them shows). */
  readonly chip: HTMLElement;
  /** Bottom dock: die, AP pips, End turn. */
  readonly bar: HTMLElement;
  private strip: Record<Side, Strip>;
  private barWho: HTMLElement;
  private barDie: HTMLElement;
  private barAp: HTMLElement;
  private barRight: HTMLElement;
  private endBtn: HTMLButtonElement;
  private state: ArenaState | null = null;
  private info: GameOptions | null = null;
  private thinking = false;
  /** AP at the start of this turn (the pip count), tracked per turn. */
  private apTotal = 0;
  private turnKey = '';
  private ending = false;
  private endTimer = 0;
  private prevOut = new Set<PieceId>();

  constructor(private ctx: UiCtx) {
    this.strip = { land: this.makeStrip('land'), sea: this.makeStrip('sea') };
    this.strips = { land: this.strip.land.el, sea: this.strip.sea.el };
    this.chip = h('div', { class: 'mc-chip mc-chip--arena', role: 'status', 'aria-live': 'off', hidden: true });
    this.barWho = h('span', { class: 'mc-turnbar__who' });
    this.barDie = h('span', { class: 'mc-turnbar__die' });
    this.barAp = h('span', { class: 'mc-turnbar__ap', role: 'img' });
    this.endBtn = button('End turn', { variant: 'primary', class: 'mc-turnbar__end', title: 'End turn (E)', onClick: () => this.endTurn() });
    this.barRight = h('span', { class: 'mc-turnbar__right' });
    this.bar = h('div', { class: 'mc-turnbar', role: 'group', 'aria-label': 'Turn', hidden: true },
      this.barDie, h('span', { class: 'mc-turnbar__mid' }, this.barWho, this.barAp), this.barRight);
  }

  private makeStrip(side: Side): Strip {
    const animals = h('span', { class: 'mc-arena__animals', role: 'img' });
    const tokens = h('span', { class: 'mc-strip__tokens', role: 'img' });
    const treasure = h('span', { class: 'mc-arena__treasure' });
    const el = h('div', { class: 'mc-strip mc-strip--arena', 'data-side': side, hidden: true }, animals, tokens, treasure);
    return { el, animals, tokens, treasure };
  }

  // ---------- inputs ----------

  setInfo(info: GameOptions | null): void {
    this.info = info;
    this.state = null;
    this.thinking = false;
    this.turnKey = '';
    this.prevOut.clear();
    this.render();
  }

  setState(st: ArenaState | null): void {
    const key = st ? `${st.round}-${st.turn}` : '';
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.apTotal = 0;
    }
    if (st) this.apTotal = Math.max(this.apTotal, st.ap);
    // Whatever End turn was waiting for, a new turn or phase settles it.
    if (!st || st.turn !== this.state?.turn || st.phase !== 'action') this.clearEnding();
    this.state = st;
    this.render();
  }

  setThinking(on: boolean): void {
    this.thinking = on;
    this.renderBar();
  }

  /** True while the End turn button is live (the Ui's E shortcut uses it). */
  get canEnd(): boolean {
    return !this.bar.hidden && !this.endBtn.hidden && !this.endBtn.disabled;
  }

  endTurn(): void {
    if (!this.canEnd) return;
    this.ending = true;
    this.ctx.audio.play('endTurn');
    this.ctx.emit('endTurn', {});
    // If core ignores it (wrong phase), free the button again.
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.clearEnding(true), 1500);
    this.renderBar();
  }

  private clearEnding(render = false): void {
    window.clearTimeout(this.endTimer);
    this.ending = false;
    if (render) this.renderBar();
  }

  get arenaState(): ArenaState | null {
    return this.state;
  }

  /** Your side vs the bot or a friend online, else null. */
  private you(): Side | null {
    return youSide(this.info);
  }

  private nameOf(side: Side): string {
    return playerName(this.info, side);
  }

  // ---------- render ----------

  private render(): void {
    const st = this.state;
    for (const side of ['land', 'sea'] as const) this.renderStrip(side, st);
    this.renderChip(st);
    this.renderBar();
  }

  private renderStrip(side: Side, st: ArenaState | null): void {
    const s = this.strip[side];
    s.el.hidden = !st;
    if (!st) return;
    const mine = (p: PieceState) => p.side === side;
    const roster = [...st.pieces.filter(mine).map((p) => ({ p, out: false })), ...st.out.filter(mine).map((p) => ({ p, out: true }))]
      .sort((a, b) => startFile(a.p.id).localeCompare(startFile(b.p.id)));
    const used = new Set(st.powersUsed);
    const carrying = new Map(st.treasures.filter((t) => t.carrier).map((t) => [t.carrier!, t.owner]));
    const status = new Map(st.statuses.map((x) => [x.pieceId, x.status]));
    const powersLeft = roster.filter((r) => !r.out && !used.has(r.p.id)).length;
    const left = roster.filter((r) => !r.out).length;
    s.animals.replaceChildren(...roster.map(({ p, out }) => {
      const name = ANIMAL_NAME[side][p.kind];
      const carried = carrying.get(p.id);
      const stt = status.get(p.id);
      const bits = [name, out ? 'fell in' : null, !out && !used.has(p.id) ? 'power ready' : null, stt ?? null, carried ? `carrying the ${TREASURE[carried].name}` : null].filter(Boolean);
      const fresh = out && !this.prevOut.has(p.id);
      return h('span', { class: `mc-ani${out ? ' is-out' : ''}${fresh ? ' is-new' : ''}${!out && !used.has(p.id) ? ' has-power' : ''}`, 'data-status': stt ?? '', title: bits.join(', ') },
        h('span', { class: 'mc-ani__icon', html: animalIcon(side, p.kind) }),
        carried ? h('span', { class: 'mc-ani__carry', 'aria-hidden': 'true', text: TREASURE[carried].icon }) : null);
    }));
    for (const r of roster) if (r.out) this.prevOut.add(r.p.id);
    const sumo = st.mode === 'sumo';
    s.animals.setAttribute('aria-label', `${SIDE_NAME[side]}: ${sumo ? `${left} of ${roster.length} animals left, ` : ''}${powersLeft} power${powersLeft === 1 ? '' : 's'} ready`);

    const n = st.duelTokens[side];
    const max = Math.max(2, n);
    s.tokens.replaceChildren(h('span', { class: 'mc-strip__k', 'aria-hidden': 'true', text: '✊' }),
      ...Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
    const tokText = `${n} duel token${n === 1 ? '' : 's'}`;
    s.tokens.setAttribute('aria-label', tokText);
    s.tokens.title = `${tokText} left`;

    const t = st.treasures.find((x) => x.owner === side);
    s.treasure.hidden = !t;
    if (t) this.renderTreasure(s.treasure, t, st);
  }

  /** Where a side's own treasure is: home, dropped on a square, or carried off by an enemy (urgent). */
  private renderTreasure(el: HTMLElement, t: TreasureState, st: ArenaState): void {
    const tr = TREASURE[t.owner];
    let text: string;
    let state: 'home' | 'dropped' | 'carried';
    if (t.carrier) {
      const p = st.pieces.find((x) => x.id === t.carrier);
      const thief = p ? ANIMAL_NAME[p.side][p.kind] : `${SIDE_NAME[otherSide(t.owner)]}`;
      text = `${thief} has it!`;
      state = 'carried';
    } else if (t.square && t.square !== t.home) {
      text = `Dropped on ${t.square}`;
      state = 'dropped';
    } else {
      text = 'Home';
      state = 'home';
    }
    el.dataset.state = state;
    el.title = `${SIDE_NAME[t.owner]}'s ${tr.name}: ${text}`;
    el.setAttribute('aria-label', el.title);
    el.setAttribute('role', 'img');
    el.replaceChildren(h('span', { class: 'mc-arena__ticon', 'aria-hidden': 'true', text: tr.icon }), h('span', { 'aria-hidden': 'true', text }));
  }

  private renderChip(st: ArenaState | null): void {
    this.chip.hidden = !st;
    if (!st) return;
    const parts: HTMLElement[] = [h('span', { class: 'mc-chip__item', text: `Round ${Math.min(st.round, st.maxRounds)} / ${st.maxRounds}` })];
    if (st.mode === 'sumo') {
      // The warning round: the ring wobbles and goes under at the end of it.
      const urgent = st.sinkingNext.length > 0 || (st.nextSinkIn !== null && st.nextSinkIn <= 1);
      if (st.nextSinkIn !== null || urgent) {
        parts.push(h('span', { class: `mc-chip__item mc-chip__sink${urgent ? ' is-urgent' : ''}` },
          h('span', { 'aria-hidden': 'true', text: '🌊 ' }), urgent ? 'Island sinks this round!' : `Island sinks in ${st.nextSinkIn}`));
      }
    } else {
      const lead = st.score.land === st.score.sea ? '' : st.score.land > st.score.sea ? 'land' : 'sea';
      parts.push(h('span', { class: 'mc-chip__item mc-chip__score', 'data-lead': lead, 'aria-label': `Land ${st.score.land}, Sea ${st.score.sea}, first to ${st.target}` },
        h('span', { 'data-side': 'land', text: `Land ${st.score.land}` }), h('span', { class: 'mc-chip__dash', text: ' – ' }),
        h('span', { 'data-side': 'sea', text: `${st.score.sea} Sea` }), h('small', { text: ` (to ${st.target})` })));
      if (st.nextWheelIn !== null) {
        parts.push(h('span', { class: `mc-chip__item${st.nextWheelIn <= 1 ? ' is-soon' : ''}`, title: 'Wheel of Chaos' },
          h('span', { 'aria-hidden': 'true', text: '🎡 ' }), st.nextWheelIn === 0 ? 'Wheel now' : `Wheel in ${st.nextWheelIn}`));
      }
    }
    this.chip.replaceChildren(...parts);
  }

  private renderBar(): void {
    const st = this.state;
    this.bar.hidden = !st || st.phase === 'over';
    if (!st || this.bar.hidden) return;
    const you = this.you();
    const human = you === null || you === st.turn;
    this.bar.dataset.side = st.turn;
    this.barWho.textContent = you === null ? `${SIDE_NAME[st.turn]}'s turn` : human ? 'Your turn' : `${this.nameOf(st.turn)}'s turn`;
    this.barDie.replaceChildren(...(st.die ? [dieFace(st.die)] : []));
    this.barDie.hidden = !st.die;
    if (st.die) this.barDie.title = `Rolled ${st.die}`;

    const total = Math.max(this.apTotal, st.ap);
    this.barAp.replaceChildren(
      ...Array.from({ length: total }, (_, i) => h('i', { class: i < st.ap ? 'on' : '' })),
      h('b', { text: `${st.ap} AP` }));
    this.barAp.setAttribute('aria-label', `${st.ap} of ${total} action points left`);

    const duel = st.phase === 'duel';
    const botTurn = !human;
    // At 0 AP core ends the turn by itself; before the roll there is nothing to end yet.
    this.endBtn.hidden = !human || duel || st.ap === 0;
    this.endBtn.disabled = this.ending;
    if (duel) this.barRight.replaceChildren(h('span', { class: 'mc-turnbar__note', text: '✊ Duel!' }));
    else if (botTurn || st.ap === 0) this.barRight.replaceChildren(botTurn && this.thinking ? h('span', { class: 'mc-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')) : h('span'));
    // Keep the same button node in place so keyboard focus stays on it between actions.
    else if (this.barRight.firstChild !== this.endBtn || this.barRight.childNodes.length !== 1) this.barRight.replaceChildren(this.endBtn);
  }

  dispose(): void {
    window.clearTimeout(this.endTimer);
  }
}
