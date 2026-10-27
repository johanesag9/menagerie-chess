/** Core demo: a plain 2D DOM board to play the GameController locally or against Stockfish. Dev tool only. */
import type { BotLevel, EmoteKind, GameEventMap, GameOptions, PieceKind, Side, Square } from '../contracts/types';
import { createGame } from './index';

// Emoji stand-ins (no seahorse or blobfish emoji exist, so 🐠 and 🐟 stand in).
const EMOJI: Record<Side, Record<PieceKind, string>> = {
  land: { p: '🐕', n: '🐎', b: '🐐', r: '🐘', q: '🐈', k: '🐶' },
  sea: { p: '🦀', n: '🐠', b: '🐡', r: '🐢', q: '🐙', k: '🐟' },
};
const NAMES: Record<Side, Record<PieceKind, string>> = {
  land: { p: 'Dachshund pup', n: 'Horse', b: 'Mountain goat', r: 'Elephant', q: 'Cat', k: 'Pug king' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Sea turtle', q: 'Octopus', k: 'Blobfish king' },
};
const LEVEL_NAMES = ['', 'Toddler', 'Puppy', 'Beachcomber', 'Club player', 'Strong', 'Expert', 'Master', 'Grandmaster'];
const EMOTES: [EmoteKind, string][] = [['laugh', '😂'], ['angry', '😠'], ['love', '😍'], ['shock', '😱'], ['sleepy', '😴'], ['taunt', '😜']];
const FILES = 'abcdefgh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $('board');
const statusEl = $('status');
const logEl = $('log');
const movesEl = $('moves');
const promoEl = $('promo');
const toastEl = $('toast');

const game = createGame();
(window as unknown as { coreGame: typeof game }).coreGame = game; // handy in the console

let options: GameOptions;
let selected: Square | null = null;
let targets: Square[] = [];
let flipped = false;
let checkSquare: Square | null = null;
let weirdSquares = new Set<Square>();
let clocks: GameEventMap['clock'] = { landMs: null, seaMs: null, running: null };
let thinking = false;
let paused = false;
let pendingPromo: { from: Square; to: Square } | null = null;

// ---------- setup form ----------

const levelSel = $<HTMLSelectElement>('level');
for (let l = 1; l <= 8; l++) levelSel.add(new Option(`${l} · ${LEVEL_NAMES[l]}`, String(l), l === 3, l === 3));

function readOptions(): GameOptions {
  const opp = $<HTMLSelectElement>('opponent').value;
  const t = $<HTMLSelectElement>('time').value;
  const [initial, inc] = t === 'none' ? [null, 0] : t.split('+').map(Number);
  const fen = $<HTMLInputElement>('fen').value.trim();
  return {
    opponent: opp === 'bot'
      ? { type: 'bot', level: Number(levelSel.value) as BotLevel, botSide: $<HTMLSelectElement>('botSide').value as Side }
      : { type: 'local' },
    time: { initialMs: initial, incrementMs: inc },
    weirdMode: $<HTMLInputElement>('weird').checked,
    ...(fen ? { fen } : {}),
  };
}

function start(): void {
  const next = readOptions();
  try {
    game.newGame(next);
    $('fen-error').textContent = '';
  } catch (err) {
    $('fen-error').textContent = (err as Error).message;
  }
}

$('setup').addEventListener('submit', (e) => {
  e.preventDefault();
  start();
});
const syncBotFields = () => {
  const bot = $<HTMLSelectElement>('opponent').value === 'bot';
  levelSel.disabled = !bot;
  $<HTMLSelectElement>('botSide').disabled = !bot;
};
$('opponent').addEventListener('change', syncBotFields);

// ---------- actions ----------

$('undo').addEventListener('click', () => game.undo());
$('resign').addEventListener('click', () => game.resign(humanSide()));
$('pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) game.pause();
  else game.resume();
  render();
});
$('flip').addEventListener('click', () => {
  flipped = !flipped;
  render();
});
$('copy-fen').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(game.fen);
    toast('FEN copied');
  } catch {
    $<HTMLInputElement>('fen').value = game.fen;
    toast('FEN put in the box');
  }
});
$('show-ids').addEventListener('change', render);
promoEl.querySelector('#promo-cancel')!.addEventListener('click', () => {
  pendingPromo = null;
  promoEl.hidden = true;
});

const emotesEl = $('emotes');
for (const [kind, icon] of EMOTES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = icon;
  b.title = `Emote: ${kind}`;
  b.setAttribute('aria-label', `Emote ${kind}`);
  b.addEventListener('click', () => game.sendEmote(humanSide(), kind));
  emotesEl.append(b);
}

$('legend').textContent =
  'Land: ' + (Object.keys(EMOJI.land) as PieceKind[]).map((k) => `${EMOJI.land[k]} ${NAMES.land[k]}`).join(', ') +
  '. Sea: ' + (Object.keys(EMOJI.sea) as PieceKind[]).map((k) => `${EMOJI.sea[k]} ${NAMES.sea[k]}`).join(', ') +
  '. 🐠 and 🐟 stand in for the seahorse and blobfish.';

function humanSide(): Side {
  return options?.opponent.type === 'bot' ? (options.opponent.botSide === 'land' ? 'sea' : 'land') : game.turn;
}

// ---------- board input ----------

boardEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sq');
  if (btn) onSquare(btn.dataset.sq as Square);
});

function onSquare(sq: Square): void {
  if (pendingPromo || game.isOver()) return;
  if (selected && targets.includes(sq)) {
    if (game.needsPromotion(selected, sq)) return askPromotion(selected, sq);
    game.move({ from: selected, to: sq });
    clearSelection();
    return;
  }
  const own = game.pieces.find((p) => p.square === sq && p.side === game.turn);
  if (own && sq !== selected) {
    selected = sq;
    targets = game.legalTargets(sq);
    if (!targets.length) shakeSquare(sq);
  } else {
    if (selected && sq !== selected) shakeSquare(sq);
    clearSelection();
  }
  render();
}

function clearSelection(): void {
  selected = null;
  targets = [];
}

function askPromotion(from: Square, to: Square): void {
  pendingPromo = { from, to };
  const side = game.turn;
  const row = $('promo-row');
  row.replaceChildren(
    ...(['q', 'r', 'b', 'n'] as const).map((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = EMOJI[side][k];
      b.title = NAMES[side][k];
      b.setAttribute('aria-label', NAMES[side][k]);
      b.addEventListener('click', () => {
        promoEl.hidden = true;
        const p = pendingPromo!;
        pendingPromo = null;
        game.move({ ...p, promotion: k });
        clearSelection();
        render();
      });
      return b;
    }),
  );
  promoEl.hidden = false;
  (row.firstElementChild as HTMLButtonElement).focus();
}

function shakeSquare(sq: Square): void {
  const el = boardEl.querySelector<HTMLElement>(`[data-sq="${sq}"]`);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// ---------- game events ----------

game.on('gameStarted', (e) => {
  options = e.options;
  clearSelection();
  checkSquare = null;
  paused = false;
  flipped = e.options.opponent.type === 'bot' && e.options.opponent.botSide === 'land';
  logEl.replaceChildren();
  log('gameStarted', `${e.options.opponent.type === 'bot' ? `bot L${e.options.opponent.level} as ${e.options.opponent.botSide}` : 'local'}, ${e.pieces.length} pieces, ${e.turn} to move`);
  render();
});
game.on('moved', (m) => {
  checkSquare = null;
  const bits = [`${m.side} ${m.san}`, m.pieceId, `${m.from}→${m.to}`];
  if (m.captured) bits.push(`took ${m.captured.id} on ${m.captured.square}`);
  if (m.rookMove) bits.push(`rook ${m.rookMove.pieceId} ${m.rookMove.from}→${m.rookMove.to}`);
  const promoted = (m as { promotedId?: string }).promotedId;
  if (promoted) bits.push(`became ${promoted}`);
  if (m.flags.length) bits.push(`[${m.flags.join(',')}]`);
  log('moved', bits.join(' · '));
  if ($<HTMLInputElement>('sim-anim').checked && !paused) {
    // What integration does: hold clocks and the bot while the move animation plays.
    game.pause();
    setTimeout(() => {
      if (!paused) game.resume();
    }, 600);
  }
  render();
});
game.on('check', (c) => {
  checkSquare = c.kingSquare;
  log('check', `${c.side} king on ${c.kingSquare}`);
  render();
});
game.on('turnChanged', (t) => log('turnChanged', `${t.turn} · ${t.legalMoveCount} legal moves`));
game.on('gameOver', (o) => {
  log('gameOver', `${o.winner ?? 'draw'} · ${o.reason}`);
  render();
});
game.on('clock', (c) => {
  clocks = c;
  renderClocks();
});
game.on('botThinking', (b) => {
  thinking = b.thinking;
  log('botThinking', `${b.side} ${b.thinking ? 'thinking…' : 'done'}`);
  renderClocks();
});
game.on('weirdEvent', (w) => {
  log('weirdEvent', `${w.kind} · ${w.durationTurns} turn(s)${w.squares?.length ? ` · ${w.squares.length} squares` : ''}`);
  toast(`Weird: ${w.kind}`);
  weirdSquares = new Set(w.squares ?? []);
  render();
  setTimeout(() => {
    weirdSquares = new Set();
    render();
  }, 1600);
});
game.on('undone', (u) => {
  clearSelection();
  checkSquare = null;
  log('undone', `${u.pieces.length} pieces · ${u.fen}`);
  render();
});
game.on('emote', (e) => {
  log('emote', `${e.side} ${e.emote}`);
  toast(`${e.side}: ${EMOTES.find(([k]) => k === e.emote)?.[1] ?? e.emote}`);
});

// ---------- rendering ----------

function render(): void {
  const showIds = $<HTMLInputElement>('show-ids').checked;
  const bySquare = new Map(game.pieces.map((p) => [p.square, p]));
  const last = game.history.at(-1);
  const over = game.isOver();
  const squares: HTMLButtonElement[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row + 1 : 8 - row;
      const file = FILES[flipped ? 7 - col : col];
      const sq = `${file}${rank}` as Square;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq';
      b.dataset.sq = sq;
      b.classList.add(rank <= 4 ? 'meadow' : 'beach', (FILES.indexOf(file) + rank) % 2 === 1 ? 'dark' : 'light');
      if (sq === selected) b.classList.add('selected');
      if (targets.includes(sq)) b.classList.add(bySquare.has(sq) || isEnPassantTarget(sq) ? 'capture' : 'target');
      if (last && (sq === last.from || sq === last.to)) b.classList.add('last');
      if (sq === checkSquare && !(over && over.reason !== 'checkmate')) b.classList.add('check');
      if (weirdSquares.has(sq)) b.classList.add('weird');
      const p = bySquare.get(sq);
      let label: string = sq;
      if (p) {
        const piece = document.createElement('span');
        piece.className = `piece ${p.side}`;
        piece.textContent = EMOJI[p.side][p.kind];
        const kind = document.createElement('span');
        kind.className = 'kind';
        kind.textContent = p.kind.toUpperCase();
        piece.append(kind);
        if (p.kind === 'k') {
          const crown = document.createElement('span');
          crown.className = 'crown';
          crown.textContent = '👑';
          piece.append(crown);
        }
        b.append(piece);
        if (showIds) {
          const id = document.createElement('span');
          id.className = 'id';
          id.textContent = p.id;
          b.append(id);
        }
        label = `${sq}, ${p.side} ${NAMES[p.side][p.kind]}`;
        b.title = `${p.id} (${sq})`;
      }
      if ((flipped ? rank === 8 : rank === 1) || (flipped ? file === 'h' : file === 'a')) {
        const c = document.createElement('span');
        c.className = 'coord';
        c.textContent = sq;
        b.append(c);
      }
      b.setAttribute('aria-label', label);
      squares.push(b);
    }
  }
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.sq;
  boardEl.replaceChildren(...squares);
  if (focused) boardEl.querySelector<HTMLElement>(`[data-sq="${focused}"]`)?.focus();

  movesEl.replaceChildren(
    ...pairs(game.history.map((m) => m.san)).map(([w, b]) => {
      const li = document.createElement('li');
      li.textContent = `${w} ${b ?? ''}`;
      return li;
    }),
  );
  movesEl.scrollTop = movesEl.scrollHeight;

  const bot = options?.opponent.type === 'bot' ? options.opponent : null;
  $<HTMLButtonElement>('undo').disabled = !game.history.length || (!!over && ['resign', 'timeout'].includes(over.reason));
  $<HTMLButtonElement>('resign').disabled = !!over;
  $('pause').textContent = paused ? 'Resume' : 'Pause';

  if (over) {
    statusEl.textContent = over.winner ? `${cap(over.winner)} wins by ${over.reason}` : `Draw by ${over.reason}`;
  } else {
    const turn = game.turn;
    const who = bot && bot.botSide === turn ? `Bot (${turn})` : cap(turn);
    statusEl.textContent = `${who} to move${checkSquare ? ' · check!' : ''}${paused ? ' · paused' : ''}`;
  }
  renderClocks();
}

function renderClocks(): void {
  const top: Side = flipped ? 'land' : 'sea';
  const bottom: Side = flipped ? 'sea' : 'land';
  for (const [id, side] of [['clock-top', top], ['clock-bottom', bottom]] as const) {
    const el = $(id);
    const ms = side === 'land' ? clocks.landMs : clocks.seaMs;
    const bot = options?.opponent.type === 'bot' && options.opponent.botSide === side;
    el.className = `clock ${side}${clocks.running === side ? ' running' : ''}`;
    el.innerHTML = '';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${cap(side)}${bot ? ' (bot)' : ''}`;
    if (bot && thinking) {
      const t = document.createElement('span');
      t.className = 'thinking';
      t.textContent = ' · thinking…';
      who.append(t);
    }
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatMs(ms);
    el.append(who, time);
  }
}

function isEnPassantTarget(sq: Square): boolean {
  const ep = game.fen.split(' ')[3];
  return ep === sq && !!selected && game.pieces.some((p) => p.square === selected && p.kind === 'p');
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  const s = ms / 1000;
  if (s < 10) return `0:0${s.toFixed(1)}`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function pairs<T>(xs: T[]): [T, T | undefined][] {
  const out: [T, T | undefined][] = [];
  for (let i = 0; i < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function log(name: string, text: string): void {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = name;
  li.append(b, ' ', text);
  logEl.prepend(li);
  while (logEl.children.length > 80) logEl.lastElementChild!.remove();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1400);
}

syncBotFields();
start();
