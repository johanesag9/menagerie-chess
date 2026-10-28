/**
 * Phase 6, Sandcastle King: the draft picker (`askDraft`). A sheet near the bottom edge, like the Crazy questions:
 * your 6 animals as cards with their trait, the picks so far on both sides, and whose pick it is.
 * Keys 1–6 pick, arrows move, Tab stays inside. A pick is required (Esc goes to the pause menu as usual).
 */
import type { PieceKind, Side } from '../../contracts/types';
import { ANIMAL_NAME, SIDE_NAME } from '../config';
import type { UiCtx } from '../ctx';
import { h } from '../dom';
import { otherSide } from '../format';
import { animalIcon } from '../icons';
import { TRAIT_ORDER, TRAIT_TEXT } from '../boardText';

export interface DraftOpts {
  picks: Record<Side, PieceKind[]>;
  size: number;
  traits: Record<PieceKind, { name: string; line: string }>;
  hotSeat: boolean;
}

const ord = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n - 1] ?? `${n}th`;

export class DraftPicker {
  /** A full-size layer over the board; only the sheet takes clicks. */
  readonly el: HTMLElement;
  readonly sheet: HTMLElement;
  private resolve: ((k: PieceKind) => void) | null = null;
  private fallback: PieceKind = 'p';
  private prevFocus: HTMLElement | null = null;

  constructor(private ctx: UiCtx) {
    this.sheet = h('div', { class: 'mc-ask mc-draft', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-draft-h', hidden: true });
    this.el = h('div', { class: 'mc-stage mc-stage--draft' }, this.sheet);
    this.sheet.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return this.resolve !== null;
  }

  /** `you` is your side vs a bot or a friend online (null in a local game). */
  ask(side: Side, o: DraftOpts, you: Side | null): Promise<PieceKind> {
    this.cancel(); // a new question replaces an unanswered one
    const taken = new Set(o.picks[side]);
    const free = TRAIT_ORDER.filter((k) => !taken.has(k));
    this.fallback = free[0] ?? 'p';
    const mine = o.picks[side].length;
    const title = o.hotSeat || you === null ? `${SIDE_NAME[side]}, your pick` : 'Pick your animals';
    const sub = `Your ${ord(mine + 1)} of ${o.size}. Picks go Land, Sea, Land, Sea.`;

    const cards = TRAIT_ORDER.map((k, i) => {
      const t = o.traits[k] ?? TRAIT_TEXT[k];
      const picked = taken.has(k);
      const b = h('button', {
        type: 'button', class: 'mc-ask__opt mc-draft__opt', 'data-sfx': 'none', 'data-kind': k, disabled: picked, style: `--i:${i}`,
        'aria-label': `${ANIMAL_NAME[side][k]}, ${t.name}: ${t.line}${picked ? ' Already picked.' : ''}`,
      },
      h('span', { class: 'mc-draft__art', html: animalIcon(side, k, { disc: true }) }),
      h('span', { class: 'mc-draft__text' },
        h('span', { class: 'mc-ask__name', text: ANIMAL_NAME[side][k] }),
        h('span', { class: 'mc-draft__trait' }, h('span', { 'aria-hidden': 'true', text: `${TRAIT_TEXT[k].icon} ` }), t.name),
        h('span', { class: 'mc-ask__line', text: t.line })),
      picked ? h('span', { class: 'mc-draft__picked', text: 'Picked' }) : h('kbd', { text: String(i + 1) }));
      b.addEventListener('click', () => this.choose(k));
      return b;
    });

    this.sheet.dataset.side = side;
    this.sheet.replaceChildren(
      h('header', { class: 'mc-ask__head' },
        h('h2', { class: 'mc-ask__title', id: 'mc-draft-h', text: title }),
        h('p', { class: 'mc-ask__sub', text: sub })),
      this.picksRow(side, o),
      h('div', { class: 'mc-draft__grid' }, ...cards));
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.sheet.hidden = false;
    if (!this.ctx.settings.reducedMotion) {
      this.sheet.animate([{ transform: 'translate(-50%, 40px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,1.35,.4,1)' });
    }
    requestAnimationFrame(() => this.sheet.querySelector<HTMLElement>('.mc-draft__opt:not(:disabled)')?.focus({ preventScroll: true }));
    return new Promise((res) => (this.resolve = res));
  }

  /** Both sides' picks so far, with an empty slot for each pick to come. The slot being picked now glows. */
  private picksRow(side: Side, o: DraftOpts): HTMLElement {
    const row = (s: Side) => {
      const got = o.picks[s];
      const slots = Array.from({ length: o.size }, (_, i) => {
        const k = got[i];
        if (k) return h('span', { class: 'mc-draft__slot is-full', title: `${ANIMAL_NAME[s][k]} (${(o.traits[k] ?? TRAIT_TEXT[k]).name})`, html: animalIcon(s, k, { disc: true }) });
        return h('span', { class: `mc-draft__slot${s === side && i === got.length ? ' is-now' : ''}`, 'aria-hidden': 'true' });
      });
      const words = got.length ? got.map((k) => ANIMAL_NAME[s][k]).join(', ') : 'nothing yet';
      return h('div', { class: 'mc-draft__side', 'data-side': s, role: 'img', 'aria-label': `${SIDE_NAME[s]} has picked ${words}` },
        h('span', { class: 'mc-draft__who', text: SIDE_NAME[s] }), ...slots);
    };
    // Your side first.
    return h('div', { class: 'mc-draft__picks' }, row(side), row(otherSide(side)));
  }

  private onKey(e: KeyboardEvent): void {
    const n = Number(e.key);
    if (n >= 1 && n <= 6 && !e.metaKey && !e.ctrlKey) {
      const k = TRAIT_ORDER[n - 1];
      const b = this.sheet.querySelectorAll<HTMLButtonElement>('.mc-draft__opt')[n - 1];
      if (b && !b.disabled) {
        e.preventDefault();
        this.choose(k);
      }
      return;
    }
    const opts = Array.from(this.sheet.querySelectorAll<HTMLButtonElement>('.mc-draft__opt:not(:disabled)'));
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (step && i >= 0) {
      e.preventDefault();
      opts[(i + step + opts.length) % opts.length].focus();
    }
  }

  private choose(k: PieceKind): void {
    if (!this.resolve) return;
    const r = this.resolve;
    this.close();
    this.ctx.audio.play('draftPick');
    this.ctx.emit('draftPicked', { kind: k });
    r(k);
  }

  private close(): void {
    this.resolve = null;
    this.sheet.hidden = true;
    const f = this.prevFocus;
    this.prevFocus = null;
    if (f && f.isConnected && !this.sheet.contains(f)) f.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /**
   * Close an open question with a default answer, e.g. when the game ends or is left: the first free animal, or a random
   * free one (`random`, Phase 6 online: the room picked for you on a timeout and integration ignores this answer).
   */
  cancel(random = false): void {
    if (!this.resolve) return;
    const r = this.resolve;
    const free = Array.from(this.sheet.querySelectorAll<HTMLButtonElement>('.mc-draft__opt:not(:disabled)')).map((b) => b.dataset.kind as PieceKind);
    this.close();
    r(random && free.length ? free[Math.floor(Math.random() * free.length)] : this.fallback);
  }
}
