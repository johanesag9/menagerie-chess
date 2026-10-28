import type { BotLevel, PlayMode, Side } from '../../contracts/types';
import { isArenaMode } from '../../contracts/types';
import { BOT_LEVELS, TIME_CONTROLS } from '../config';
import type { UiCtx, View } from '../ctx';
import { button, h, radioGroup, toggle } from '../dom';
import { animalIcon } from '../icons';
import { ALL_MODES, ARENA_MODES, BOARD_MODES, MODE_TEXT } from '../modeText';
import { howToSheet } from './howto';
import { checkFen, loadSetup, saveSetup, toGameOptions, type SetupChoice } from '../settings';

/** The setup screen. `setBusy` is the online Start button's wait (Phase 5). */
export function setupScreen(ctx: UiCtx): View & { setBusy(on: boolean): void } {
  const choice: SetupChoice = loadSetup(ctx.store, TIME_CONTROLS.map((t) => t.id));
  const save = () => saveSetup(ctx.store, choice);

  const mode = radioGroup<PlayMode>('Mode',
    ALL_MODES.map((m) => ({ value: m, label: MODE_TEXT[m].name, sub: MODE_TEXT[m].pitch, html: MODE_TEXT[m].icon })),
    choice.mode, (v) => { choice.mode = v; save(); syncMode(); }, 'mc-modes');
  // One radio group (arrow keys run through all seven), shown as three rows: chess, the party modes, the board games.
  const opts = Array.from(mode.el.children) as HTMLElement[];
  const party = opts.filter((b) => (ARENA_MODES as string[]).includes(b.dataset.value ?? ''));
  const boardGames = opts.filter((b) => (BOARD_MODES as string[]).includes(b.dataset.value ?? ''));
  mode.el.replaceChildren(
    h('div', { class: 'mc-modes__row' }, ...opts.filter((b) => !party.includes(b) && !boardGames.includes(b))),
    h('div', { class: 'mc-modes__party' }, h('span', { class: 'mc-label', text: 'Party modes' }), h('span', { class: 'mc-modes__tag', text: 'Not chess' })),
    h('div', { class: 'mc-modes__row mc-modes__row--party' }, ...party),
    h('div', { class: 'mc-modes__party' }, h('span', { class: 'mc-label', text: 'Board games' }), h('span', { class: 'mc-modes__tag mc-modes__tag--board', text: 'No luck' })),
    h('div', { class: 'mc-modes__row mc-modes__row--party mc-modes__row--board' }, ...boardGames));
  const howTo = howToSheet();
  const howBtn = button('How it works', { variant: 'ghost', class: 'mc-btn--sm', onClick: () => howTo.open(choice.mode, panel, howBtn) });

  const opponent = radioGroup<SetupChoice['opponent']>('Opponent', [
    { value: 'bot', label: 'Bot', sub: 'Play the computer', html: '🤖' },
    { value: 'local', label: 'Friend', sub: 'Same device, take turns', html: '🧑‍🤝‍🧑' },
    { value: 'online', label: 'Friend online', sub: 'Send them a link', html: '🔗' },
  ], choice.opponent, (v) => {
    choice.opponent = v;
    save();
    syncBot();
    syncMode();
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

  // Bot level only vs the bot; "Play as" vs the bot and online (Phase 5).
  const levelBlock = h('div', { class: 'mc-setup__bot' }, h('h3', { class: 'mc-label', text: 'Bot level' }), level.el);
  const sideBlock = h('div', { class: 'mc-setup__side' }, h('h3', { class: 'mc-label', text: 'Play as' }), side.el);
  const onlineHow = h('button', { type: 'button', class: 'mc-linkbtn', 'data-sfx': 'click', text: 'How online works' });
  onlineHow.addEventListener('click', () => howTo.open('online', panel, onlineHow));
  const onlineNote = h('p', { class: 'mc-row__hint mc-setup__note' }, "You'll get a link to send. No clock: each turn has a 60-second timer. ", onlineHow);
  function syncBot() {
    levelBlock.hidden = choice.opponent !== 'bot';
    sideBlock.hidden = choice.opponent === 'local';
    onlineNote.hidden = choice.opponent !== 'online';
    const label = start.querySelector('.mc-btn__text');
    if (label && !busy) label.textContent = choice.opponent === 'online' ? 'Invite a friend' : 'Start game';
  }
  syncBot();
  // Crazy has the Wheel of Chaos instead of Weird Mode. Party modes and board games have no clock, Weird Mode or FEN; online games neither.
  const timeLabel = h('h3', { class: 'mc-label', text: 'Time' });
  function syncMode() {
    const party = isArenaMode(choice.mode);
    const online = choice.opponent === 'online';
    weird.el.hidden = choice.mode === 'crazy' || party || online;
    timeLabel.hidden = time.el.hidden = fen.hidden = party || online;
  }
  syncMode();

  let busy = false;
  let busyTimer = 0;
  const start = button('Start game', { variant: 'primary', onClick: () => {
    if (busy) return;
    const raw = isArenaMode(choice.mode) || choice.opponent === 'online' ? '' : fenInput.value.trim();
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
    const opts = toGameOptions(choice, t.time, raw || undefined);
    // Online: the room is being made; the invite overlay (showInvite) or an error ends the wait.
    if (opts.opponent.type === 'online') setBusy(true);
    ctx.startGame(opts);
  } });
  /** Phase 5: "Making your link…" while integration creates the room. A timer frees the button if nothing answers. */
  function setBusy(on: boolean) {
    busy = on;
    window.clearTimeout(busyTimer);
    start.classList.toggle('is-busy', on);
    start.setAttribute('aria-busy', String(on));
    const label = start.querySelector('.mc-btn__text');
    if (label) label.textContent = on ? 'Making your link…' : choice.opponent === 'online' ? 'Invite a friend' : 'Start game';
    if (on) busyTimer = window.setTimeout(() => setBusy(false), 15_000);
  }
  syncBot();

  const panel = h('div', { class: 'mc-panel mc-panel--wide' },
    h('header', { class: 'mc-panel__head' },
      button('', { variant: 'icon', sfx: 'back', label: 'Back', icon: '←', onClick: () => ctx.show('title') }),
      h('h2', { id: 'mc-setup-h', text: 'New game' })),
    h('div', { class: 'mc-panel__body' },
      h('div', { class: 'mc-label-row' }, h('h3', { class: 'mc-label', text: 'Mode' }), howBtn), mode.el,
      h('h3', { class: 'mc-label', text: 'Opponent' }), opponent.el,
      onlineNote,
      levelBlock,
      sideBlock,
      timeLabel, time.el,
      weird.el,
      fen),
    h('footer', { class: 'mc-panel__foot' }, start));
  const el = h('section', { class: 'mc-screen mc-menu', 'aria-labelledby': 'mc-setup-h' }, panel, howTo.el);

  return { el, focusTarget: () => start, onShow: () => { howTo.close(); setBusy(false); }, setBusy };
}
