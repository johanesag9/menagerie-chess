/** Pause, result and the promotion picker: dialogs that sit over the game. */
import type { ArenaState, GameOver, PieceKind, Side } from '../../contracts/types';
import type { OnlineHud } from '../../contracts/net';
import { ANIMAL_NAME, PROMOTION_KINDS, REASON_TEXT, SIDE_NAME, playerName } from '../config';
import { isOnline, youSide } from '../format';
import type { UiCtx, View } from '../ctx';
import { button, h } from '../dom';
import { animalIcon } from '../icons';
import { TREASURE } from '../modeText';

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
  const title = h('h2', { id: 'mc-pause-h', class: 'mc-panel__title', text: 'Paused' });
  // Online the game can't pause (Phase 5): say so, and say that quitting resigns.
  const onlineNote = h('p', { class: 'mc-row__hint', text: 'The game keeps going online while this is open.', hidden: true });
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
      button('Quit to title', { variant: 'ghost', onClick: () => ask(isOnline(ctx.gameInfo) ? 'Quit? It counts as resigning.' : 'Quit this game?', 'Quit', () => ctx.show('title')) })),
  ];
  function render() {
    list.replaceChildren(...actions());
  }
  function ask(q: string, yes: string, onYes: () => void) {
    list.replaceChildren(confirmRow(q, yes, onYes, () => { render(); resume.focus(); }));
  }
  const el = h('section', { class: 'mc-screen mc-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-pause-h' },
    h('div', { class: 'mc-panel mc-panel--narrow' },
      title,
      onlineNote,
      list));
  return {
    el,
    onShow: () => {
      render();
      const online = isOnline(ctx.gameInfo);
      title.textContent = online ? 'Menu' : 'Paused';
      onlineNote.hidden = !online;
      resume.querySelector('.mc-btn__text')!.textContent = online ? 'Back to the game' : 'Resume';
      undo.disabled = moveCount() === 0;
      undo.hidden = ctx.gameInfo?.mode === 'crazy' || online; // no undo in Crazy or online
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
  /** Phase 5: the online rematch line ("Waiting for your friend…", "Your friend wants a rematch!"). */
  private note = h('p', { class: 'mc-result__note', role: 'status', hidden: true });
  private online: OnlineHud | null = null;
  /** Pressed Rematch online and the room hasn't echoed it yet: show the wait straight away. */
  private asked = false;

  constructor(private ctx: UiCtx) {
    this.rematch = button('Rematch', { variant: 'primary', onClick: () => {
      // Online, both have to ask; the room starts the new game (integration shows it).
      if (isOnline(ctx.gameInfo)) {
        if (this.online?.opponent === 'left') return;
        this.asked = true;
        ctx.emit('rematchOnline', {});
        this.renderOnline();
        return;
      }
      ctx.emit('rematch', {});
      ctx.show('game');
    } });
    this.el = h('section', { class: 'mc-screen mc-overlay mc-result', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-result-h', 'aria-describedby': 'mc-result-sub' },
      this.confetti,
      h('div', { class: 'mc-panel mc-panel--narrow' },
        this.art, this.title, this.sub, this.note,
        h('div', { class: 'mc-stack' },
          this.rematch,
          h('div', { class: 'mc-stack__row' },
            button('New game', { onClick: () => ctx.show('setup') }),
            button('Title', { sfx: 'back', onClick: () => ctx.show('title') })))));
    this.sub.id = 'mc-result-sub';
  }

  set(r: GameOver): void {
    const info = this.ctx.gameInfo;
    const you = youSide(info);
    const reason = REASON_TEXT[r.reason];
    let title: string;
    let mood: 'win' | 'lose' | 'draw';
    this.asked = false;
    this.renderOnline();
    if (r.winner === null) {
      title = r.reason === 'stalemate' ? 'Stalemate!' : "It's a draw";
      mood = 'draw';
    } else if (you) {
      const youWon = r.winner === you;
      title = youWon ? 'You win!' : `${playerName(info, r.winner)} wins`;
      mood = youWon ? 'win' : 'lose';
    } else {
      title = `${SIDE_NAME[r.winner]} wins!`;
      mood = 'win';
    }
    this.title.textContent = title;
    this.sub.textContent = partyLine(r, this.ctx.arenaState, this.ctx.gameInfo?.mode) ?? (r.winner === null
      ? r.reason === 'stalemate' ? 'No legal moves, but no check either.' : reason
      : `${SIDE_NAME[r.winner]} wins ${reason}.`);
    this.el.dataset.mood = mood;
    const w: Side = r.winner ?? 'land';
    this.art.innerHTML = r.winner === null
      ? animalIcon('land', 'k', { disc: true }) + animalIcon('sea', 'k', { disc: true })
      : animalIcon(w, 'k', { disc: true });
    // Crazy: the bonked king lies dizzy beside the winner.
    if (r.reason === 'kingCaptured' && r.winner) this.art.append(h('span', { class: 'mc-result__bonked', html: animalIcon(r.winner === 'land' ? 'sea' : 'land', 'k', { disc: true }) }, h('span', { class: 'mc-result__stars', text: '💫' })));
    // Sumo: the king that went overboard bobs in the waves. Raid: the winner holds up the stolen treasure.
    if (r.reason === 'kingOverboard') {
      const sunk: Side[] = r.winner ? [r.winner === 'land' ? 'sea' : 'land'] : ['land', 'sea'];
      if (!r.winner) this.art.replaceChildren();
      for (const s of sunk) this.art.append(h('span', { class: 'mc-result__overboard', html: animalIcon(s, 'k', { disc: true }) }, h('span', { class: 'mc-result__waves', text: '🌊' })));
    }
    if (r.reason === 'treasure' && r.winner) this.art.append(h('span', { class: 'mc-result__loot', text: TREASURE[r.winner === 'land' ? 'sea' : 'land'].icon }));
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

  /** Phase 5: the online rematch state. */
  setOnline(st: OnlineHud | null): void {
    const prev = this.online?.rematch;
    this.online = st;
    if (st?.rematch === 'none' && prev && prev !== 'none') this.asked = false; // a new game, or the ask was dropped
    this.renderOnline();
  }

  private renderOnline(): void {
    const online = isOnline(this.ctx.gameInfo);
    const st = this.online;
    const label = this.rematch.querySelector('.mc-btn__text')!;
    const left = online && st?.opponent === 'left';
    const state = !online ? 'none' : st?.rematch === 'none' || !st ? (this.asked ? 'youAsked' : 'none') : st.rematch;
    this.el.dataset.rematch = left ? 'left' : state;
    this.rematch.disabled = left || state === 'youAsked';
    this.rematch.classList.toggle('is-calling', !left && state === 'theyAsked');
    label.textContent = state === 'theyAsked' ? 'Rematch!' : state === 'youAsked' ? 'Rematch asked' : 'Rematch';
    this.note.hidden = !(left || state !== 'none');
    if (left) this.note.replaceChildren('Your friend left, so no rematch this time.');
    else if (state === 'youAsked') this.note.replaceChildren('Waiting for your friend', h('span', { class: 'mc-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    else if (state === 'theyAsked') this.note.replaceChildren(h('span', { 'aria-hidden': 'true', text: '🔁 ' }), 'Your friend wants a rematch!');
  }

  focusTarget(): HTMLElement {
    return this.rematch;
  }
}

/** Phase 4: the result line for the party modes' own endings, else null (the chess wording applies). */
export function partyLine(r: GameOver, st: ArenaState | null, mode: string | undefined): string | null {
  const other = (x: Side): Side => (x === 'land' ? 'sea' : 'land');
  const score = (w: Side) => (st ? ` ${st.score[w]}–${st.score[other(w)]}` : '');
  switch (r.reason) {
    case 'kingOverboard':
      return r.winner
        ? `${SIDE_NAME[r.winner]} wins: ${SIDE_NAME[other(r.winner)]}'s ${ANIMAL_NAME[other(r.winner)].k} fell into the sea!`
        : 'Both kings fell into the sea at the same moment.';
    case 'treasure':
      return r.winner ? `${SIDE_NAME[r.winner]} wins${score(r.winner)} by raiding the ${TREASURE[other(r.winner)].name}!` : null;
    case 'rounds': {
      const sumo = (st?.mode ?? mode) === 'sumo';
      const cap = st ? `Round ${st.maxRounds} is over` : 'The last round is over';
      if (sumo) {
        const left = (x: Side) => (st ? st.pieces.filter((p) => p.side === x).length : 0);
        if (!r.winner) return `${cap}, with the same number of animals left${st ? ` (${left('land')} each)` : ''}.`;
        return `${cap}. ${SIDE_NAME[r.winner]} wins with more animals left${st ? ` (${left(r.winner)} to ${left(other(r.winner))})` : ''}.`;
      }
      if (!r.winner) return `${cap}, level on points${st ? ` (${st.score.land}–${st.score.sea})` : ''}.`;
      return `${cap}. ${SIDE_NAME[r.winner]} wins on points${score(r.winner)}.`;
    }
    default:
      return null;
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

  /** Phase 5: close without the player (the room picked): resolves the default, the Octopus/Cat ('q'), and emits nothing. */
  cancel(): void {
    const r = this.resolve;
    if (!r) return;
    this.resolve = null;
    this.el.hidden = true;
    const f = this.prevFocus;
    this.prevFocus = null;
    if (f?.isConnected) f.focus({ preventScroll: true });
    r('q');
  }

  dispose(): void {
    const r = this.resolve;
    this.resolve = null;
    r?.('q');
  }
}
