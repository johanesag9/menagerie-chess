/** Pause, result and the promotion picker: dialogs that sit over the game. */
import type { GameOver, PieceKind, Side } from '../../contracts/types';
import { ANIMAL_NAME, PROMOTION_KINDS, REASON_TEXT, SIDE_NAME, botName } from '../config';
import type { UiCtx, View } from '../ctx';
import { button, h } from '../dom';
import { animalIcon } from '../icons';

type PromoKind = Exclude<PieceKind, 'p' | 'k'>;

/** An inline "are you sure?" swap: the button row is replaced by a question and two buttons. */
function confirmRow(question: string, yes: string, onYes: () => void, onNo: () => void): HTMLElement {
  const no = button('Keep playing', { sfx: 'back', onClick: onNo });
  const row = h('div', { class: 'mc-confirm', role: 'group', 'aria-label': question },
    h('p', { text: question }),
    h('div', { class: 'mc-confirm__btns' }, no, button(yes, { variant: 'danger', onClick: onYes })));
  queueMicrotask(() => no.focus());
  return row;
}

export function pauseScreen(ctx: UiCtx, moveCount: () => number): View {
  const resume = button('Resume', { variant: 'primary', onClick: () => ctx.show('game') });
  const undo = button('Undo move', { onClick: () => { ctx.emit('undo', {}); ctx.show('game'); } });
  const list = h('div', { class: 'mc-stack' });
  const actions = () => [
    resume,
    undo,
    h('div', { class: 'mc-stack__row' },
      button('Settings', { onClick: () => ctx.show('settings') }),
      button('Customize', { onClick: () => ctx.show('customize') })),
    h('div', { class: 'mc-stack__row' },
      button('Resign', { variant: 'ghost', onClick: () => ask('Resign this game?', 'Resign', () => { ctx.emit('resign', {}); ctx.show('game'); }) }),
      button('Quit to title', { variant: 'ghost', onClick: () => ask('Quit this game?', 'Quit', () => ctx.show('title')) })),
  ];
  function render() {
    list.replaceChildren(...actions());
  }
  function ask(q: string, yes: string, onYes: () => void) {
    list.replaceChildren(confirmRow(q, yes, onYes, () => { render(); resume.focus(); }));
  }
  const el = h('section', { class: 'mc-screen mc-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-pause-h' },
    h('div', { class: 'mc-panel mc-panel--narrow' },
      h('h2', { id: 'mc-pause-h', class: 'mc-panel__title', text: 'Paused' }),
      list));
  return {
    el,
    onShow: () => {
      render();
      undo.disabled = moveCount() === 0;
      undo.hidden = ctx.gameInfo?.mode === 'crazy'; // no undo in Crazy
    },
    focusTarget: () => resume,
  };
}

export class ResultView implements View {
  readonly el: HTMLElement;
  private title = h('h2', { id: 'mc-result-h', class: 'mc-result__title' });
  private sub = h('p', { class: 'mc-result__sub' });
  private art = h('div', { class: 'mc-result__art', 'aria-hidden': 'true' });
  private confetti = h('div', { class: 'mc-confetti', 'aria-hidden': 'true' });
  private rematch: HTMLButtonElement;

  constructor(private ctx: UiCtx) {
    this.rematch = button('Rematch', { variant: 'primary', onClick: () => { ctx.emit('rematch', {}); ctx.show('game'); } });
    this.el = h('section', { class: 'mc-screen mc-overlay mc-result', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-result-h', 'aria-describedby': 'mc-result-sub' },
      this.confetti,
      h('div', { class: 'mc-panel mc-panel--narrow' },
        this.art, this.title, this.sub,
        h('div', { class: 'mc-stack' },
          this.rematch,
          h('div', { class: 'mc-stack__row' },
            button('New game', { onClick: () => ctx.show('setup') }),
            button('Title', { sfx: 'back', onClick: () => ctx.show('title') })))));
    this.sub.id = 'mc-result-sub';
  }

  set(r: GameOver): void {
    const bot = this.ctx.gameInfo?.opponent.type === 'bot' ? this.ctx.gameInfo.opponent : null;
    const reason = REASON_TEXT[r.reason];
    let title: string;
    let mood: 'win' | 'lose' | 'draw';
    if (r.winner === null) {
      title = r.reason === 'stalemate' ? 'Stalemate!' : "It's a draw";
      mood = 'draw';
    } else if (bot) {
      const youWon = r.winner !== bot.botSide;
      title = youWon ? 'You win!' : `${botName(bot.level)} wins`;
      mood = youWon ? 'win' : 'lose';
    } else {
      title = `${SIDE_NAME[r.winner]} wins!`;
      mood = 'win';
    }
    this.title.textContent = title;
    this.sub.textContent = r.winner === null
      ? r.reason === 'stalemate' ? 'No legal moves, but no check either.' : reason
      : `${SIDE_NAME[r.winner]} wins ${reason}.`;
    this.el.dataset.mood = mood;
    const w: Side = r.winner ?? 'land';
    this.art.innerHTML = r.winner === null
      ? animalIcon('land', 'k', { disc: true }) + animalIcon('sea', 'k', { disc: true })
      : animalIcon(w, 'k', { disc: true });
    // Crazy: the bonked king lies dizzy beside the winner.
    if (r.reason === 'kingCaptured' && r.winner) this.art.append(h('span', { class: 'mc-result__bonked', html: animalIcon(r.winner === 'land' ? 'sea' : 'land', 'k', { disc: true }) }, h('span', { class: 'mc-result__stars', text: '💫' })));
    this.el.dataset.reason = r.reason;
    this.confetti.replaceChildren();
    if (mood === 'win' && !this.ctx.settings.reducedMotion) {
      const colors = ['#f2b544', '#6fd6cf', '#e5604d', '#8cc152', '#fff3d6', '#9b6fc9'];
      for (let i = 0; i < 36; i++) {
        this.confetti.append(h('i', { style: `--x:${Math.random() * 100}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colors[i % colors.length]};--s:${(0.7 + Math.random() * 0.6).toFixed(2)}` }));
      }
    }
    this.ctx.audio.play(r.winner === null ? 'draw' : 'checkmate');
  }

  focusTarget(): HTMLElement {
    return this.rematch;
  }
}

/** Four big choices. Resolves the pending promise; Q/R/B/N keys work too. */
export class PromotionPicker {
  readonly el: HTMLElement;
  private grid = h('div', { class: 'mc-promo__grid' });
  private resolve: ((k: PromoKind) => void) | null = null;
  private prevFocus: HTMLElement | null = null;

  constructor(private ctx: UiCtx) {
    this.el = h('div', { class: 'mc-promo', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-promo-h', hidden: true },
      h('div', { class: 'mc-panel mc-panel--promo' },
        h('h2', { id: 'mc-promo-h', class: 'mc-panel__title', text: 'Promote your pawn' }),
        h('p', { class: 'mc-row__hint', text: 'Pick who it becomes.' }),
        this.grid));
    this.el.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase() as PromoKind;
      if ((PROMOTION_KINDS as readonly string[]).includes(k)) {
        e.preventDefault();
        this.choose(k);
      }
      if (e.key === 'Escape') e.stopPropagation(); // a choice is required
      const btns = Array.from(this.grid.children) as HTMLElement[];
      const i = btns.indexOf(document.activeElement as HTMLElement);
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (step && i >= 0) {
        e.preventDefault();
        btns[(i + step + btns.length) % btns.length].focus();
      }
    });
  }

  get open(): boolean {
    return this.resolve !== null;
  }

  ask(side: Side): Promise<PromoKind> {
    this.resolve?.('q'); // a new question replaces an unanswered one
    this.el.dataset.side = side;
    this.grid.replaceChildren(...PROMOTION_KINDS.map((k, i) =>
      h('button', { type: 'button', class: 'mc-promo__opt', 'data-sfx': 'click', style: `--i:${i}`, 'aria-label': `${ANIMAL_NAME[side][k]} (${k.toUpperCase()})`, onclick: () => this.choose(k) },
        h('span', { class: 'mc-promo__art', html: animalIcon(side, k, { disc: true }) }),
        h('span', { class: 'mc-promo__name', text: ANIMAL_NAME[side][k] }),
        h('kbd', { text: k.toUpperCase() }))));
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.el.classList.remove('is-on');
    void this.el.offsetWidth;
    this.el.classList.add('is-on');
    (this.grid.firstElementChild as HTMLElement).focus({ preventScroll: true });
    return new Promise((res) => (this.resolve = res));
  }

  private choose(k: PromoKind): void {
    if (!this.resolve) return;
    const r = this.resolve;
    this.resolve = null;
    this.el.hidden = true;
    this.prevFocus?.focus?.({ preventScroll: true });
    this.ctx.emit('promotionChosen', { kind: k });
    r(k);
  }

  dispose(): void {
    const r = this.resolve;
    this.resolve = null;
    r?.('q');
  }
}
