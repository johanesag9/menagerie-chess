/**
 * Crazy-mode overlays: the fate die, lucky choice, card draw and play (with the joker reveal), revive picker,
 * duel ask, jankenpon throws (with the hot-seat cover), duel rounds and the Wheel of Chaos.
 *
 * Shows (die, cards, duel round, wheel) are short, sit over the board without blocking it for long, and any
 * tap or Space/Enter/Esc skips them to the end. Questions are small sheets near the bottom edge that take focus,
 * work with keys (shown on the buttons) and touch, and keep Tab inside. Reduced motion swaps every move for a fade.
 */
import type { Card, DieEffect, DieValue, DuelInfo, GameEventMap, Hand, JokerOutcome, PieceId, PieceKind, PieceState, Side, WheelOutcome } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { otherSide } from '../format';
import { animalIcon } from '../icons';
import { DIE_TEXT, HAND, HANDS, JOKER_TEXT, LUCKY_TEXT, SUIT, WHEEL_ORDER, WHEEL_TEXT } from '../modeText';
import { cardFace, dieFace } from './modeHud';

type LuckyChoice = 'recharge' | 'pawnStep' | 'skip';

/** A skippable show: any tap or Space/Enter/Esc wakes every wait and jumps animations to their end. */
class Run {
  skipped = false;
  private wakers = new Set<() => void>();
  private anims: Animation[] = [];

  constructor() {
    document.addEventListener('pointerdown', this.onPointer, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  private onPointer = () => this.skip();
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // Esc skips the show instead of opening the pause menu
    this.skip();
  };

  skip(): void {
    this.skipped = true;
    this.anims.forEach(finish);
    this.anims = [];
    this.wakers.forEach((w) => w());
    this.wakers.clear();
  }

  /** An animation that a skip jumps to the end (at once, if already skipped). */
  anim(a: Animation): Animation {
    if (this.skipped) finish(a);
    else this.anims.push(a);
    return a;
  }

  /** Resolves after `ms`, or at the next skip. After a skip, holds are short so the result still reads. */
  wait(ms: number): Promise<void> {
    return new Promise((res) => {
      const done = () => {
        window.clearTimeout(t);
        this.wakers.delete(done);
        res();
      };
      const t = window.setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  hold(ms: number): Promise<void> {
    return this.wait(this.skipped ? Math.min(ms, 450) : ms);
  }

  end(): void {
    document.removeEventListener('pointerdown', this.onPointer, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.wakers.forEach((w) => w());
  }
}

function finish(a: Animation): void {
  try {
    a.finish();
  } catch {
    /* an infinite or already-cancelled animation */
  }
}

const SPRING = 'cubic-bezier(.2,1.35,.4,1)';

export interface ChaosHooks {
  /** Kind of a piece by id (for names in duels). */
  kindOf(id: PieceId): PieceKind | null;
  /** Where a side's cards sit on screen, for the fly-in and fly-out. */
  handRect(side: Side): DOMRect | null;
}

export class Chaos {
  readonly el: HTMLElement;
  private sheet: HTMLElement;
  private cover: HTMLElement;
  private coverTimer = 0;
  /** The open question, for the Tab trap. */
  dialog: HTMLElement | null = null;
  private cancelDialog: (() => void) | null = null;
  private prevFocus: HTMLElement | null = null;
  private runs = new Set<Run>();

  constructor(private ctx: UiCtx, private hooks: ChaosHooks) {
    this.sheet = h('div', { class: 'mc-ask', role: 'dialog', 'aria-modal': 'true', hidden: true });
    this.cover = h('div', { class: 'mc-cover', role: 'dialog', 'aria-modal': 'true', hidden: true });
    this.el = h('div', { class: 'mc-stage' }, this.sheet, this.cover);
  }

  private get rm(): boolean {
    return this.ctx.settings.reducedMotion;
  }

  /** The human side vs the bot; null in a local game. */
  private you(): Side | null {
    const o = this.ctx.gameInfo?.opponent;
    return o?.type === 'bot' ? otherSide(o.botSide) : null;
  }

  private startRun(): Run {
    const r = new Run();
    this.runs.add(r);
    return r;
  }

  private endRun(r: Run, ...els: HTMLElement[]): void {
    r.end();
    this.runs.delete(r);
    for (const el of els) {
      const out = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.rm ? 120 : 220, easing: 'ease-in', fill: 'forwards' });
      const kill = () => el.remove();
      out.onfinish = kill;
      window.setTimeout(kill, 400); // background tabs can stall animations
    }
  }

  // ---------- Die ----------

  async rollDie(side: Side, value: DieValue, effect: DieEffect): Promise<void> {
    const r = this.startRun();
    const t = DIE_TEXT(value);
    const cube = h('div', { class: 'mc-die__cube' });
    // Opposite faces add up to 7. Each face's rotation brings it to the front.
    const faces: [DieValue, string][] = [[1, 'rotateY(0deg)'], [6, 'rotateY(180deg)'], [3, 'rotateY(90deg)'], [4, 'rotateY(-90deg)'], [2, 'rotateX(90deg)'], [5, 'rotateX(-90deg)']];
    for (const [v, rot] of faces) cube.append(h('span', { class: 'mc-die__face', style: `transform:${rot} translateZ(var(--half))` }, dieFace(v)));
    const front: Record<DieValue, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
    const [fx, fy] = front[value];
    const call = h('strong', { class: 'mc-dieroll__call', text: t.call });
    const line = h('span', { class: 'mc-dieroll__line', text: t.line });
    const el = h('div', { class: 'mc-dieroll', 'data-side': side, 'data-effect': effect, 'data-loud': String(t.loud), role: 'status', 'aria-label': `${SIDE_NAME[side]} rolled ${value}. ${t.loud ? t.call + ' ' + t.line : ''}` },
      h('div', { class: 'mc-die__view' }, cube),
      h('div', { class: 'mc-dieroll__text' }, call, line));
    this.el.append(el);
    this.ctx.audio.play('dieRoll');

    const end = `rotateX(${fx + 720}deg) rotateY(${fy + 720}deg) rotateZ(360deg)`;
    if (this.rm) {
      cube.style.transform = end;
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
      await r.wait(180);
    } else {
      const rx = Math.round(Math.random() * 120 - 60), ry = Math.round(Math.random() * 120 - 60);
      r.anim(el.animate([{ transform: 'translate(-50%, -40px) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { duration: 260, easing: 'ease-out', fill: 'both' }));
      r.anim(cube.animate([
        { transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(0deg) translateY(-60px)` },
        { transform: `rotateX(${fx + 500}deg) rotateY(${fy + 520}deg) rotateZ(250deg) translateY(0)`, offset: 0.55 },
        { transform: `rotateX(${fx + 700}deg) rotateY(${fy + 700}deg) rotateZ(350deg) translateY(-14px)`, offset: 0.78 },
        { transform: `${end} translateY(0)` },
      ], { duration: 820, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'forwards' }));
      await r.wait(820);
    }
    cube.style.transform = end;
    el.classList.add('is-landed');
    if (effect === 'banana') this.ctx.audio.play('dieBanana');
    else if (effect === 'lucky') this.ctx.audio.play('dieLucky');
    if (!this.rm) r.anim(call.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: SPRING }));
    await r.hold(t.loud ? 900 : 380);
    this.endRun(r, el);
  }

  // ---------- Cards ----------

  private bigCard(card: Card, extra?: HTMLElement): { el: HTMLElement; inner: HTMLElement; front: HTMLElement } {
    const front = h('div', { class: 'mc-bigcard__front' }, cardFace(card));
    if (extra) front.append(extra);
    const inner = h('div', { class: 'mc-bigcard__inner' }, front, h('div', { class: 'mc-bigcard__back', 'aria-hidden': 'true' }, h('span', { text: '?' })));
    return { el: h('div', { class: 'mc-bigcard', 'data-suit': card.suit }, inner), inner, front };
  }

  /** Centre of a rect relative to the stage. */
  private rel(rect: DOMRect | null): { x: number; y: number; s: number } | null {
    if (!rect || !rect.width) return null;
    const st = this.el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - st.left - st.width / 2, y: rect.top + rect.height / 2 - st.top - st.height * 0.4, s: Math.max(0.25, Math.min(0.7, rect.height / 150)) };
  }

  async showCardDrawn(side: Side, card: Card): Promise<void> {
    const r = this.startRun();
    const s = SUIT[card.suit];
    const big = this.bigCard(card);
    const cap = h('p', { class: 'mc-cardshow__cap' }, h('strong', { text: `${SIDE_NAME[side]} draws` }), h('span', { text: ` ${s.symbol} ${s.name}` }));
    const el = h('div', { class: 'mc-cardshow mc-cardshow--draw', 'data-side': side, role: 'status', 'aria-label': `${SIDE_NAME[side]} draws a card: ${s.name}` }, big.el, cap);
    this.el.append(el);
    this.ctx.audio.play('cardDraw');
    if (this.rm) {
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }));
      await r.hold(650);
      this.endRun(r, el);
      return;
    }
    r.anim(big.inner.animate([{ transform: 'rotateY(180deg) scale(.4)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 460, easing: SPRING, fill: 'both' }));
    r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'both' }));
    await r.wait(460);
    await r.hold(420);
    const to = this.rel(this.hooks.handRect(side));
    cap.remove();
    if (to) {
      r.anim(big.el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${to.x}px, ${to.y}px) scale(${to.s}) rotate(${side === 'land' ? -8 : 8}deg)`, opacity: 0.3 }],
        { duration: 420, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' }));
      await r.wait(420);
    }
    this.endRun(r, el);
  }

  async showCardPlayed(side: Side, card: Card, joker?: JokerOutcome): Promise<void> {
    const r = this.startRun();
    const s = SUIT[card.suit];
    const big = this.bigCard(card);
    const cap = h('p', { class: 'mc-cardshow__cap' }, h('strong', { text: `${SIDE_NAME[side]} plays ${s.symbol} ${s.name}` }), h('span', { class: 'mc-cardshow__line', text: s.line }));
    const el = h('div', { class: 'mc-cardshow', 'data-side': side, role: 'status', 'aria-label': `${SIDE_NAME[side]} plays ${s.name}. ${joker ? JOKER_TEXT[joker].name + ' ' + JOKER_TEXT[joker].line : s.line}` }, big.el, cap);
    this.el.append(el);
    this.ctx.audio.play('cardPlay');
    const from = this.rel(this.hooks.handRect(side));
    if (this.rm) {
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }));
    } else {
      const start = from ? `translate(${from.x}px, ${from.y}px) scale(${from.s})` : 'translateY(60px) scale(.5)';
      r.anim(big.el.animate([{ transform: start }, { transform: 'none' }], { duration: 420, easing: SPRING, fill: 'both' }));
      r.anim(big.inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0)' }], { duration: 420, easing: 'ease-out', fill: 'both' }));
      r.anim(cap.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 240, fill: 'both' }));
      await r.wait(420);
    }
    if (card.suit === 'joker' && joker) {
      // Drumroll while the joker shakes, then flip to the outcome.
      this.ctx.audio.play('joker');
      cap.querySelector('.mc-cardshow__line')!.textContent = 'And the wild effect is…';
      if (!this.rm) r.anim(big.el.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg) scale(1.04)' }, { transform: 'rotate(7deg) scale(1.08)' }, { transform: 'rotate(-5deg) scale(1.06)' }, { transform: 'rotate(0) scale(1)' }],
        { duration: 760, easing: 'ease-in-out' }));
      await r.wait(this.rm ? 400 : 760);
      const j = JOKER_TEXT[joker];
      const reveal = () => {
        big.front.replaceChildren(h('span', { class: 'mc-bigcard__joker' }, h('span', { class: 'mc-bigcard__jicon', text: j.icon }), h('span', { text: j.name })));
        cap.replaceChildren(h('strong', { text: `Joker: ${j.name}` }), h('span', { class: 'mc-cardshow__line', text: j.line }));
        el.classList.add('is-revealed');
      };
      if (this.rm) reveal();
      else {
        // A timer, not .finished: background tabs can stall animations.
        r.anim(big.inner.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }));
        await r.wait(140);
        reveal();
        r.anim(big.inner.animate([{ transform: 'rotateY(-90deg) scale(1.1)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 320, easing: SPRING, fill: 'forwards' }));
      }
      await r.hold(1300);
    } else {
      await r.hold(1000);
    }
    this.endRun(r, el);
  }

  // ---------- Questions ----------

  /**
   * Open a question sheet (or the cover). Esc, if allowed, answers `onEscape`. `cancel` gives the question its
   * default answer when another question replaces it; asking again with the same `cancel` just swaps the content.
   */
  private ask(host: HTMLElement, content: HTMLElement[], label: string, onEscape: (() => void) | null, keys: Record<string, () => void>, cancel: () => void): void {
    const prev = this.cancelDialog;
    this.cancelDialog = null;
    if (prev && prev !== cancel) prev();
    this.cancelDialog = cancel;
    this.prevFocus = this.prevFocus ?? (document.activeElement as HTMLElement | null);
    host.replaceChildren(...content);
    host.setAttribute('aria-label', label);
    host.hidden = false;
    host.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't open the pause menu
        e.preventDefault();
        onEscape?.();
        return;
      }
      const k = keys[e.key.toLowerCase()];
      if (k && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        k();
        return;
      }
      const opts = Array.from(host.querySelectorAll<HTMLButtonElement>('.mc-ask__opt:not(:disabled)'));
      const i = opts.indexOf(document.activeElement as HTMLButtonElement);
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (step && i >= 0) {
        e.preventDefault();
        opts[(i + step + opts.length) % opts.length].focus();
      }
    };
    this.dialog = host;
    if (!this.rm && host === this.sheet) host.animate([{ transform: 'translate(-50%, 40px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 320, easing: SPRING });
    requestAnimationFrame(() => (host.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ?? host.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true }));
  }

  private closeAsk(host: HTMLElement): void {
    this.cancelDialog = null;
    this.dialog = null;
    host.onkeydown = null;
    if (host === this.sheet) host.hidden = true;
    const f = this.prevFocus;
    this.prevFocus = null;
    if (f && f.isConnected && !host.contains(f)) f.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** One option button for a sheet. */
  private opt(o: { icon: string; name: string; line?: string; kbd?: string; disabled?: boolean; primary?: boolean; html?: boolean }, onPick: () => void): HTMLButtonElement {
    const b = h('button', { type: 'button', class: `mc-ask__opt${o.primary ? ' is-primary' : ''}`, 'data-sfx': 'click', disabled: o.disabled });
    b.append(h('span', { class: 'mc-ask__icon', 'aria-hidden': 'true', ...(o.html ? { html: o.icon } : { text: o.icon }) }),
      h('span', { class: 'mc-ask__name', text: o.name }));
    if (o.line) b.append(h('span', { class: 'mc-ask__line', text: o.line }));
    if (o.kbd) b.append(h('kbd', { text: o.kbd }));
    b.addEventListener('click', onPick);
    return b;
  }

  private head(title: string, sub: string, side: Side): HTMLElement {
    this.sheet.dataset.side = side;
    return h('header', { class: 'mc-ask__head' }, h('h2', { class: 'mc-ask__title', text: title }), h('p', { class: 'mc-ask__sub', text: sub }));
  }

  askLucky(side: Side, opts: { canRecharge: boolean; canStep: boolean }): Promise<LuckyChoice> {
    return new Promise((res) => {
      const pick = (c: LuckyChoice) => {
        this.closeAsk(this.sheet);
        res(c);
      };
      const who = this.you() === side ? 'You rolled a 6' : `${SIDE_NAME[side]} rolled a 6`;
      this.ask(this.sheet, [
        this.head('🍀 Lucky!', `${who}. Take a bonus before you act?`, side),
        h('div', { class: 'mc-ask__opts' },
          this.opt({ icon: LUCKY_TEXT.recharge.icon, name: LUCKY_TEXT.recharge.name, line: opts.canRecharge ? LUCKY_TEXT.recharge.line : LUCKY_TEXT.recharge.off, kbd: '1', disabled: !opts.canRecharge }, () => pick('recharge')),
          this.opt({ icon: LUCKY_TEXT.pawnStep.icon, name: LUCKY_TEXT.pawnStep.name, line: opts.canStep ? LUCKY_TEXT.pawnStep.line : LUCKY_TEXT.pawnStep.off, kbd: '2', disabled: !opts.canStep }, () => pick('pawnStep'))),
        h('div', { class: 'mc-ask__foot' }, button('Skip', { variant: 'ghost', class: 'mc-btn--sm', sfx: 'back', onClick: () => pick('skip') })),
      ], 'Lucky bonus', () => pick('skip'), {
        '1': () => opts.canRecharge && pick('recharge'),
        '2': () => opts.canStep && pick('pawnStep'),
      }, () => pick('skip'));
    });
  }

  askRevive(side: Side, pieces: PieceState[]): Promise<PieceId | null> {
    if (!pieces.length) return Promise.resolve(null);
    return new Promise((res) => {
      const pick = (id: PieceId | null) => {
        this.closeAsk(this.sheet);
        res(id);
      };
      // One button per kind ("Crab ×3"): same-kind animals come back the same way.
      const order: PieceKind[] = ['q', 'r', 'b', 'n', 'p'];
      const groups = order.map((k) => pieces.filter((p) => p.kind === k)).filter((g) => g.length);
      this.ask(this.sheet, [
        this.head('♥ Revive', 'Who comes back? A pawn returns on your 2nd rank, others on your back rank.', side),
        h('div', { class: 'mc-ask__opts mc-ask__opts--grid' },
          ...groups.map((g) => this.opt({ icon: animalIcon(side, g[0].kind, { disc: true }), html: true, name: ANIMAL_NAME[side][g[0].kind], line: g.length > 1 ? `×${g.length}` : undefined }, () => pick(g[0].id)))),
        h('div', { class: 'mc-ask__foot' }, button('Cancel', { variant: 'ghost', class: 'mc-btn--sm', sfx: 'back', onClick: () => pick(null) })),
      ], 'Revive: pick an animal', () => pick(null), {}, () => pick(null));
    });
  }

  askDuel(info: DuelInfo): Promise<boolean> {
    return new Promise((res) => {
      const pick = (call: boolean) => {
        this.closeAsk(this.sheet);
        if (call) this.ctx.audio.play('duelCall');
        res(call);
      };
      const ak = this.hooks.kindOf(info.attackerId) ?? 'p';
      const vk = this.hooks.kindOf(info.victimId) ?? 'p';
      const att = ANIMAL_NAME[info.attacker][ak];
      const vic = ANIMAL_NAME[info.defender][vk];
      const n = info.tokensLeft;
      const verb = info.via === 'doubleJump' ? 'double-jumps at' : 'wants to bonk';
      const whose = this.you() === info.defender ? 'your' : `${SIDE_NAME[info.defender]}'s`;
      const call = this.opt({ icon: '✊', name: 'Duel!', line: `Uses 1 of ${n} token${n === 1 ? '' : 's'}`, kbd: 'Y', primary: true }, () => pick(true));
      call.dataset.autofocus = '';
      this.ask(this.sheet, [
        this.head(this.you() === info.defender || this.you() === null ? `${SIDE_NAME[info.defender]}, call a duel?` : 'Call a duel?',
          `${SIDE_NAME[info.attacker]}'s ${att} ${verb} ${whose} ${vic}!`, info.defender),
        h('div', { class: 'mc-ask__vs', 'aria-hidden': 'true' },
          h('span', { class: 'mc-ask__face', html: animalIcon(info.attacker, ak, { disc: true }) }),
          h('span', { class: 'mc-ask__vstext', text: 'VS' }),
          h('span', { class: 'mc-ask__face', html: animalIcon(info.defender, vk, { disc: true }) })),
        h('p', { class: 'mc-ask__hint', text: `Win rock-paper-scissors and the ${att} is bonked back. (${n} token${n === 1 ? '' : 's'} left)` }),
        h('div', { class: 'mc-ask__opts' }, call, this.opt({ icon: '🤷', name: 'Let it go', line: `The ${vic} is taken`, kbd: 'N' }, () => pick(false))),
      ], 'Call a duel?', () => pick(false), { y: () => pick(true), n: () => pick(false) }, () => pick(false));
    });
  }

  askThrow(side: Side, opts: { hotSeat: boolean }): Promise<Hand> {
    return new Promise((res) => {
      window.clearTimeout(this.coverTimer);
      const host = opts.hotSeat ? this.cover : this.sheet;
      const keys: Record<string, () => void> = {};
      const picker = () => h('div', { class: 'mc-ask__opts mc-ask__opts--hands' }, ...HANDS.map((hd) => {
        keys[HAND[hd].key] = () => done(hd);
        return this.opt({ icon: HAND[hd].icon, name: HAND[hd].name, kbd: HAND[hd].key.toUpperCase() }, () => done(hd));
      }));
      const done = async (hd: Hand) => {
        this.cancelDialog = null;
        if (opts.hotSeat) {
          // Cover again so the next player can't see the pick.
          this.cover.replaceChildren(h('div', { class: 'mc-cover__card' }, h('p', { class: 'mc-cover__big', text: '🔒 Locked in!' }), h('p', { text: 'No peeking. Pass the device back.' })));
          await new Promise((r) => window.setTimeout(r, this.rm ? 350 : 650));
          this.closeAsk(this.cover);
          this.coverTimer = window.setTimeout(() => this.hideCover(), 250); // another throw may reuse the cover
        } else {
          this.closeAsk(this.sheet);
        }
        res(hd);
      };
      const cancel = () => {
        this.closeAsk(host);
        if (opts.hotSeat) this.hideCover();
        res(HANDS[Math.floor(Math.random() * 3)]);
      };
      const title = 'Rock, paper, scissors!';
      if (!opts.hotSeat) {
        this.ask(this.sheet, [this.head(title, this.you() === side ? 'Pick your hand. It stays secret.' : `${SIDE_NAME[side]}, pick your hand.`, side), picker()], title, null, keys, cancel);
        return;
      }
      // Hot seat: cover, ask the right player to take the device, then the picker.
      this.cover.dataset.side = side;
      this.cover.hidden = false;
      const ready = button(`I'm ${SIDE_NAME[side]}, show me`, { variant: side === 'sea' ? 'sea' : 'primary', class: 'mc-btn--xl' });
      ready.addEventListener('click', () => this.ask(this.cover, [h('div', { class: 'mc-cover__card' }, h('p', { class: 'mc-cover__big', text: `${SIDE_NAME[side]}: ${title}` }), picker())], title, null, keys, cancel));
      if (!this.rm) this.cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      this.ask(this.cover, [h('div', { class: 'mc-cover__card' },
        h('p', { class: 'mc-cover__big', text: `${SIDE_NAME[side]}, take the device` }),
        h('p', { text: `${SIDE_NAME[otherSide(side)]}, look away! 🙈` }),
        ready)], `${SIDE_NAME[side]}, take the device`, null, {}, cancel);
    });
  }

  private hideCover(): void {
    if (this.dialog === this.cover) return;
    this.cover.hidden = true;
    this.cover.replaceChildren();
  }

  // ---------- Duel round ----------

  async showDuelRound(d: GameEventMap['duelRound']): Promise<void> {
    const r = this.startRun();
    const { info } = d;
    const hands: Record<Side, Hand> = { land: 'rock', sea: 'rock' };
    hands[info.attacker] = d.attackerHand;
    hands[info.defender] = d.defenderHand;
    const winner: Side | null = d.result === 'tie' ? null : d.result === 'attacker' ? info.attacker : info.defender;
    const you = this.you();
    const sideEl = (s: Side) => h('div', { class: `mc-duel__hand${winner === s ? ' is-win' : winner ? ' is-lose' : ''}`, 'data-side': s },
      h('span', { class: 'mc-duel__emoji', text: HAND[hands[s]].icon }),
      h('span', { class: 'mc-duel__who', text: `${you === s ? 'You' : SIDE_NAME[s]} · ${HAND[hands[s]].name}` }));
    const L = sideEl('land'), S = sideEl('sea');
    const callText = winner === null ? 'Tie! Again!' : `${you === winner ? 'You win' : `${SIDE_NAME[winner]} wins`} the throw!`;
    const call = h('strong', { class: 'mc-duel__call', text: callText });
    const el = h('div', { class: 'mc-duel', 'data-result': d.result, role: 'status', 'aria-label': `Throw ${d.round}: Land ${HAND[hands.land].name}, Sea ${HAND[hands.sea].name}. ${callText}` },
      h('span', { class: 'mc-duel__round', text: `Throw ${d.round}` }),
      h('div', { class: 'mc-duel__row' }, L, h('span', { class: 'mc-duel__vs', text: 'VS' }), S), call);
    this.el.append(el);
    if (this.rm) {
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }));
      await r.wait(150);
    } else {
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'both' }));
      r.anim(L.animate([{ transform: 'translateX(-140%) rotate(-40deg)' }, { transform: 'translateX(12%) rotate(8deg)', offset: 0.8 }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'both' }));
      r.anim(S.animate([{ transform: 'translateX(140%) rotate(40deg)' }, { transform: 'translateX(-12%) rotate(-8deg)', offset: 0.8 }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'both' }));
      r.anim(call.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 360, delay: 360, easing: SPRING, fill: 'both' }));
      await r.wait(330);
    }
    this.ctx.audio.play('duelThrow');
    if (!this.rm) r.anim(el.animate([{ transform: 'translate(-50%, -50%)' }, { transform: 'translate(calc(-50% + 5px), -50%)' }, { transform: 'translate(calc(-50% - 4px), -50%)' }, { transform: 'translate(-50%, -50%)' }], { duration: 220 }));
    el.classList.add('is-hit');
    if (winner) {
      window.setTimeout(() => this.ctx.audio.play(you === null || you === winner ? 'duelWin' : 'duelLose'), r.skipped ? 0 : 200);
    }
    await r.hold(winner ? 900 : 700);
    this.endRun(r, el);
  }

  // ---------- Wheel of Chaos ----------

  async spinWheel(outcome: WheelOutcome): Promise<void> {
    const r = this.startRun();
    const i = WHEEL_ORDER.indexOf(outcome);
    const t = WHEEL_TEXT[outcome];
    const stops = WHEEL_ORDER.map((o, k) => `${WHEEL_TEXT[o].color} ${k * 90}deg ${(k + 1) * 90}deg`).join(', ');
    const disc = h('div', { class: 'mc-wheel__disc', style: `background: conic-gradient(${stops})` },
      ...WHEEL_ORDER.map((o, k) => h('span', { class: `mc-wheel__label${o === outcome ? ' is-pick' : ''}`, style: `--a:${k * 90 + 45}deg` },
        h('span', { class: 'mc-wheel__icon', text: WHEEL_TEXT[o].icon }), h('span', { text: WHEEL_TEXT[o].name.replace('!', '') }))),
      ...Array.from({ length: 8 }, (_, k) => h('i', { class: 'mc-wheel__peg', style: `--a:${k * 45}deg` })));
    const pointer = h('span', { class: 'mc-wheel__pointer', 'aria-hidden': 'true' });
    const cap = h('p', { class: 'mc-wheel__cap' }, h('strong', { text: t.name }), h('span', { text: t.line }));
    const el = h('div', { class: 'mc-wheel', role: 'status', 'aria-label': `Wheel of Chaos: ${t.name} ${t.line}` },
      h('span', { class: 'mc-wheel__title', text: 'Wheel of Chaos' }),
      h('div', { class: 'mc-wheel__body' }, disc, pointer, h('span', { class: 'mc-wheel__hub', 'aria-hidden': 'true', text: '🎡' })), cap);
    this.el.append(el);
    // Land the middle of the slice under the pointer (top), give or take a little.
    const final = 360 * 5 - (i * 90 + 45) + Math.round(Math.random() * 50 - 25);
    if (this.rm) {
      disc.style.transform = `rotate(${final}deg)`;
      r.anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
      await r.wait(300);
    } else {
      r.anim(el.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], { duration: 320, easing: SPRING, fill: 'both' }));
      await this.spin(r, disc, pointer, final, 2100);
    }
    this.ctx.audio.play('wheelStop');
    el.classList.add('is-stopped');
    if (!this.rm) r.anim(cap.animate([{ opacity: 0, transform: 'translateY(10px) scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: SPRING, fill: 'both' }));
    await r.hold(1300);
    this.endRun(r, el);
  }

  /** Spin by hand (rAF) so each peg passing the pointer can tick. A skip or a stalled tab jumps to the end. */
  private spin(r: Run, disc: HTMLElement, pointer: HTMLElement, final: number, ms: number): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      let lastPeg = 0;
      let raf = 0;
      const ease = (x: number) => 1 - Math.pow(1 - x, 3.4);
      const stop = () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(fallback);
        disc.style.transform = `rotate(${final}deg)`;
        res();
      };
      const frame = (now: number) => {
        const x = Math.min(1, (now - t0) / ms);
        const a = final * ease(x);
        disc.style.transform = `rotate(${a}deg)`;
        const peg = Math.floor(a / 45);
        if (peg !== lastPeg) {
          lastPeg = peg;
          this.ctx.audio.play('wheelSpin', { rate: 0.9 + 0.3 * (1 - x) });
          pointer.animate([{ transform: 'translateX(-50%) rotate(-22deg)' }, { transform: 'translateX(-50%) rotate(0)' }], { duration: 120, easing: 'ease-out' });
        }
        if (x >= 1 || r.skipped) stop();
        else raf = requestAnimationFrame(frame);
      };
      const fallback = window.setTimeout(stop, ms + 400);
      void r.wait(ms + 1000).then(() => r.skipped && stop());
      raf = requestAnimationFrame(frame);
    });
  }

  /** Skip every running show (e.g. the game was left). Open questions get their safe default. */
  reset(): void {
    this.runs.forEach((r) => r.skip());
    this.cancelDialog?.();
    window.clearTimeout(this.coverTimer);
    this.cover.hidden = true;
    this.sheet.hidden = true;
  }

  dispose(): void {
    this.reset();
    this.runs.forEach((r) => r.end());
  }
}
