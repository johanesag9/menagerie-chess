import type { BotLevel, GameMode, Side } from '../../contracts/types';
import { BOT_LEVELS, TIME_CONTROLS } from '../config';
import type { UiCtx, View } from '../ctx';
import { button, h, radioGroup, toggle } from '../dom';
import { animalIcon } from '../icons';
import { MODES, MODE_TEXT } from '../modeText';
import { howToSheet } from './howto';
import { checkFen, loadSetup, saveSetup, toGameOptions, type SetupChoice } from '../settings';

export function setupScreen(ctx: UiCtx): View {
  const choice: SetupChoice = loadSetup(ctx.store, TIME_CONTROLS.map((t) => t.id));
  const save = () => saveSetup(ctx.store, choice);

  const mode = radioGroup<GameMode>('Mode',
    MODES.map((m) => ({ value: m, label: MODE_TEXT[m].name, sub: MODE_TEXT[m].pitch, html: MODE_TEXT[m].icon })),
    choice.mode, (v) => { choice.mode = v; save(); syncMode(); }, 'mc-modes');
  const howTo = howToSheet();
  const howBtn = button('How it works', { variant: 'ghost', class: 'mc-btn--sm', onClick: () => howTo.open(choice.mode, panel, howBtn) });

  const opponent = radioGroup<'bot' | 'local'>('Opponent', [
    { value: 'bot', label: 'Bot', sub: 'Play the computer', html: '🤖' },
    { value: 'local', label: 'Friend', sub: 'Same device, take turns', html: '🧑‍🤝‍🧑' },
  ], choice.opponent, (v) => {
    choice.opponent = v;
    save();
    syncBot();
  });

  const level = radioGroup<BotLevel>('Bot level',
    BOT_LEVELS.map((b) => ({ value: b.level, label: b.name, sub: `Level ${b.level}` })),
    choice.level, (v) => { choice.level = v; save(); }, 'mc-chips');

  const side = radioGroup<Side | 'random'>('Play as', [
    { value: 'land', label: 'Land', sub: 'Moves first', html: animalIcon('land', 'k', { disc: true }) },
    { value: 'sea', label: 'Sea', sub: 'Moves second', html: animalIcon('sea', 'k', { disc: true }) },
    { value: 'random', label: 'Random', sub: 'Flip a shell', html: '🎲' },
  ], choice.side, (v) => { choice.side = v; save(); });

  const time = radioGroup<string>('Time control',
    TIME_CONTROLS.map((t) => ({ value: t.id, label: t.label })),
    choice.timeId, (v) => { choice.timeId = v; save(); }, 'mc-seg mc-seg--wrap');

  const weird = toggle('Weird Mode', choice.weirdMode, (v) => { choice.weirdMode = v; save(); },
    'Every few turns something odd happens. Chess rules never change.');

  const fenInput = h('textarea', { class: 'mc-input mc-input--fen', rows: '2', spellcheck: 'false', autocomplete: 'off', placeholder: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'aria-describedby': 'mc-fen-err' });
  const fenErr = h('p', { class: 'mc-field-error', id: 'mc-fen-err', role: 'alert' });
  fenInput.addEventListener('input', () => { fenErr.textContent = ''; fenInput.removeAttribute('aria-invalid'); });
  const fen = h('details', { class: 'mc-details' },
    h('summary', { 'data-sfx': 'click', text: 'Advanced: start from a position (FEN)' }),
    h('label', { class: 'mc-row__hint', text: 'Paste a FEN to set up a custom position.' }),
    fenInput, fenErr);

  const botBlock = h('div', { class: 'mc-setup__bot' },
    h('h3', { class: 'mc-label', text: 'Bot level' }), level.el,
    h('h3', { class: 'mc-label', text: 'Play as' }), side.el);
  function syncBot() {
    botBlock.hidden = choice.opponent !== 'bot';
  }
  syncBot();
  // Crazy has the Wheel of Chaos instead of Weird Mode.
  function syncMode() {
    weird.el.hidden = choice.mode === 'crazy';
  }
  syncMode();

  const start = button('Start game', { variant: 'primary', onClick: () => {
    const raw = fenInput.value.trim();
    if (raw) {
      const err = checkFen(raw);
      if (err) {
        fen.open = true;
        fenErr.textContent = err;
        fenInput.setAttribute('aria-invalid', 'true');
        fenInput.focus();
        ctx.audio.play('illegal');
        return;
      }
    }
    const t = TIME_CONTROLS.find((x) => x.id === choice.timeId) ?? TIME_CONTROLS[0];
    ctx.startGame(toGameOptions(choice, t.time, raw || undefined));
  } });

  const panel = h('div', { class: 'mc-panel mc-panel--wide' },
    h('header', { class: 'mc-panel__head' },
      button('', { variant: 'icon', sfx: 'back', label: 'Back', icon: '←', onClick: () => ctx.show('title') }),
      h('h2', { id: 'mc-setup-h', text: 'New game' })),
    h('div', { class: 'mc-panel__body' },
      h('div', { class: 'mc-label-row' }, h('h3', { class: 'mc-label', text: 'Mode' }), howBtn), mode.el,
      h('h3', { class: 'mc-label', text: 'Opponent' }), opponent.el,
      botBlock,
      h('h3', { class: 'mc-label', text: 'Time' }), time.el,
      weird.el,
      fen),
    h('footer', { class: 'mc-panel__foot' }, start));
  const el = h('section', { class: 'mc-screen mc-menu', 'aria-labelledby': 'mc-setup-h' }, panel, howTo.el);

  return { el, focusTarget: () => start, onShow: () => howTo.close() };
}
