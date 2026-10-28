/** "How it works": the mode rules in plain words, as a sheet over the setup screen. */
import type { PlayMode } from '../../contracts/types';
import { button, h, radioGroup } from '../dom';
import { ALL_MODES, HOW_TO, HOW_TO_ONLINE, MODE_TEXT } from '../modeText';
import { ICON } from './hud';

export interface HowToSheet {
  el: HTMLElement;
  /** `tab`: a mode, or 'online' for "Play a friend online". */
  open(tab: PlayMode | 'online', behind: HTMLElement, returnFocus: HTMLElement): void;
  close(): void;
  readonly isOpen: boolean;
}

export function howToSheet(): HowToSheet {
  const body = h('div', { class: 'mc-howto__body', tabindex: '0' });
  let behind: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;

  /** A mode, or Phase 5's "Online" tab. */
  type Tab = PlayMode | 'online';
  const render = (tab: Tab) => {
    const pitch = tab === 'online' ? HOW_TO_ONLINE.pitch : MODE_TEXT[tab].pitch;
    const sections = tab === 'online' ? HOW_TO_ONLINE.sections : HOW_TO[tab];
    body.replaceChildren(
      h('p', { class: 'mc-howto__pitch', text: pitch }),
      ...sections.map((s) => h('section', { class: 'mc-howto__sec' },
        h('h3', { text: s.title }),
        h('ul', {}, ...s.items.map((t) => h('li', { text: t }))))));
    body.scrollTop = 0;
  };
  const tabs = radioGroup<Tab>('Topic', [...ALL_MODES.map((m) => ({ value: m as Tab, label: MODE_TEXT[m].name })), { value: 'online', label: 'Online' }], 'normal', render, 'mc-seg mc-seg--tabs');
  const closeBtn = button('', { variant: 'icon', sfx: 'back', label: 'Close', icon: ICON.close, onClick: () => close() });

  const el = h('div', { class: 'mc-howto', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mc-howto-h', hidden: true },
    h('div', { class: 'mc-panel mc-panel--wide mc-howto__panel' },
      h('header', { class: 'mc-panel__head' }, h('h2', { id: 'mc-howto-h', text: 'How it works' }), h('span', { class: 'mc-grow' }), closeBtn),
      h('div', { class: 'mc-howto__tabs' }, tabs.el),
      body,
      h('footer', { class: 'mc-panel__foot' }, button('Got it', { variant: 'primary', onClick: () => close() }))));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    behind?.removeAttribute('inert');
    returnFocus?.focus({ preventScroll: true });
  }

  return {
    el,
    open(tab, b, r) {
      behind = b;
      returnFocus = r;
      tabs.set(tab);
      render(tab);
      el.hidden = false;
      b.setAttribute('inert', '');
      requestAnimationFrame(() => closeBtn.focus({ preventScroll: true }));
    },
    close,
    get isOpen() {
      return !el.hidden;
    },
  };
}
