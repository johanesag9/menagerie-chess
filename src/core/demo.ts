/**
 * Core playtest: a plain 2D DOM board to play all three modes locally or against the bot. Dev tool only.
 * Classic uses chess.js + Stockfish; Normal and Crazy use core's own rules and bot.
 */
import type {
  ActionInput, BotLevel, Card, DuelInfo, EmoteKind, GameEventMap, GameMode, GameOptions, Hand, ModeState,
  PendingAction, PieceKind, Side, Square,
} from '../contracts/types';
import { POWER_OF } from '../contracts/types';
import { createGame } from './index';
import { ANIMAL, CARD_NAME, CARD_SYMBOL, JOKER_NAME, POWER_NAME, WHEEL_NAME } from './modes/rules';
import { DEFAULT_TUNING, getTuning, setTuning, type Tuning } from './modes/tuning';

// Emoji stand-ins (no seahorse or blobfish emoji exist, so 🐠 and 🐟 stand in).
const EMOJI: Record<Side, Record<PieceKind, string>> = {
  land: { p: '🐕', n: '🐎', b: '🐐', r: '🐘', q: '🐈', k: '🐶' },
  sea: { p: '🦀', n: '🐠', b: '🐡', r: '🐢', q: '🐙', k: '🐟' },
};
const POWER_HELP: Record<string, string> = {
  sidestep: 'Move one square left or right, to an empty square. No capture.',
  doubleJump: 'Two knight moves in one turn. The first must land on an empty square; the second may capture.',
  headbutt: 'Push a neighbouring enemy one square straight away. The bishop stays put.',
  stomp: 'Stun every neighbouring enemy (not the king): it skips its next turn.',
  block: 'Block an empty square: nothing lands on it or slides through it, for 4 plies.',
  escape: 'Teleport to an empty square up to 2 away.',
};
const REASON: Record<string, string> = {
  classic: 'Classic has no powers', used: 'Used', stunned: 'Stunned', frozen: 'Frozen', noTarget: 'No target',
  notYourTurn: 'Not your turn', wrongPhase: 'Not now',
};
const HAND_EMOJI: Record<Hand, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const WHEEL_HELP: Record<string, string> = {
  tide: 'Land pieces on the beach get swept back a rank.',
  pigeon: 'A pigeon steals a random pawn.',
  earthquake: 'Every piece shifts one file.',
  disco: 'Every used power recharges.',
};
const LEVEL_NAMES = ['', 'Toddler', 'Puppy', 'Beachcomber', 'Club player', 'Strong', 'Expert', 'Master', 'Grandmaster'];
const EMOTES: [EmoteKind, string][] = [['laugh', '😂'], ['angry', '😠'], ['love', '😍'], ['shock', '😱'], ['sleepy', '😴'], ['taunt', '😜']];
const FILES = 'abcdefgh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $('board');
const statusEl = $('status');
const logEl = $('log');
const storyEl = $('story');
const movesEl = $('moves');
const promoEl = $('promo');
const toastEl = $('toast');
const overlayEl = $('overlay');
const bannerEl = $('banner');

const game = createGame();
(window as unknown as { coreGame: typeof game }).coreGame = game; // handy in the console

let options: GameOptions;
let selected: Square | null = null;
let targets: Square[] = [];
let aim: PendingAction | null = null;
let flipped = false;
let checkSquare: Square | null = null;
let weirdSquares = new Set<Square>();
let clocks: GameEventMap['clock'] = { landMs: null, seaMs: null, running: null };
let thinking = false;
let paused = false;
let pendingPromo: { from: Square; to: Square } | null = null;
let ms: ModeState | null = null;
let duel: DuelInfo | null = null;
let lastMove: [Square, Square] | null = null;

const name = (p: { side: Side; kind: PieceKind }) => `${EMOJI[p.side][p.kind]} ${ANIMAL[p.side][p.kind]}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const mode = (): GameMode => game.mode;
const pieceById = (id: string) => game.pieces.find((p) => p.id === id);

// ---------- setup form ----------

const levelSel = $<HTMLSelectElement>('level');
for (let l = 1; l <= 8; l++) levelSel.add(new Option(`${l} · ${LEVEL_NAMES[l]}`, String(l), l === 3, l === 3));

function readMode(): GameMode {
  return (document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'normal') as GameMode;
}

function readOptions(): GameOptions {
  const opp = $<HTMLSelectElement>('opponent').value;
  const t = $<HTMLSelectElement>('time').value;
  const [initial, inc] = t === 'none' ? [null, 0] : t.split('+').map(Number);
  const fen = $<HTMLInputElement>('fen').value.trim();
  const seed = $<HTMLInputElement>('seed').value.trim();
  return {
    mode: readMode(),
    opponent: opp === 'bot'
      ? { type: 'bot', level: Number(levelSel.value) as BotLevel, botSide: $<HTMLSelectElement>('botSide').value as Side }
      : { type: 'local' },
    time: { initialMs: initial, incrementMs: inc },
    weirdMode: $<HTMLInputElement>('weird').checked,
    ...(fen ? { fen } : {}),
    ...(seed && Number.isFinite(Number(seed)) ? { seed: Number(seed) } : {}),
  };
}

function start(): void {
  try {
    game.newGame(readOptions());
    $('fen-error').textContent = '';
  } catch (err) {
    $('fen-error').textContent = (err as Error).message;
  }
}

$('setup').addEventListener('submit', (e) => {
  e.preventDefault();
  start();
});
const syncFields = () => {
  const bot = $<HTMLSelectElement>('opponent').value === 'bot';
  levelSel.disabled = !bot;
  $<HTMLSelectElement>('botSide').disabled = !bot;
  $('weird-wrap').hidden = readMode() === 'crazy';
};
$('opponent').addEventListener('change', syncFields);
document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener('change', syncFields));

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
$('prompt-cancel').addEventListener('click', () => {
  aim = null;
  render();
});
$('prompt-go').addEventListener('click', submitAim);
$('lucky-recharge').addEventListener('click', () => startAim({ type: 'bonus', choice: 'recharge', targets: [] }));
$('lucky-step').addEventListener('click', () => startAim({ type: 'bonus', choice: 'pawnStep', targets: [] }));
$('lucky-skip').addEventListener('click', () => {
  aim = null;
  report(game.act({ type: 'bonus', choice: 'skip' }));
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
  'Land: ' + (Object.keys(EMOJI.land) as PieceKind[]).map((k) => `${EMOJI.land[k]} ${ANIMAL.land[k]}`).join(', ') +
  '. Sea: ' + (Object.keys(EMOJI.sea) as PieceKind[]).map((k) => `${EMOJI.sea[k]} ${ANIMAL.sea[k]}`).join(', ') +
  '. 🐠 and 🐟 stand in for the seahorse and blobfish. A gold dot = power still ready. 💫 stunned, 🧊 frozen, 🏺 Land block, ⚫ Sea ink.';

function botSide(): Side | null {
  return options?.opponent.type === 'bot' ? options.opponent.botSide : null;
}
function humanSide(): Side {
  const b = botSide();
  return b ? (b === 'land' ? 'sea' : 'land') : game.turn;
}
/** Can a person act for the side to move right now? */
function myTurn(): boolean {
  return !game.isOver() && !duel && game.turn !== botSide();
}

// ---------- board input ----------

boardEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sq');
  if (btn) onSquare(btn.dataset.sq as Square);
});

function onSquare(sq: Square): void {
  if (pendingPromo || !overlayEl.hidden || game.isOver()) return;
  if (aim) {
    const step = game.targets(aim);
    if (step.squares.includes(sq)) {
      aim = { ...aim, targets: [...aim.targets, sq] } as PendingAction;
      const next = game.targets(aim);
      if (next.complete && !next.squares.length) submitAim();
      else render();
    } else {
      shakeSquare(sq);
    }
    return;
  }
  if (ms?.phase === 'bonus') return shakeSquare(sq);
  if (selected && targets.includes(sq)) {
    if (game.needsPromotion(selected, sq)) return askPromotion(selected, sq);
    doMove({ from: selected, to: sq });
    return;
  }
  const own = game.pieces.find((p) => p.square === sq && p.side === game.turn);
  if (own && sq !== selected && myTurn()) {
    selected = sq;
    targets = game.legalTargets(sq);
    if (!targets.length && mode() === 'classic') shakeSquare(sq);
  } else {
    if (selected && sq !== selected) shakeSquare(sq);
    clearSelection();
  }
  render();
}

function doMove(m: { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' }): void {
  clearSelection();
  report(game.act({ type: 'move', ...m }));
}

function report(r: ReturnType<typeof game.act>): void {
  if (!r.ok) toast(r.reason);
  render();
}

function clearSelection(): void {
  selected = null;
  targets = [];
}

function startAim(p: PendingAction): void {
  clearSelection();
  aim = p;
  const step = game.targets(p);
  if (!step.squares.length && !step.complete) {
    toast(step.prompt || 'Nothing to pick');
    aim = null;
  }
  render();
}

function submitAim(): void {
  if (!aim) return;
  const a = aim;
  aim = null;
  let input: ActionInput;
  if (a.type === 'bonus') input = { type: 'bonus', choice: a.choice, targets: [a.targets[0]] } as ActionInput;
  else input = a as ActionInput;
  report(game.act(input));
}

function askPromotion(from: Square, to: Square): void {
  pendingPromo = { from, to };
  const side = game.turn;
  const row = $('promo-row');
  row.replaceChildren(
    ...(['q', 'r', 'b', 'n'] as const).map((k) =>
      button(EMOJI[side][k], () => {
        promoEl.hidden = true;
        const p = pendingPromo!;
        pendingPromo = null;
        doMove({ ...p, promotion: k });
      }, ANIMAL[side][k]),
    ),
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

function button(text: string, onClick: () => void, label?: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  if (label) {
    b.title = label;
    b.setAttribute('aria-label', label);
  }
  b.addEventListener('click', onClick);
  return b;
}

// ---------- overlays: revive picker, duels ----------

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
function row(...bs: HTMLElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'overlay-row';
  d.append(...bs);
  return d;
}

function playCard(side: Side, card: Card): void {
  if (side !== game.turn || !myTurn() || ms?.phase !== 'action') return;
  if (!ms[side].playableCards.includes(card.id)) return toast(`${CARD_NAME[card.suit]} can't do anything right now`);
  if (card.suit === 'hearts') {
    const dead = ms[side].captured.filter((p) => p.kind !== 'k');
    showOverlay(
      para(`♥ Revive: who comes back?`, 'big'),
      row(...dead.map((p) => button(name(p), () => {
        hideOverlay();
        startAim({ type: 'card', cardId: card.id, pieceId: p.id, targets: [] });
      }))),
      row(button('Cancel', hideOverlay, undefined, 'ghost')),
    );
    return;
  }
  startAim({ type: 'card', cardId: card.id, targets: [] });
}

function askDuel(info: DuelInfo): void {
  const att = pieceById(info.attackerId);
  const vic = pieceById(info.victimId);
  showOverlay(
    para(`${cap(info.defender)}: ${cap(info.attacker)}'s ${att ? name(att) : 'piece'} wants to bonk your ${vic ? name(vic) : 'piece'}!`, 'big'),
    para(`Call a duel? (${info.tokensLeft} token${info.tokensLeft === 1 ? '' : 's'} left)`),
    row(
      button('Yes, duel!', () => {
        hideOverlay();
        game.answerDuel(true);
        if (duel) askThrows();
      }, undefined, 'primary'),
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
        row(...(['rock', 'paper', 'scissors'] as Hand[]).map((h) => button(HAND_EMOJI[h], () => {
          hideOverlay();
          ask(k + 1); // queue the next picker first: the last throw resolves the round at once
          game.throwHand(side, h);
        }, h, 'hand'))),
      );
    if (!hotSeat) return pick();
    const other = side === 'land' ? 'Sea' : 'Land';
    showOverlay(para(`${cap(side)}, take the device. ${other}, look away!`, 'big'), row(button(`I'm ${cap(side)}`, pick, undefined, 'primary')));
  };
  ask(0);
}

function showBanner(text: string, ms = 2200): void {
  bannerEl.textContent = text;
  bannerEl.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (bannerEl.hidden = true), ms);
}
let bannerTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- game events ----------

/** What integration does: hold clocks and the bot while an animation plays. */
function fakeAnimation(): void {
  if (!$<HTMLInputElement>('sim-anim').checked || paused) return;
  game.pause();
  setTimeout(() => {
    if (!paused) game.resume();
  }, 600);
}

game.on('gameStarted', (e) => {
  options = e.options;
  clearSelection();
  aim = null;
  duel = null;
  ms = null;
  lastMove = null;
  checkSquare = null;
  paused = false;
  hideOverlay();
  flipped = e.options.opponent.type === 'bot' && e.options.opponent.botSide === 'land';
  logEl.replaceChildren();
  storyEl.replaceChildren();
  const who = e.options.opponent.type === 'bot' ? `vs bot level ${e.options.opponent.level} (bot is ${e.options.opponent.botSide})` : 'local 2-player';
  story(`New ${cap(e.options.mode ?? 'classic')} game, ${who}. ${cap(e.turn)} to move.`);
  raw('gameStarted', `${e.options.mode ?? 'classic'} · ${e.pieces.length} pieces · seed ${e.options.seed ?? 'random'}`);
  render();
});
game.on('moved', (m) => {
  checkSquare = null;
  lastMove = [m.from, m.slide?.to ?? m.to];
  const p = { side: m.side, kind: m.kind };
  let text = `${cap(m.side)} ${name(p)} ${m.from}→${m.to}`;
  if (m.captured) text += `, bonked ${cap(m.captured.side)}'s ${name(m.captured)}`;
  if (m.rookMove) text += ` (castled)`;
  if (m.slide) text += `, then slipped on a banana to ${m.slide.to} 🍌`;
  if (m.promotion) text += `, and became a ${name({ side: m.side, kind: m.promotion })}`;
  story(text);
  raw('moved', `${m.san} · ${m.pieceId}${m.promotedId ? ` → ${m.promotedId}` : ''} [${m.flags.join(',')}]`);
  fakeAnimation();
  render();
});
game.on('powerUsed', (r) => {
  checkSquare = null;
  const p = pieceById(r.pieceId) ?? { side: r.side, kind: kindOf(r.pieceId) };
  const caps = r.changes.filter((c) => c.type === 'capture');
  const stuns = r.changes.filter((c) => c.type === 'status');
  const verbs: Record<string, string> = {
    sidestep: 'sidestepped', doubleJump: 'double-jumped', headbutt: 'headbutted', stomp: 'stomped', block: 'blocked', escape: 'escaped',
  };
  const first = r.changes[0];
  const from = first?.type === 'move' && first.pieceId === r.pieceId ? `${first.from}→` : '';
  let text = `${cap(r.side)} ${name(p)} ${verbs[r.power]}${r.targets.length ? ` ${from}${r.targets.join('→')}` : ''}`;
  if (r.power === 'headbutt') {
    const mv = r.changes.find((c) => c.type === 'move');
    if (mv && mv.type === 'move') text = `${cap(r.side)} ${name(p)} headbutted ${describeId(mv.pieceId)} ${mv.from}→${mv.to}`;
  }
  if (caps.length) text += ` and bonked ${caps.map((c) => (c.type === 'capture' ? describeId(c.pieceId) : '')).join(', ')}`;
  if (r.power === 'stomp') text += `: ${stuns.length ? stuns.map((c) => (c.type === 'status' ? describeId(c.pieceId) : '')).join(', ') + ' stunned 💫' : 'nobody new got stunned'}`;
  story(`⚡ ${text}`);
  raw('powerUsed', `${r.pieceId} ${r.power} [${r.targets.join(',')}] · ${r.changes.length} changes`);
  if (r.changes.some((c) => c.type === 'move')) lastMove = null;
  fakeAnimation();
  render();
});
game.on('cardPlayed', (r) => {
  const sym = `${CARD_SYMBOL[r.card.suit]} ${CARD_NAME[r.card.suit]}`;
  let text = `${cap(r.side)} played ${sym}`;
  const ch = r.changes;
  switch (r.card.suit) {
    case 'hearts': {
      const sp = ch.find((c) => c.type === 'spawn');
      if (sp && sp.type === 'spawn') text += `: ${name(sp.piece)} is back on ${sp.piece.square}`;
      break;
    }
    case 'diamonds': text += `: ${r.targets.join(' ↔ ')}`; break;
    case 'clubs': text += `: ${describeAt(r.targets[0])} is frozen 🧊`; break;
    case 'spades': text += `: the pawn on ${r.targets[0]} digs back`; break;
    case 'joker': text += ` → ${JOKER_NAME[r.joker!]}! ${jokerText(r)}`; break;
  }
  story(`🃏 ${text}`);
  raw('cardPlayed', `${r.card.id} ${r.card.suit}${r.joker ? `:${r.joker}` : ''} · ${ch.length} changes`);
  if (r.card.suit === 'joker') showBanner(`🃏 Joker: ${JOKER_NAME[r.joker!]}!`, 1600);
  fakeAnimation();
  render();
});
game.on('bonusUsed', (b) => {
  const c = b.changes[0];
  if (b.choice === 'skip') story(`🍀 ${cap(b.side)} skipped the lucky bonus`);
  else if (c?.type === 'recharge') story(`🍀 ${cap(b.side)} recharged ${c.pieceIds.map(describeId).join(', ')}`);
  else if (c?.type === 'move') story(`🍀 ${describeId(c.pieceId)} stepped ${c.from}→${c.to}`);
  raw('bonusUsed', `${b.side} ${b.choice}`);
  render();
});
game.on('dieRolled', (d) => {
  const t = d.effect === 'banana' ? '🍌 1: banana peel! A normal move slides one more square.' : d.effect === 'lucky' ? '🍀 6: lucky!' : `🎲 ${d.value}`;
  story(`${cap(d.side)} rolled ${t}`);
  raw('dieRolled', `${d.side} ${d.value} ${d.effect}`);
});
game.on('cardDrawn', (c) => {
  story(`${cap(c.side)} drew a card${c.side === botSide() ? '' : `: ${CARD_SYMBOL[c.card.suit]} ${CARD_NAME[c.card.suit]}`}`);
  raw('cardDrawn', `${c.side} ${c.card.id} ${c.card.suit}`);
});
game.on('wheelSpun', (w) => {
  const moved = w.changes.filter((c) => c.type === 'move').length;
  let detail = '';
  if (w.outcome === 'tide' || w.outcome === 'earthquake') detail = ` ${moved} piece${moved === 1 ? '' : 's'} moved${w.direction ? ` ${w.direction}` : ''}.`;
  if (w.outcome === 'pigeon') {
    const c = w.changes[0];
    detail = c?.type === 'capture' ? ` It stole ${describeAt(c.square, c.pieceId)}!` : ' No pawns, it flew past.';
  }
  if (w.outcome === 'disco') detail = w.changes.length ? ' Used powers are back!' : ' Nothing to recharge.';
  showBanner(`🎡 Wheel of Chaos: ${WHEEL_NAME[w.outcome]}! ${WHEEL_HELP[w.outcome]}`);
  story(`🎡 Wheel of Chaos: ${WHEEL_NAME[w.outcome]}!${detail}`);
  raw('wheelSpun', `${w.outcome}${w.direction ? ` ${w.direction}` : ''} · ${w.changes.length} changes`);
  lastMove = null;
  fakeAnimation();
  render();
});
game.on('turnPassed', (t) => story(`😶 ${cap(t.side)} had nothing to do, so the turn passed`));
game.on('duelOffered', (info) => {
  duel = info;
  clearSelection();
  aim = null;
  raw('duelOffered', `${info.attackerId} → ${info.victimId} via ${info.via}${info.mid ? ` mid ${info.mid}` : ''} · ${info.tokensLeft} tokens`);
  if (info.defender !== botSide()) askDuel(info);
  else showOverlay(para(`${cap(info.defender)} (bot) is deciding whether to duel…`));
  render();
});
game.on('duelRound', (r) => {
  const who = r.result === 'tie' ? 'Tie, again!' : r.result === 'attacker' ? `${cap(r.info.attacker)} wins the throw` : `${cap(r.info.defender)} wins the throw`;
  story(`✊ Throw ${r.round}: ${cap(r.info.attacker)} ${HAND_EMOJI[r.attackerHand]} vs ${cap(r.info.defender)} ${HAND_EMOJI[r.defenderHand]}. ${who}`);
  raw('duelRound', `${r.round} ${r.attackerHand}/${r.defenderHand} ${r.result}`);
  showOverlay(para(`${HAND_EMOJI[r.attackerHand]}  vs  ${HAND_EMOJI[r.defenderHand]}`, 'hands'), para(who, 'big'));
  const round = r.round;
  setTimeout(() => {
    // Still dueling after a tie: throw again.
    if (duel && duel === r.info && round === r.round) {
      hideOverlay();
      askThrows();
    }
  }, 1100);
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
  story(`💥 Bonked! ${describeId(b.info.attackerId)} bounced back to ${b.info.from}`);
  showBanner('💥 Bonked!', 1200);
  fakeAnimation();
});
game.on('logged', (l) => raw('logged', `[${l.kind}] ${l.label}`));
game.on('modeState', (m) => {
  ms = m;
  if (aim && m.phase !== 'action' && aim.type !== 'bonus') aim = null;
  raw('modeState', `round ${m.round} · ${m.phase}${m.die ? ` · die ${m.die.value}` : ''} · ${m.statuses.length} statuses · ${m.squares.length} blocks`);
  render();
});
game.on('check', (c) => {
  checkSquare = c.kingSquare;
  story(mode() === 'crazy' ? `⚠️ ${cap(c.side)}'s king in danger!` : `⚠️ ${cap(c.side)} is in check`);
  raw('check', `${c.side} king on ${c.kingSquare}`);
  render();
});
game.on('turnChanged', (t) => raw('turnChanged', `${t.turn} · ${t.legalMoveCount} legal moves`));
game.on('gameOver', (o) => {
  const how: Record<string, string> = { kingCaptured: 'bonking the king' };
  story(o.winner ? `🏆 ${cap(o.winner)} wins by ${how[o.reason] ?? o.reason}` : `🤝 Draw (${o.reason})`);
  raw('gameOver', `${o.winner ?? 'draw'} · ${o.reason}`);
  duel = null;
  hideOverlay();
  render();
});
game.on('clock', (c) => {
  clocks = c;
  renderClocks();
});
game.on('botThinking', (b) => {
  thinking = b.thinking;
  raw('botThinking', `${b.side} ${b.thinking ? 'thinking…' : 'done'}`);
  renderClocks();
});
game.on('weirdEvent', (w) => {
  raw('weirdEvent', `${w.kind} · ${w.durationTurns} turn(s)`);
  toast(`Weird: ${w.kind}`);
  weirdSquares = new Set(w.squares ?? []);
  render();
  setTimeout(() => {
    weirdSquares = new Set();
    render();
  }, 1600);
});
game.on('undone', () => {
  clearSelection();
  aim = null;
  checkSquare = null;
  lastMove = null;
  story('↩️ Undo');
  render();
});
game.on('emote', (e) => {
  raw('emote', `${e.side} ${e.emote}`);
  toast(`${e.side}: ${EMOTES.find(([k]) => k === e.emote)?.[1] ?? e.emote}`);
});

function kindOf(id: string): PieceKind {
  return id.split('-')[1] as PieceKind;
}
function describeId(id: string): string {
  const p = pieceById(id);
  const side = (p?.side ?? id.split('-')[0]) as Side;
  return `${cap(side)}'s ${name({ side, kind: p?.kind ?? kindOf(id) })}`;
}
function describeAt(sq: Square, id?: string): string {
  const p = id ? undefined : game.pieces.find((x) => x.square === sq);
  return id ? describeId(id) : p ? `${cap(p.side)}'s ${name(p)}` : sq;
}
function jokerText(r: GameEventMap['cardPlayed']): string {
  const c = r.changes[0];
  switch (r.joker) {
    case 'party': return c?.type === 'recharge' ? `${c.pieceIds.length} power(s) recharged.` : 'No used powers to recharge.';
    case 'teleport': return c?.type === 'move' ? `${describeId(c.pieceId)} jumped ${c.from}→${c.to}.` : 'Nobody could teleport.';
    case 'butterfingers': return c?.type === 'status' ? `${describeId(c.pieceId)} is frozen 🧊.` : 'Nothing got frozen.';
    case 'double': return `Drew ${r.drawn?.length ?? 0} card(s).`;
    default: return '';
  }
}

// ---------- rendering ----------

function render(): void {
  const showIds = $<HTMLInputElement>('show-ids').checked;
  const bySquare = new Map(game.pieces.map((p) => [p.square, p]));
  const over = game.isOver();
  const step = aim ? game.targets(aim) : null;
  const area = new Set(aim ? game.previewArea(aim) : []);
  const magic = new Set(step?.squares ?? []);
  const picked = new Set(aim?.targets ?? []);
  const blocks = new Map((ms?.squares ?? []).map((b) => [b.square, b]));
  const statuses = new Map((ms?.statuses ?? []).map((s) => [s.pieceId, s]));
  const used = new Set([...(ms?.land.powersUsed ?? []), ...(ms?.sea.powersUsed ?? [])]);
  const squares: HTMLButtonElement[] = [];
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? r + 1 : 8 - r;
      const file = FILES[flipped ? 7 - col : col];
      const sq = `${file}${rank}` as Square;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq';
      b.dataset.sq = sq;
      b.classList.add(rank <= 4 ? 'meadow' : 'beach', (FILES.indexOf(file) + rank) % 2 === 1 ? 'dark' : 'light');
      if (sq === selected) b.classList.add('selected');
      if (targets.includes(sq)) b.classList.add(bySquare.has(sq) || isEnPassantTarget(sq) ? 'capture' : 'target');
      if (magic.has(sq)) b.classList.add('magic');
      if (picked.has(sq)) b.classList.add('picked');
      if (area.has(sq)) b.classList.add('area');
      if (lastMove && (sq === lastMove[0] || sq === lastMove[1])) b.classList.add('last');
      if (sq === checkSquare && !(over && !['checkmate', 'kingCaptured'].includes(over.reason))) b.classList.add('check');
      if (weirdSquares.has(sq)) b.classList.add('weird');
      const block = blocks.get(sq);
      let label: string = sq;
      if (block) {
        const bl = document.createElement('span');
        bl.className = `block ${block.by}`;
        bl.textContent = block.by === 'land' ? '🏺' : '⚫';
        const n = document.createElement('span');
        n.className = 'turns';
        n.textContent = String(block.turnsLeft);
        bl.append(n);
        b.append(bl);
        label = `${sq}, blocked by ${block.by} for ${block.turnsLeft} more plies`;
      }
      const p = bySquare.get(sq);
      if (p) {
        const piece = document.createElement('span');
        piece.className = `piece ${p.side}`;
        piece.textContent = EMOJI[p.side][p.kind];
        const kind = document.createElement('span');
        kind.className = 'kind';
        kind.textContent = p.kind.toUpperCase();
        piece.append(kind);
        if (p.kind === 'k') piece.append(span('crown', '👑'));
        if (ms && !used.has(p.id)) piece.append(span('ready', ''));
        const st = statuses.get(p.id);
        if (st) piece.append(span(`status ${st.status}`, `${st.status === 'stunned' ? '💫' : '🧊'}${st.turnsLeft}`));
        b.append(piece);
        if (showIds) b.append(span('id', p.id));
        label = `${sq}, ${p.side} ${ANIMAL[p.side][p.kind]}${st ? `, ${st.status}` : ''}${ms && used.has(p.id) ? ', power used' : ''}`;
        b.title = `${p.id} (${sq})`;
      }
      if ((flipped ? rank === 8 : rank === 1) || (flipped ? file === 'h' : file === 'a')) b.append(span('coord', sq));
      b.setAttribute('aria-label', label);
      squares.push(b);
    }
  }
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.sq;
  boardEl.replaceChildren(...squares);
  if (focused) boardEl.querySelector<HTMLElement>(`[data-sq="${focused}"]`)?.focus();

  renderMoves();
  renderModeBars();
  renderPrompt(step);
  renderSelection();

  const bot = botSide();
  const canUndo = mode() === 'normal' || mode() === 'classic';
  $<HTMLButtonElement>('undo').disabled = !canUndo || !game.history.length || (!!over && ['resign', 'timeout'].includes(over.reason));
  $('undo').title = mode() === 'crazy' ? 'No undo in Crazy: luck is luck' : '';
  $<HTMLButtonElement>('resign').disabled = !!over;
  $('pause').textContent = paused ? 'Resume' : 'Pause';

  if (over) {
    const how = over.reason === 'kingCaptured' ? 'bonking the king' : over.reason;
    statusEl.textContent = over.winner ? `${cap(over.winner)} wins by ${how}` : `Draw by ${over.reason}`;
  } else {
    const turn = game.turn;
    const who = bot === turn ? `Bot (${turn})` : cap(turn);
    const extra = ms
      ? ` · round ${ms.round}${ms.nextWheelIn !== null ? ` · wheel in ${ms.nextWheelIn}` : ''}${ms.die ? ` · ${dieText(ms.die.value, ms.die.effect)}` : ''}`
      : '';
    const danger = checkSquare ? (mode() === 'crazy' ? ' · King in danger!' : ' · check!') : '';
    statusEl.textContent = `${who} to move${danger}${extra}${paused ? ' · paused' : ''}`;
  }
  renderClocks();
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function dieText(value: number, effect: string): string {
  return effect === 'banana' ? `🍌 ${value} banana peel` : effect === 'lucky' ? `🍀 ${value} lucky` : `🎲 ${value}`;
}

function renderMoves(): void {
  if (mode() === 'classic') {
    movesEl.replaceChildren(
      ...pairs(game.history.map((m) => m.san)).map(([w, b]) => {
        const li = document.createElement('li');
        li.textContent = `${w} ${b ?? ''}`;
        return li;
      }),
    );
    movesEl.classList.remove('lines');
  } else {
    movesEl.classList.add('lines');
    movesEl.replaceChildren(
      ...game.log.map((l) => {
        const li = document.createElement('li');
        li.className = l.kind === 'move' ? `line ${l.side}` : `line other ${l.side ?? 'wheel'}`;
        li.textContent = `${l.side ? (l.side === 'land' ? 'L' : 'S') : '🎡'} ${l.label}`;
        return li;
      }),
    );
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

function renderModeBars(): void {
  const top: Side = flipped ? 'land' : 'sea';
  const bottom: Side = flipped ? 'sea' : 'land';
  for (const [id, side] of [['bar-top', top], ['bar-bottom', bottom]] as const) {
    const el = $(id);
    el.hidden = !ms;
    if (!ms) continue;
    const m = ms[side];
    const pieces = game.pieces.filter((p) => p.side === side);
    const ready = pieces.filter((p) => !m.powersUsed.includes(p.id)).length;
    const bits: HTMLElement[] = [span('who', `${cap(side)}${side === botSide() ? ' (bot)' : ''}`), span('pill', `⚡ ${ready}/${pieces.length} powers`)];
    if (ms.mode === 'crazy') {
      bits.push(span('pill', `⚔️ ${m.duelTokens} duel token${m.duelTokens === 1 ? '' : 's'}`));
      bits.push(span('pill', `🂠 card in ${m.nextCardIn}`));
      if (m.captured.length) bits.push(span('pill', `💀 ${m.captured.map((p) => EMOJI[p.side][p.kind]).join('')}`));
      const hand = document.createElement('span');
      hand.className = 'hand';
      const hidden = side === botSide();
      for (const c of m.hand) {
        const playable = m.playableCards.includes(c.id) && side === game.turn && myTurn();
        const b = button(hidden ? '🂠' : `${CARD_SYMBOL[c.suit]} ${CARD_NAME[c.suit]}`, () => playCard(side, c),
          hidden ? 'Bot card (hidden)' : `${CARD_NAME[c.suit]}${playable ? '' : ' (not playable now)'}`, `card ${c.suit}`);
        b.disabled = hidden || !playable;
        if (aim?.type === 'card' && aim.cardId === c.id) b.classList.add('aiming');
        hand.append(b);
      }
      if (!m.hand.length) hand.append(span('muted', 'no cards'));
      bits.push(hand);
    }
    el.className = `modebar ${side}${side === game.turn ? ' turn' : ''}`;
    el.replaceChildren(...bits);
  }
  const lucky = $('lucky');
  const showLucky = !!ms && ms.phase === 'bonus' && myTurn() && !aim;
  lucky.hidden = !showLucky;
  if (showLucky) {
    $<HTMLButtonElement>('lucky-recharge').disabled = !game.targets({ type: 'bonus', choice: 'recharge', targets: [] }).squares.length;
    $<HTMLButtonElement>('lucky-step').disabled = !game.targets({ type: 'bonus', choice: 'pawnStep', targets: [] }).squares.length;
  }
}

function renderPrompt(step: ReturnType<typeof game.targets> | null): void {
  const el = $('prompt');
  el.hidden = !aim;
  if (!aim || !step) return;
  let head = '';
  if (aim.type === 'power') {
    const p = pieceById(aim.pieceId);
    if (p) head = `${name(p)} · ${POWER_NAME[POWER_OF[p.kind]]}: `;
  } else if (aim.type === 'card') {
    const c = ms?.[game.turn].hand.find((x) => x.id === (aim as { cardId: string }).cardId);
    if (c) head = `${CARD_SYMBOL[c.suit]} ${CARD_NAME[c.suit]}: `;
  } else {
    head = '🍀 Lucky: ';
  }
  $('prompt-text').textContent = head + step.prompt;
  const go = $<HTMLButtonElement>('prompt-go');
  go.hidden = !(step.complete && !step.squares.length);
  go.textContent = aim.type === 'card' ? 'Play it' : 'Do it';
}

function renderSelection(): void {
  const el = $('selection');
  const p = selected ? game.pieces.find((x) => x.square === selected) : null;
  if (!p || !ms || aim) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const info = game.powerInfo(p.id);
  const title = span('sel-name', `${name(p)} · ${POWER_NAME[info.power]}`);
  const help = span('sel-help', POWER_HELP[info.power]);
  const use = button(info.available ? `Use ${POWER_NAME[info.power]}` : REASON[info.reason ?? 'noTarget'], () =>
    startAim({ type: 'power', pieceId: p.id, targets: [] }), undefined, 'primary');
  use.disabled = !info.available;
  el.replaceChildren(title, help, use);
}

function renderClocks(): void {
  const top: Side = flipped ? 'land' : 'sea';
  const bottom: Side = flipped ? 'sea' : 'land';
  for (const [id, side] of [['clock-top', top], ['clock-bottom', bottom]] as const) {
    const el = $(id);
    const t = side === 'land' ? clocks.landMs : clocks.seaMs;
    const bot = botSide() === side;
    el.className = `clock ${side}${clocks.running === side ? ' running' : ''}`;
    el.innerHTML = '';
    const who = span('who', `${cap(side)}${bot ? ' (bot)' : ''}`);
    if (bot && thinking) who.append(span('thinking', ' · thinking…'));
    el.append(who, span('time', formatMs(t)));
  }
}

function isEnPassantTarget(sq: Square): boolean {
  const ep = game.fen.split(' ')[3];
  return ep === sq && !!selected && game.pieces.some((p) => p.square === selected && p.kind === 'p');
}

function formatMs(t: number | null): string {
  if (t === null) return '—';
  const s = t / 1000;
  if (s < 10) return `0:0${s.toFixed(1)}`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function pairs<T>(xs: T[]): [T, T | undefined][] {
  const out: [T, T | undefined][] = [];
  for (let i = 0; i < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function raw(evt: string, text: string): void {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = evt;
  li.append(b, ' ', text);
  logEl.prepend(li);
  while (logEl.children.length > 120) logEl.lastElementChild!.remove();
}

/** The plain-English log under the board. */
function story(text: string): void {
  const li = document.createElement('li');
  li.textContent = text;
  storyEl.prepend(li);
  while (storyEl.children.length > 60) storyEl.lastElementChild!.remove();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1600);
}

// ---------- tuning panel ----------

type Path = (string | number)[];
const tuningEl = $('tuning');

function buildTuning(t: Tuning): void {
  tuningEl.replaceChildren();
  const field = (label: string, path: Path, value: number | boolean | string, help = '') => {
    const l = document.createElement('label');
    l.textContent = label;
    if (help) l.title = help;
    let input: HTMLInputElement | HTMLSelectElement;
    if (typeof value === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
      l.className = 'check';
      l.prepend(input);
    } else if (typeof value === 'string') {
      input = document.createElement('select');
      for (const o of ['banana', 'none', 'lucky']) input.add(new Option(o, o, false, o === value));
      l.append(input);
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.min = '0';
      input.value = String(value);
      l.append(input);
    }
    input.dataset.path = JSON.stringify(path);
    return l;
  };
  const group = (title: string, ...items: HTMLElement[]) => {
    const g = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = title;
    g.append(lg, ...items);
    tuningEl.append(g);
  };
  group('Cards', ...Object.entries(t.cardOdds).map(([k, v]) => field(`${CARD_SYMBOL[k as Card['suit']]} odds`, ['cardOdds', k], v)),
    field('Start hand', ['startHand'], t.startHand), field('Draw every N own turns', ['drawEvery'], t.drawEvery),
    field('Hand limit', ['handLimit'], t.handLimit));
  group('Joker odds', ...Object.entries(t.jokerOdds).map(([k, v]) => field(k, ['jokerOdds', k], v)));
  group('Duels', field('Tokens', ['duelTokens'], t.duelTokens), field('Ties before attacker wins', ['tieLimit'], t.tieLimit));
  group('Wheel', field('Every N rounds', ['wheelEvery'], t.wheelEvery),
    ...Object.entries(t.wheelOdds).map(([k, v]) => field(`${k} odds`, ['wheelOdds', k], v)),
    field('Tide pulls Sea back too', ['tideBothSides'], t.tideBothSides));
  group('Die faces', ...t.dieFaces.map((v, i) => field(`Face ${i + 1}`, ['dieFaces', i], v)));
  group('Lengths', field('Block (plies)', ['blockPlies'], t.blockPlies), field('Stun (own turns)', ['stunTurns'], t.stunTurns),
    field('Freeze (own turns)', ['freezeTurns'], t.freezeTurns));
  group('Bot (depth · random chance · time ms)', ...Object.entries(t.bot).flatMap(([lvl, b]) => [
    field(`L${lvl} depth`, ['bot', lvl, 'depth'], b.depth), field(`L${lvl} random`, ['bot', lvl, 'randomChance'], b.randomChance),
    field(`L${lvl} ms`, ['bot', lvl, 'timeMs'], b.timeMs),
  ]));
}

function readTuning(): Tuning {
  const t = getTuning() as unknown as Record<string, unknown>;
  tuningEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach((el) => {
    const path = JSON.parse(el.dataset.path!) as Path;
    let obj = t as Record<string | number, unknown>;
    for (const k of path.slice(0, -1)) obj = obj[k] as Record<string | number, unknown>;
    const last = path[path.length - 1];
    if (el instanceof HTMLSelectElement) obj[last] = el.value;
    else if (el.type === 'checkbox') obj[last] = el.checked;
    else if (el.value !== '' && Number.isFinite(Number(el.value))) obj[last] = Math.max(0, Number(el.value));
  });
  return t as unknown as Tuning;
}

$('tuning-apply').addEventListener('click', () => {
  setTuning(readTuning());
  if (readMode() === 'classic') document.querySelector<HTMLInputElement>('input[name="mode"][value="normal"]')!.checked = true;
  syncFields();
  start();
  toast('Tuning applied');
});
$('tuning-reset').addEventListener('click', () => {
  setTuning(null);
  buildTuning(DEFAULT_TUNING);
  toast('Back to the defaults (for new games)');
});

buildTuning(getTuning());
syncFields();
start();
