/**
 * Phase 5: playing a friend online. The invite overlay (waiting for the friend, over the setup screen) and the
 * join dialog (someone opened an invite link). The in-game bits (connection, presence, turn timer) live in the HUD.
 */
import type { PlayMode, Side } from '../../contracts/types';
import { GAME_NAME, SIDE_NAME } from '../config';
import type { UiCtx } from '../ctx';
import { button, h } from '../dom';
import { animalIcon } from '../icons';
import { MODE_TEXT } from '../modeText';

/** "Sumo · You play Land", with the mode's icon and your king. */
function matchLine(mode: PlayMode, you: Side): HTMLElement {
  return h('p', { class: 'mc-invite__match', 'data-side': you },
    h('span', { class: 'mc-invite__modeicon', 'aria-hidden': 'true', text: MODE_TEXT[mode].icon }),
    h('strong', { text: MODE_TEXT[mode].name }),
    h('span', { class: 'mc-invite__dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: 'You play ' }),
    h('span', { class: 'mc-invite__side', 'data-side': you },
      h('span', { class: 'mc-invite__sideicon', 'aria-hidden': 'true', html: animalIcon(you, 'k', { disc: true }) }),
      SIDE_NAME[you]));
}

/** Pop a dialog in (and its panel), or just fade with reduced motion. */
function popIn(el: HTMLElement, reduced: boolean): void {
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 120 : 200, easing: 'ease-out' });
  if (reduced) return;
  el.querySelector('.mc-panel')?.animate(
    [{ transform: 'translateY(24px) scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 420, easing: 'cubic-bezier(.2,1.35,.4,1)' });
}

function fadeOut(el: HTMLElement, reduced: boolean): void {
  const ms = reduced ? 100 : 160;
  el.classList.add('is-leaving');
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  // A timer, not onfinish: background tabs can stall animations, and a stuck overlay would block clicks.
  window.setTimeout(() => {
    if (!el.classList.contains('is-leaving')) return;
    el.hidden = true;
    el.classList.remove('is-leaving');
    el.getAnimations().forEach((a) => a.cancel());
  }, ms + 20);
}

/**
 * Waiting for the friend: the link with Copy and Share, the mode and your side, and Cancel (emits `cancelInvite`).
 * Esc cancels too. `hide()` closes it without an event (the friend joined, or integration gave up).
 */
export class InviteView {
  readonly el: HTMLElement;
  private match = h('div', { class: 'mc-invite__matchwrap' });
  private you = h('span', { class: 'mc-invite__you', 'aria-hidden': 'true' });
  private input: HTMLInputElement;
  private copyBtn: HTMLButtonElement;
  private shareBtn: HTMLButtonElement;
  private copyHint = h('p', { class: 'mc-invite__hint', role: 'status' });
  private cancelBtn: HTMLButtonElement;
  private copyTimer = 0;
  private link = '';
  private mode: PlayMode = 'classic';
  private prevFocus: HTMLElement | null = null;

  constructor(private ctx: UiCtx) {
    this.input = h('input', { class: 'mc-input mc-invite__link', type: 'text', readonly: true, 'aria-label': 'Invite link', spellcheck: 'false', autocomplete: 'off' });
    this.input.addEventListener('focus', () => this.input.select());
    this.input.addEventListener('click', () => this.input.select());
    this.copyBtn = button('Copy link', { variant: 'primary', class: 'mc-invite__copy', onClick: () => void this.copy() });
    this.shareBtn = button('Share', { class: 'mc-invite__share', onClick: () => void this.share() });
    this.cancelBtn = button('Cancel', { variant: 'ghost', sfx: 'back', onClick: () => this.cancel() });
    this.el = h('section', { class: 'mc-screen mc-overlay mc-invite', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-invite-h', hidden: true },
      h('div', { class: 'mc-panel mc-panel--narrow mc-invite__panel' },
        h('div', { class: 'mc-invite__duo', 'aria-hidden': 'true' },
          this.you,
          h('span', { class: 'mc-invite__wire' }, h('i'), h('i'), h('i')),
          h('span', { class: 'mc-invite__friend', text: '?' })),
        h('h2', { id: 'mc-invite-h', class: 'mc-panel__title', text: 'Invite a friend' }),
        this.match,
        h('div', { class: 'mc-invite__box' }, this.input),
        h('div', { class: 'mc-stack__row mc-invite__btns' }, this.copyBtn, this.shareBtn),
        this.copyHint,
        h('p', { class: 'mc-invite__wait', role: 'status' },
          h('span', { text: 'Waiting for your friend' }),
          h('span', { class: 'mc-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
        h('p', { class: 'mc-row__hint', text: 'Keep this screen open. The game starts when they join.' }),
        this.cancelBtn));
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden && !this.el.classList.contains('is-leaving');
  }

  show(info: { link: string; mode: PlayMode; you: Side }): void {
    const wasOpen = this.open;
    this.link = info.link;
    this.mode = info.mode;
    this.input.value = info.link;
    this.match.replaceChildren(matchLine(info.mode, info.you));
    this.you.innerHTML = animalIcon(info.you, 'k', { disc: true });
    this.el.dataset.side = info.you;
    this.shareBtn.hidden = typeof navigator.share !== 'function';
    this.resetCopy();
    if (wasOpen) return;
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    popIn(this.el, this.ctx.settings.reducedMotion);
    requestAnimationFrame(() => this.copyBtn.focus({ preventScroll: true }));
  }

  hide(): void {
    if (!this.open) return;
    window.clearTimeout(this.copyTimer);
    fadeOut(this.el, this.ctx.settings.reducedMotion);
    const f = this.prevFocus;
    this.prevFocus = null;
    if (f?.isConnected) f.focus({ preventScroll: true });
  }

  /** Cancel (button or Esc): closes and emits `cancelInvite`. */
  cancel(): void {
    this.hide();
    this.ctx.emit('cancelInvite', {});
  }

  private async copy(): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(this.link);
      ok = true;
    } catch {
      // Older or locked-down browsers: fall back to the selection.
      this.input.focus();
      this.input.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (!this.open) return;
    window.clearTimeout(this.copyTimer);
    const label = this.copyBtn.querySelector('.mc-btn__text');
    if (ok) {
      this.copyBtn.classList.add('is-done');
      if (label) label.textContent = 'Copied! ✓';
      this.copyHint.textContent = '';
      this.copyTimer = window.setTimeout(() => this.resetCopy(), 2200);
    } else {
      this.input.focus();
      this.input.select();
      this.copyHint.textContent = "Couldn't copy. The link is selected: copy it by hand.";
    }
  }

  private resetCopy(): void {
    window.clearTimeout(this.copyTimer);
    this.copyBtn.classList.remove('is-done');
    const label = this.copyBtn.querySelector('.mc-btn__text');
    if (label) label.textContent = 'Copy link';
    this.copyHint.textContent = '';
  }

  private async share(): Promise<void> {
    try {
      await navigator.share({ title: GAME_NAME, text: `Play ${MODE_TEXT[this.mode].name} with me in ${GAME_NAME}!`, url: this.link });
    } catch {
      /* closed the share sheet, or sharing isn't allowed: the link is still on screen */
    }
  }
}

/**
 * "Your friend invited you to Sumo. You play Sea." Join or Not now. With no info the link is dead: one OK button.
 * A new question answers an open one with false.
 */
export class JoinDialog {
  readonly el: HTMLElement;
  private panel = h('div', { class: 'mc-panel mc-panel--narrow mc-join__panel' });
  private resolve: ((join: boolean) => void) | null = null;
  private prevFocus: HTMLElement | null = null;

  constructor(private ctx: UiCtx) {
    this.el = h('section', { class: 'mc-screen mc-overlay mc-join', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-join-h', 'aria-describedby': 'mc-join-sub', hidden: true }, this.panel);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.answer(false);
      }
    });
  }

  get open(): boolean {
    return this.resolve !== null;
  }

  ask(info: { mode: PlayMode; you: Side } | null): Promise<boolean> {
    this.resolve?.(false);
    this.resolve = null;
    let first: HTMLButtonElement;
    if (info) {
      const t = MODE_TEXT[info.mode];
      first = button('Join', { variant: info.you === 'sea' ? 'sea' : 'primary', class: 'mc-btn--xl', onClick: () => this.answer(true) });
      this.el.dataset.side = info.you;
      this.el.dataset.dead = 'false';
      this.panel.replaceChildren(
        h('div', { class: 'mc-join__art', 'aria-hidden': 'true' },
          h('span', { class: 'mc-join__mode', text: t.icon }),
          h('span', { class: 'mc-join__king', html: animalIcon(info.you, 'k', { disc: true }) })),
        h('h2', { id: 'mc-join-h', class: 'mc-join__title' },
          'Your friend invited you to ', h('strong', { text: t.name }), '.'),
        h('p', { class: 'mc-join__side' }, 'You play ', h('strong', { 'data-side': info.you, text: SIDE_NAME[info.you] }), '.'),
        h('p', { id: 'mc-join-sub', class: 'mc-join__pitch', text: t.pitch }),
        h('div', { class: 'mc-stack' }, first, button('Not now', { variant: 'ghost', sfx: 'back', onClick: () => this.answer(false) })));
    } else {
      first = button('OK', { variant: 'primary', onClick: () => this.answer(false) });
      this.el.dataset.dead = 'true';
      delete this.el.dataset.side;
      this.panel.replaceChildren(
        h('div', { class: 'mc-join__art', 'aria-hidden': 'true' }, h('span', { class: 'mc-join__mode', text: '🔗' }), h('span', { class: 'mc-join__puff', text: '💨' })),
        h('h2', { id: 'mc-join-h', class: 'mc-join__title', text: 'This invite is closed' }),
        h('p', { id: 'mc-join-sub', class: 'mc-join__pitch', text: 'This invite has expired or the game is full.' }),
        h('div', { class: 'mc-stack' }, first));
    }
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    popIn(this.el, this.ctx.settings.reducedMotion);
    requestAnimationFrame(() => first.focus({ preventScroll: true }));
    return new Promise((res) => (this.resolve = res));
  }

  answer(join: boolean): void {
    const r = this.resolve;
    if (!r) return;
    this.resolve = null;
    fadeOut(this.el, this.ctx.settings.reducedMotion);
    const f = this.prevFocus;
    this.prevFocus = null;
    if (f?.isConnected && f !== document.body) f.focus({ preventScroll: true });
    r(join);
  }

  dispose(): void {
    const r = this.resolve;
    this.resolve = null;
    r?.(false);
  }
}
