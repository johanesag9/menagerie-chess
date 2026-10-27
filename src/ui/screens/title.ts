import { GAME_NAME, TAGLINE } from '../config';
import type { UiCtx, View } from '../ctx';
import { button, h } from '../dom';
import { animalIcon } from '../icons';

export function titleScreen(ctx: UiCtx): View {
  // Each letter is its own span so the wordmark can bounce in.
  const word = h('h1', { class: 'mc-wordmark', 'aria-label': GAME_NAME });
  GAME_NAME.split(' ').forEach((part, wi) => {
    const w = h('span', { class: 'mc-wordmark__word', 'aria-hidden': 'true' });
    [...part].forEach((ch, i) => w.append(h('span', { class: 'mc-wordmark__ch', style: `--i:${wi * 6 + i}`, text: ch })));
    word.append(w);
  });

  const play = button('Play', { variant: 'primary', class: 'mc-btn--xl', onClick: () => ctx.show('setup') });
  const el = h('section', { class: 'mc-screen mc-title', 'aria-label': 'Title' },
    h('div', { class: 'mc-title__inner' },
      word,
      h('p', { class: 'mc-title__tag' },
        h('span', { class: 'mc-title__team', html: animalIcon('land', 'k', { disc: true }) }),
        h('span', { text: TAGLINE }),
        h('span', { class: 'mc-title__team mc-title__team--sea', html: animalIcon('sea', 'k', { disc: true }) })),
      h('div', { class: 'mc-title__actions' },
        play,
        h('div', { class: 'mc-title__row' },
          button('Customize', { onClick: () => ctx.show('customize') }),
          button('Settings', { onClick: () => ctx.show('settings') })))));

  return { el, focusTarget: () => play };
}
