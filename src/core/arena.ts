/**
 * Party modes playtest: a plain 2D DOM board to play Sumo and Raid locally or against the bot. Dev tool only.
 * It only uses the ArenaController contract (events, `state`, `pieceOptions`, `targets`, `previewArea`), like integration will.
 */
import type {
  ArenaAction, ArenaController, ArenaMode, ArenaState, BotLevel, DuelInfo, GameOptions, Hand, PieceId, PieceKind,
  PieceState, Side, Square,
} from '../contracts/types';
import { createArena } from './index';
import { DEFAULT_ARENA_TUNING, getArenaTuning, setArenaTuning, type ArenaTuning } from './arena/tuning';

// Emoji stand-ins (no seahorse or blobfish emoji exist, so 🐠 and 🐟 stand in).
const EMOJI: Record<Side, Record<PieceKind, string>> = {
  land: { p: '🐕', n: '🐎', b: '🐐', r: '🐘', q: '🐈', k: '🐶' },
  sea: { p: '🦀', n: '🐠', b: '🐡', r: '🐢', q: '🐙', k: '🐟' },
};
const ANIMAL: Record<Side, Record<PieceKind, string>> = {
  land: { p: 'Pup', n: 'Horse', b: 'Goat', r: 'Elephant', q: 'Cat', k: 'Pug' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Turtle', q: 'Octopus', k: 'Blobfish' },
};
const LOOT: Record<Side, string> = { land: '🦴', sea: '🦪' };
const HOME_MARK: Record<Side, string> = { land: '🥣', sea: '🐚' };
const TREASURE: Record<Side, string> = { land: 'bone', sea: 'pearl' };
const POWER_TEXT: Record<ArenaMode, Record<PieceKind, [string, string]>> = {
  sumo: {
    p: ['Dig in', "It can't be pushed until your next turn."],
    n: ['Double jump', 'Two knight hops onto empty, dry squares.'],
    b: ['Headbutt', 'Shoves a neighbouring enemy 2 squares, heavy or not.'],
    r: ['Stomp', 'Shoves every neighbouring enemy 1 square straight away.'],
    q: ['Block', 'A vase or ink wall on an empty dry square, for 4 plies. Nothing can be pushed onto it.'],
    k: ['Escape', 'Teleport to an empty dry square up to 2 away.'],
  },
  raid: {
    p: ['Sidestep', 'One free step sideways (0 AP).'],
    n: ['Double jump', 'Two knight hops onto empty squares.'],
    b: ['Headbutt', 'Pushes a neighbouring enemy one square; a carrier drops the treasure.'],
    r: ['Stomp', 'Neighbouring enemies (not the king) are stunned for their next turn.'],
    q: ['Block', 'Blocks an empty square for 4 plies.'],
    k: ['Escape', 'Teleport to an empty square up to 2 away.'],
  },
};
const REASON: Record<string, string> = {
  used: 'Used', stunned: 'Stunned', frozen: 'Frozen', noTarget: 'No target', notYourTurn: 'Not your turn',
  wrongPhase: 'Not now (too little AP, or carrying)', classic: '',
};
const HAND_EMOJI: Record<Hand, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const LEVEL_NAMES = ['', 'Toddler', 'Puppy', 'Beachcomber', 'Club player', 'Strong', 'Expert', 'Master', 'Grandmaster'];
const FILES = 'abcdefgh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $('board');
const statusEl = $('status');
const logEl = $('log');
const storyEl = $('story');
const toastEl = $('toast');
const overlayEl = $('overlay');
const bannerEl = $('banner');

const game: ArenaController = createArena();
(window as unknown as { arena: ArenaController }).arena = game; // handy in the console

let options: GameOptions | null = null;
let st: ArenaState = game.state;
let selected: PieceId | null = null;
let aim: { pieceId: PieceId; targets: Square[] } | null = null;
let hoverHit: Square | null = null;
let flipped = false;
let thinking = false;
let paused = false;
let duel: DuelInfo | null = null;
let rolledAp = 0;
let roundShownAt = -Infinity;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const name = (p: { side: Side; kind: PieceKind }) => `${EMOJI[p.side][p.kind]} ${ANIMAL[p.side][p.kind]}`;
const pieceById = (id: string) => st.pieces.find((p) => p.id === id) ?? st.out.find((p) => p.id === id);
const pieceAt = (sq: Square) => st.pieces.find((p) => p.square === sq);
const botSide = (): Side | null => (options?.opponent.type === 'bot' ? options.opponent.botSide : null);
const myTurn = () => st.phase === 'action' && st.turn !== botSide();

// ---------- setup form ----------

const levelSel = $<HTMLSelectElement>('level');
for (let l = 1; l <= 8; l++) levelSel.add(new Option(`${l} · ${LEVEL_NAMES[l]}`, String(l), l === 3, l === 3));

function readOptions(): GameOptions {
  const mode = (document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'sumo') as ArenaMode;
  const seed = $<HTMLInputElement>('seed').value.trim();
  return {
    mode,
    opponent: $<HTMLSelectElement>('opponent').value === 'bot'
      ? { type: 'bot', level: Number(levelSel.value) as BotLevel, botSide: $<HTMLSelectElement>('botSide').value as Side }
      : { type: 'local' },
    time: { initialMs: null, incrementMs: 0 },
    weirdMode: false,
    ...(seed && Number.isFinite(Number(seed)) ? { seed: Number(seed) } : {}),
  };
}

const start = () => game.newGame(readOptions());
$('setup').addEventListener('submit', (e) => {
  e.preventDefault();
  start();
});
const syncFields = () => {
  const bot = $<HTMLSelectElement>('opponent').value === 'bot';
  levelSel.disabled = !bot;
  $<HTMLSelectElement>('botSide').disabled = !bot;
  renderRules();
};
$('opponent').addEventListener('change', syncFields);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', syncFields));

$('resign').addEventListener('click', () => {
  if (st.phase === 'over') return;
  const side = botSide() ? (botSide() === 'land' ? 'sea' : 'land') : st.turn;
  game.resign(side);
});
$('pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) game.pause();
  else game.resume();
  $('pause').textContent = paused ? 'Resume' : 'Pause';
});
$('flip').addEventListener('click', () => {
  flipped = !flipped;
  render();
});
$('show-ids').addEventListener('change', render);
$('end-turn').addEventListener('click', () => {
  if (!myTurn()) return;
  clearSelection();
  const r = game.act({ type: 'endTurn' });
  if (!r.ok) toast(r.reason);
});
$('prompt-cancel').addEventListener('click', () => {
  aim = null;
  render();
});
$('prompt-go').addEventListener('click', () => {
  if (aim) submit({ type: 'power', pieceId: aim.pieceId, targets: aim.targets });
});

// ---------- board ----------

function squareAt(row: number, col: number): Square {
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row : 7 - row;
  return `${FILES[file]}${rank + 1}` as Square;
}

function render(): void {
  const showIds = $<HTMLInputElement>('show-ids').checked;
  const opts = selected && !aim ? game.pieceOptions(selected) : null;
  const aimStep = aim ? game.targets(aim) : null;
  const preview = aim ? game.previewArea(aim) : selected && hoverHit ? game.previewArea({ pieceId: selected, hit: hoverHit }) : { area: [], falls: [] };
  const area = new Set<Square>(preview.area);
  const falls = new Set<Square>(preview.falls);
  const sunk = new Set(st.sunk);
  const warn = new Set(st.sinkingNext);
  const blocks = new Map(st.squares.map((b) => [b.square, b]));
  const statuses = new Map(st.statuses.map((x) => [x.pieceId, x]));
  const used = new Set(st.powersUsed);
  const selSq = selected ? pieceById(selected)?.square : null;

  const cells: HTMLElement[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(row, col);
      const f = sq.charCodeAt(0) - 97;
      const r = Number(sq[1]) - 1;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `sq ${r < 4 ? 'meadow' : 'beach'} ${(f + r) % 2 ? 'light' : 'dark'}`;
      el.dataset.sq = sq;
      if (sunk.has(sq)) el.classList.add('water');
      if (warn.has(sq)) el.classList.add('warn');
      if (selSq === sq && !aim) el.classList.add('selected');
      if (aim && aim.targets.includes(sq)) el.classList.add('picked');
      if (area.has(sq)) el.classList.add('area');
      if (falls.has(sq)) el.classList.add('falls');
      if (opts?.steps.includes(sq)) el.classList.add('target');
      const hitIdx = opts ? opts.hits.indexOf(sq) : -1;
      if (hitIdx >= 0) {
        el.classList.add('hit');
        el.append(tag('span', 'cost', `${opts!.hitCosts[hitIdx]} AP`));
      }
      if (aimStep?.squares.includes(sq)) el.classList.add('magic');

      for (const t of st.treasures) {
        if (t.home === sq) el.append(tag('span', 'home', HOME_MARK[t.owner]));
        if (t.square === sq) el.append(tag('span', `loot${t.square !== t.home ? ' dropped' : ''}`, LOOT[t.owner]));
      }
      const b = blocks.get(sq);
      if (b) {
        const blk = tag('span', `block ${b.by}`, b.by === 'land' ? '🏺' : '⚫');
        blk.append(tag('span', 'turns', String(b.turnsLeft)));
        el.append(blk);
      }
      const p = pieceAt(sq);
      if (p) {
        const pe = tag('span', `piece ${p.side}`, EMOJI[p.side][p.kind]);
        const status = statuses.get(p.id);
        if (status) pe.append(tag('span', `status ${status.status}`, status.status === 'anchored' ? '⚓' : '💫'));
        if (!used.has(p.id)) pe.append(tag('span', 'ready', ''));
        const carried = st.treasures.find((t) => t.carrier === p.id);
        if (carried) pe.append(tag('span', 'carry', LOOT[carried.owner]));
        el.append(pe);
        if (showIds) el.append(tag('span', 'id', p.id));
      }
      if (col === 0 || row === 7) el.append(tag('span', 'coord', col === 0 && row === 7 ? sq : col === 0 ? sq[1] : sq[0]));
      el.setAttribute('aria-label', `${sq}${p ? ` ${p.side} ${ANIMAL[p.side][p.kind]}` : ''}${sunk.has(sq) ? ' water' : ''}`);
      cells.push(el);
    }
  }
  boardEl.replaceChildren(...cells);
  renderBars();
  renderStatus();
  renderSelection(opts);
  renderPrompt(aimStep);
}

function tag(t: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(t);
  e.className = cls;
  e.textContent = text;
  return e;
}

boardEl.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.sq');
  if (!el || !overlayEl.hidden) return;
  onSquare(el.dataset.sq as Square);
});
boardEl.addEventListener('mouseover', (e) => {
  const sq = (e.target as HTMLElement).closest<HTMLElement>('.sq')?.dataset.sq as Square | undefined;
  const next = sq && selected && !aim && game.pieceOptions(selected).hits.includes(sq) ? sq : null;
  if (next !== hoverHit) {
    hoverHit = next;
    render();
  }
});

function onSquare(sq: Square): void {
  if (!myTurn()) {
    if (st.phase === 'action' && st.turn === botSide()) toast('The bot is playing');
    return;
  }
  if (aim) {
    const step = game.targets(aim);
    if (!step.squares.includes(sq)) {
      aim = null;
      return render();
    }
    aim = { ...aim, targets: [...aim.targets, sq] };
    const next = game.targets(aim);
    if (next.complete && !next.squares.length) return submit({ type: 'power', pieceId: aim.pieceId, targets: aim.targets });
    return render();
  }
  if (selected) {
    const o = game.pieceOptions(selected);
    if (o.steps.includes(sq)) return submit({ type: 'step', pieceId: selected, to: sq });
    if (o.hits.includes(sq)) return submit({ type: 'hit', pieceId: selected, target: sq });
  }
  const p = pieceAt(sq);
  if (p && p.side === st.turn) {
    selected = p.id === selected ? null : p.id;
  } else {
    selected = null;
  }
  hoverHit = null;
  render();
}

function submit(a: ArenaAction): void {
  const r = game.act(a);
  aim = null;
  hoverHit = null;
  if (!r.ok) toast(r.reason);
  // Keep the animal selected so its next options show straight away.
  if (selected && !pieceById(selected)) selected = null;
  render();
}

function clearSelection(): void {
  selected = null;
  aim = null;
  hoverHit = null;
}

// ---------- HUD ----------

function renderBars(): void {
  const top: Side = flipped ? 'land' : 'sea';
  const bottom: Side = top === 'land' ? 'sea' : 'land';
  fillBar($('bar-top'), top);
  fillBar($('bar-bottom'), bottom);

  const pips: HTMLElement[] = [];
  const total = Math.max(rolledAp, st.ap);
  for (let k = 0; k < total; k++) pips.push(tag('span', `pip${k < st.ap ? ' on' : ''}`, ''));
  const label = st.phase === 'over' ? 'Game over' : `${cap(st.turn)}${st.turn === botSide() ? ' (bot)' : ''}: ${st.ap} AP`;
  $('ap').replaceChildren(tag('span', '', label), ...pips);
  $<HTMLButtonElement>('end-turn').disabled = !myTurn();
}

function fillBar(el: HTMLElement, side: Side): void {
  el.classList.toggle('turn', st.turn === side && st.phase !== 'over');
  const bits: HTMLElement[] = [tag('span', 'who', `${cap(side)}${botSide() === side ? ' (bot)' : ''}${st.turn === side && st.phase !== 'over' ? ' ▶' : ''}`)];
  if (st.mode === 'sumo') {
    const animals = tag('span', 'pill', '');
    const all: PieceState[] = [...st.pieces.filter((p) => p.side === side), ...st.out.filter((p) => p.side === side)];
    all.sort((a, b) => 'nbqkrp'.indexOf(a.kind) - 'nbqkrp'.indexOf(b.kind));
    for (const p of all) animals.append(tag('span', st.out.includes(p) ? 'out' : '', EMOJI[p.side][p.kind]));
    bits.push(animals, tag('span', 'pill', `${st.pieces.filter((p) => p.side === side).length} left`));
  } else {
    const theirs = st.treasures.find((t) => t.owner !== side)!;
    bits.push(tag('span', 'pill', `⭐ ${st.score[side]} / ${st.target}`));
    bits.push(tag('span', 'pill', `Their ${TREASURE[theirs.owner]} ${LOOT[theirs.owner]}: ${where(theirs)}`));
  }
  const powers = st.pieces.filter((p) => p.side === side && !st.powersUsed.includes(p.id)).length;
  bits.push(tag('span', 'pill', `✨ ${powers} power${powers === 1 ? '' : 's'}`), tag('span', 'pill', `⚔️ ${st.duelTokens[side]} duel token${st.duelTokens[side] === 1 ? '' : 's'}`));
  if (thinking && botSide() === side) bits.push(tag('span', 'muted', 'thinking…'));
  el.replaceChildren(...bits);
}

function where(t: ArenaState['treasures'][number]): string {
  if (t.carrier) {
    const p = pieceById(t.carrier);
    return `carried by the ${p ? ANIMAL[p.side][p.kind] : '?'}`;
  }
  return t.square === t.home ? 'home' : `dropped on ${t.square}`;
}

function renderStatus(): void {
  const parts = [`Round ${st.round} / ${st.maxRounds}`];
  if (st.mode === 'sumo') {
    if (st.nextSinkIn !== null) parts.push(st.nextSinkIn === 1 ? '⚠️ The island sinks at the end of this round!' : `Island sinks in ${st.nextSinkIn}`);
    else parts.push('No more sinking');
  } else {
    parts.push(`Land ${st.score.land} – ${st.score.sea} Sea (to ${st.target})`, `Wheel in ${st.nextWheelIn}`);
  }
  if (st.die) parts.push(`🎲 ${st.die}`);
  if (st.phase === 'duel') parts.push('Duel!');
  statusEl.textContent = parts.join(' · ');
  statusEl.classList.toggle('urgent', st.mode === 'sumo' && st.nextSinkIn === 1);
}

function renderSelection(opts: ReturnType<ArenaController['pieceOptions']> | null): void {
  const el = $('selection');
  const p = selected ? pieceById(selected) : null;
  if (!p || !opts || aim) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const [pname, help] = [opts.power.name ?? POWER_TEXT[st.mode][p.kind][0], opts.power.line ?? POWER_TEXT[st.mode][p.kind][1]];
  const carrying = st.treasures.some((t) => t.carrier === p.id);
  const lines = [
    tag('span', 'sel-name', `${name(p)}${carrying ? ' (carrying)' : ''}`),
    tag('span', 'sel-help', `Step ${opts.stepCost} AP · ${opts.steps.length} step${opts.steps.length === 1 ? '' : 's'}, ${opts.hits.length} ${st.mode === 'sumo' ? 'shove' : 'tag'}${opts.hits.length === 1 ? '' : 's'}. Power: ${pname}: ${help}`),
  ];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = opts.power.available ? `Use ${pname} (${st.mode === 'raid' && p.kind === 'p' ? 0 : 2} AP)` : `${pname}: ${opts.power.note ?? REASON[opts.power.reason ?? ''] ?? opts.power.reason}`;
  btn.disabled = !opts.power.available || !myTurn();
  btn.addEventListener('click', () => {
    aim = { pieceId: p.id, targets: [] };
    render();
  });
  const wrap = tag('span', 'sel-buttons', '');
  wrap.append(btn);
  el.replaceChildren(...lines, wrap);
}

function renderPrompt(step: ReturnType<ArenaController['targets']> | null): void {
  const el = $('prompt');
  el.hidden = !aim;
  if (!aim || !step) return;
  $('prompt-text').textContent = step.prompt;
  $('prompt-go').hidden = !step.complete;
}

// ---------- overlays: duels, banners ----------

function showOverlay(...children: (Node | string)[]): void {
  overlayEl.replaceChildren(...children);
  overlayEl.hidden = false;
  overlayEl.querySelector<HTMLButtonElement>('button')?.focus();
}
function hideOverlay(): void {
  overlayEl.hidden = true;
  overlayEl.replaceChildren();
}
function para(text: string, cls = ''): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  return p;
}
function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
function row(...bs: HTMLElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'overlay-row';
  d.append(...bs);
  return d;
}

function duelText(info: DuelInfo): string {
  const att = pieceById(info.attackerId);
  const vic = pieceById(info.victimId);
  const a = `${cap(info.attacker)}'s ${att ? name(att) : 'animal'}`;
  const v = `your ${vic ? name(vic) : 'animal'}`;
  return info.via === 'tag'
    ? `${a} wants to tag ${v} and make it drop the ${TREASURE[info.attacker]}!`
    : `${a} wants to shove ${v} into the sea!`;
}

function askDuel(info: DuelInfo): void {
  showOverlay(
    para(`${cap(info.defender)}: ${duelText(info)}`, 'big'),
    para(`Call a duel? (${info.tokensLeft} token${info.tokensLeft === 1 ? '' : 's'} left)`),
    row(
      button('Yes, duel!', () => {
        hideOverlay();
        game.answerDuel(true);
      }, 'primary'),
      button('No', () => {
        hideOverlay();
        game.answerDuel(false);
      }),
    ),
  );
}

/** Ask each human in the duel for a secret hand. Local games cover the screen between picks. */
function askThrows(): void {
  if (!duel) return;
  const humans = [duel.attacker, duel.defender].filter((s) => s !== botSide());
  const hotSeat = humans.length === 2;
  const ask = (k: number) => {
    if (k >= humans.length || !duel) return;
    const side = humans[k];
    const pick = () =>
      showOverlay(
        para(`${cap(side)}: pick your hand`, 'big'),
        row(...(['rock', 'paper', 'scissors'] as Hand[]).map((h) => {
          const b = button(HAND_EMOJI[h], () => {
            hideOverlay();
            ask(k + 1); // queue the next picker first: the last throw resolves the round at once
            game.throwHand(side, h);
          }, 'hand');
          b.setAttribute('aria-label', h);
          return b;
        })),
      );
    if (!hotSeat) return pick();
    const other = side === 'land' ? 'Sea' : 'Land';
    showOverlay(para(`${cap(side)}, take the device. ${other}, look away!`, 'big'), row(button(`I'm ${cap(side)}`, pick, 'primary')));
  };
  ask(0);
}

let bannerTimer: ReturnType<typeof setTimeout> | undefined;
function showBanner(text: string, ms = 1800): void {
  bannerEl.textContent = text;
  bannerEl.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (bannerEl.hidden = true), ms);
}
bannerEl.addEventListener('click', () => (bannerEl.hidden = true));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1500);
}

function story(text: string): void {
  const li = document.createElement('li');
  li.textContent = text;
  storyEl.prepend(li);
  while (storyEl.children.length > 80) storyEl.lastElementChild!.remove();
}

function raw(name: string, text: string): void {
  const li = document.createElement('li');
  li.innerHTML = `<b></b> `;
  li.querySelector('b')!.textContent = name;
  li.append(text);
  logEl.prepend(li);
  while (logEl.children.length > 200) logEl.lastElementChild!.remove();
}

/** What integration does: hold the bot while an animation plays. */
function fakeAnimation(): void {
  if (!$<HTMLInputElement>('sim-anim').checked || paused) return;
  game.pause();
  setTimeout(() => {
    if (!paused) game.resume();
  }, 600);
}

// ---------- game events ----------

game.on('started', (e) => {
  options = e.options;
  st = e.state;
  clearSelection();
  duel = null;
  paused = false;
  $('pause').textContent = 'Pause';
  hideOverlay();
  flipped = e.options.opponent.type === 'bot' && e.options.opponent.botSide === 'land';
  logEl.replaceChildren();
  storyEl.replaceChildren();
  const who = e.options.opponent.type === 'bot' ? `vs bot level ${e.options.opponent.level} (bot is ${e.options.opponent.botSide})` : 'local 2-player';
  story(`New ${cap(e.options.mode ?? 'sumo')} game, ${who}. Seed ${e.options.seed ?? 'random'}.`);
  raw('started', `${e.options.mode} · seed ${e.options.seed ?? 'random'}`);
  render();
});
game.on('state', (s) => {
  st = s;
  if (s.phase === 'duel' && duel) {
    // A state with phase 'duel' starts a throw round (after the call, and after each tie).
    const wait = Math.max(0, 1100 - (performance.now() - roundShownAt));
    const info = duel;
    setTimeout(() => {
      if (duel !== info) return;
      hideOverlay();
      askThrows();
    }, wait);
  }
  if (selected && (!pieceById(selected) || s.turn !== pieceById(selected)!.side || !s.pieces.some((p) => p.id === selected))) clearSelection();
  if (aim && s.phase !== 'action') aim = null;
  raw('state', `round ${s.round} · ${s.turn} · ${s.phase} · ${s.ap} AP · ${s.pieces.length} on board`);
  render();
});
game.on('rolled', (r) => {
  rolledAp = r.ap;
  story(`🎲 ${cap(r.side)} rolled ${r.value} → ${r.ap} AP`);
  raw('rolled', `${r.side} ${r.value} → ${r.ap}`);
});
game.on('acted', (a) => {
  raw('acted', `${a.side} ${a.action.type}${a.power ? ` (${a.power})` : ''} · ${a.changes.map((c) => `${c.step}:${c.type}${c.type === 'treasure' ? `/${c.event}` : ''}`).join(' ')}`);
  for (const c of a.changes) {
    if (c.type === 'fall') {
      const p = pieceById(c.pieceId);
      showBanner(p?.kind === 'k' ? `👑💦 ${p ? name(p) : 'The king'} fell in!` : `💦 ${p ? name(p) : 'Splash'}!`, 1200);
    }
    if (c.type === 'treasure' && c.event === 'score') showBanner(`⭐ ${cap(c.owner === 'land' ? 'sea' : 'land')} scores!`, 1400);
    if (c.type === 'treasure' && c.event === 'pickup') {
      // `st` is still the state from before this action: a grab from home scores.
      const t = st.treasures.find((x) => x.owner === c.owner);
      const pts = getArenaTuning().grabPoints;
      showBanner(`${LOOT[c.owner]} Grabbed!${t && t.square === t.home && pts ? ` +${pts}` : ''}`, 900);
    }
  }
  fakeAnimation();
});
game.on('logged', (l) => {
  const icon = l.kind === 'wheel' ? '🌊' : l.kind === 'bonk' ? '💥' : l.kind === 'power' ? '✨' : l.kind === 'pass' ? '⏭️' : '👣';
  story(`${icon} ${l.side ? `${cap(l.side)}: ` : ''}${l.label}`);
  raw('logged', `[${l.kind}] ${l.label}`);
});
game.on('sank', (s) => {
  showBanner(`🌊 The island sinks! ${s.changes.length ? `${s.changes.length} fell in` : ''}`, 1600);
  raw('sank', `${s.squares.length} squares · ${s.changes.length} fell`);
  fakeAnimation();
});
game.on('wheelSpun', (w) => {
  showBanner(`🎡 Wheel of Chaos: ${cap(w.outcome)}!`, 1600);
  raw('wheelSpun', `${w.outcome}${w.direction ? ` ${w.direction}` : ''} · ${w.changes.length} changes`);
  fakeAnimation();
});
game.on('turnChanged', (t) => {
  rolledAp = 0;
  clearSelection();
  raw('turnChanged', t.turn);
});
game.on('duelOffered', (info) => {
  duel = info;
  clearSelection();
  raw('duelOffered', `${info.attackerId} → ${info.victimId} via ${info.via} · ${info.tokensLeft} tokens`);
  if (info.defender !== botSide()) askDuel(info);
  else showOverlay(para(`${cap(info.defender)} (bot) is deciding whether to duel…`));
  render();
});
game.on('duelRound', (r) => {
  const who = r.result === 'tie' ? 'Tie, again!' : r.result === 'attacker' ? `${cap(r.info.attacker)} wins the throw` : `${cap(r.info.defender)} wins the throw`;
  story(`✊ Throw ${r.round}: ${cap(r.info.attacker)} ${HAND_EMOJI[r.attackerHand]} vs ${cap(r.info.defender)} ${HAND_EMOJI[r.defenderHand]}. ${who}`);
  raw('duelRound', `${r.round} ${r.attackerHand}/${r.defenderHand} ${r.result}`);
  showOverlay(para(`${HAND_EMOJI[r.attackerHand]}  vs  ${HAND_EMOJI[r.defenderHand]}`, 'hands'), para(who, 'big'));
  roundShownAt = performance.now();
});
game.on('duelEnded', (d) => {
  duel = null;
  if (!d.called) story(`${cap(d.info.defender)} didn't call a duel`);
  else story(`Duel over: ${d.winner === 'attacker' ? cap(d.info.attacker) : cap(d.info.defender)} wins`);
  raw('duelEnded', `called ${d.called} · ${d.winner}`);
  setTimeout(() => {
    if (!duel) hideOverlay();
    render();
  }, d.called ? 1100 : 0);
});
game.on('bonked', (b) => {
  showBanner('💥 Bonked! Nothing moves.', 1200);
  raw('bonked', `${b.info.attackerId} → ${b.info.victimId}`);
  fakeAnimation();
});
game.on('gameOver', (o) => {
  const how: Record<string, string> = {
    kingOverboard: 'king overboard', treasure: 'treasure', rounds: 'the round cap', resign: 'resignation',
  };
  const text = o.winner ? `🏆 ${cap(o.winner)} wins by ${how[o.reason] ?? o.reason}` : `🤝 Draw (${how[o.reason] ?? o.reason})`;
  story(text);
  showBanner(text, 3000);
  raw('gameOver', `${o.winner ?? 'draw'} · ${o.reason}`);
  duel = null;
  hideOverlay();
  render();
});
game.on('botThinking', (b) => {
  thinking = b.thinking;
  renderBars();
});

// ---------- tuning ----------

type Path = (string | number)[];
const tuningEl = $('tuning');
const fields: { path: Path; input: HTMLInputElement; kind: 'num' | 'bool' | 'list' | 'text' }[] = [];

function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], obj);
}
function setAt(obj: unknown, path: Path, value: unknown): void {
  const last = path[path.length - 1];
  (getAt(obj, path.slice(0, -1)) as Record<string | number, unknown>)[last] = value;
}

function renderTuning(t: ArenaTuning): void {
  fields.length = 0;
  const group = (title: string, ...items: HTMLElement[]) => {
    const fs = document.createElement('fieldset');
    fs.append(tag('legend', '', title), ...items);
    return fs;
  };
  const field = (label: string, path: Path, kind: 'num' | 'bool' | 'list' | 'text' = 'num') => {
    const l = document.createElement('label');
    const input = document.createElement('input');
    const v = getAt(t, path);
    if (kind === 'bool') {
      input.type = 'checkbox';
      input.checked = !!v;
      l.className = 'check';
      l.append(input, ` ${label}`);
    } else {
      input.type = kind === 'num' ? 'number' : 'text';
      if (kind === 'num') input.step = 'any';
      input.value = kind === 'list' ? (v as unknown[]).join(',') : String(v);
      l.append(label, input);
    }
    fields.push({ path, input, kind });
    return l;
  };
  const levels = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((lv) =>
    group(`Bot level ${lv}`,
      field('Max actions', ['bot', lv, 'maxActions']), field('Beam', ['bot', lv, 'beam']),
      field('Random chance', ['bot', lv, 'randomChance']), field('Noise', ['bot', lv, 'noise']),
      field('Look ahead', ['bot', lv, 'lookahead'], 'bool'), field('Min think ms', ['bot', lv, 'minThinkMs'])));
  tuningEl.replaceChildren(
    group('AP from the die (faces 1–6)', ...[0, 1, 2, 3, 4, 5].map((k) => field(`Face ${k + 1}`, ['apTable', k]))),
    group('Costs (AP)',
      field('Step', ['stepCost']), field('Carrier step', ['carrierStepCost']), field('Shove', ['shoveCost']),
      field('Heavy shove', ['heavyShoveCost']), field('Heavy kinds (k,r…)', ['heavyKinds'], 'list'), field('Tag', ['tagCost']),
      field('Power', ['powerCost']), field('Raid Sidestep', ['sidestepCost'])),
    group('Sumo',
      field('Sink after rounds', ['sinkRounds'], 'list'), field('Headbutt squares', ['headbuttSquares']), field('Round cap', ['sumoMaxRounds'])),
    group('Raid',
      field('Points to win', ['pointsToWin']), field('Grab points', ['grabPoints']), field('Bring-home points', ['scorePoints']),
      field('Round cap', ['raidMaxRounds']), field('Bone home', ['treasureHomes', 'land'], 'text'), field('Pearl home', ['treasureHomes', 'sea'], 'text'),
      field('No guarding', ['noGuarding'], 'bool'), field('Tag stuns (else sends home)', ['tagStuns'], 'bool'),
      field('Tide sweeps both sides', ['tideBothWays'], 'bool'),
      field('Wheel every N rounds', ['wheelEvery']), field('Tide odds', ['wheelOdds', 'tide']), field('Pigeon odds', ['wheelOdds', 'pigeon']),
      field('Earthquake odds', ['wheelOdds', 'earthquake']), field('Disco odds', ['wheelOdds', 'disco']), field('Stun turns', ['stunTurns'])),
    group('Both', field('Duel tokens', ['duelTokens']), field('Ties before attacker wins', ['tieLimit']), field('Block plies', ['blockPlies'])),
    ...levels,
  );
}

function readTuning(): ArenaTuning {
  const t = getArenaTuning();
  for (const f of fields) {
    if (f.kind === 'bool') setAt(t, f.path, f.input.checked);
    else if (f.kind === 'text') {
      const v = f.input.value.trim().toLowerCase();
      if (/^[a-h][1-8]$/.test(v)) setAt(t, f.path, v);
    }
    else if (f.kind === 'list') {
      const items = f.input.value.split(',').map((x) => x.trim()).filter(Boolean);
      setAt(t, f.path, f.path[0] === 'heavyKinds' ? items : items.map(Number).filter((n) => Number.isFinite(n)));
    } else {
      const n = Number(f.input.value);
      if (Number.isFinite(n)) setAt(t, f.path, n);
    }
  }
  return t;
}

$('tuning-apply').addEventListener('click', () => {
  setArenaTuning(readTuning());
  start();
});
$('tuning-reset').addEventListener('click', () => {
  setArenaTuning(null);
  renderTuning(DEFAULT_ARENA_TUNING);
});

// ---------- rules sheet ----------

function renderRules(): void {
  const t = getArenaTuning();
  const h = (text: string) => tag('h3', '', text);
  const ul = (...items: string[]) => {
    const u = document.createElement('ul');
    for (const i of items) u.append(tag('li', '', i));
    return u;
  };
  $('rules').replaceChildren(
    h('Both modes'),
    ul(
      `Roll the die each turn: 1–2 → ${t.apTable[0]} AP, 3–4 → ${t.apTable[2]} AP, 5–6 → ${t.apTable[4]} AP. Spend it on any animals, then End turn.`,
      `Step: ${t.stepCost} AP, one square any direction onto an empty square.`,
      `Powers: ${t.powerCost} AP, once per game per animal. ${t.duelTokens} duel tokens each.`,
    ),
    h('Sumo'),
    ul(
      'Win: push the enemy king into the sea. Your own king falling in on your turn loses; both at once is a draw.',
      `Shove: ${t.shoveCost} AP (${t.heavyShoveCost} for a king or rook). The whole line moves; whoever is pushed off the end falls in.`,
      `The outer ring sinks after round ${t.sinkRounds[0]}, then ${t.sinkRounds.slice(1).join(' and ')}. It wobbles the round before.`,
      `After round ${t.sumoMaxRounds}, more animals left wins.`,
    ),
    h('Raid'),
    ul(
      `Steal the other side's treasure (bone ${t.treasureHomes.land}, pearl ${t.treasureHomes.sea}): grabbing it from home scores ${t.grabPoints}, carrying it into your own half ${t.scorePoints} more. First to ${t.pointsToWin}.`,
      `Carrying: steps cost ${t.carrierStepCost} AP and no power. You can't stand on your own home square.`,
      `Tag (${t.tagCost} AP): in your own half, tag a neighbouring enemy. ${t.tagStuns ? 'It is stunned for its next turn; a carrier is instead sent home and drops the treasure. A stunned animal can\'t be tagged.' : 'It is sent home; a carrier drops the treasure.'}`,
      `Wheel of Chaos every ${t.wheelEvery} rounds (the tide sweeps ${t.tideBothWays ? 'both sides' : 'Land'} back toward home). After round ${t.raidMaxRounds}, more points wins.`,
    ),
  );
}

// ---------- go ----------

renderTuning(getArenaTuning());
syncFields();
start();
