/**
 * Phase 6: every word the UI shows about the board-game modes (Sandcastle King, Stepping Stones).
 * Rules text follows GAME_SPEC.md "Board-game modes". If the spec changes, change it here too.
 */
import type { ArenaState, BoardMode, GameOver, PieceKind, PlayMode, PowerKind, Side } from '../contracts/types';
import { isBoardMode } from '../contracts/types';
import { ANIMAL_NAME, SIDE_NAME } from './config';

export const BOARD_MODES: BoardMode[] = ['castle', 'stones'];

/** Draft and HUD order: the spec's trait table, top to bottom. */
export const TRAIT_ORDER: PieceKind[] = ['p', 'n', 'b', 'r', 'q', 'k'];

/** Castle traits. Core's own name/line (askDraft `traits`, `pieceOptions().power`) win over these. */
export const TRAIT_TEXT: Record<PieceKind, { name: string; line: string; icon: string }> = {
  p: { name: 'Digger', line: 'After a dig, it may dig once more.', icon: '⛏️' },
  n: { name: 'Leaper', line: 'Its move may be a knight hop instead of a step.', icon: '🦘' },
  b: { name: 'Climber', line: 'It may go up 2 levels in one step.', icon: '🧗' },
  r: { name: 'Builder', line: 'A build adds 2 levels (up to 3).', icon: '🧱' },
  q: { name: 'Shover', line: 'Instead of moving, it may push a neighbouring enemy 1 square.', icon: '👐' },
  k: { name: 'Zoomer', line: 'Its move may be 2 steps.', icon: '💨' },
};

/** Stones powers (once per game; a power is the whole turn). Indexed by the chess power each kind carries. */
export const STONES_POWER_TEXT: Record<PowerKind, { name: string; line: string }> = {
  sidestep: { name: 'Bridge', line: 'Raise two sunk squares in a straight line. The first must touch dry land.' },
  doubleJump: { name: 'Double jump', line: 'Two knight hops onto empty dry squares, over water.' },
  headbutt: { name: 'Headbutt', line: 'Push a neighbouring enemy 1 square. Into the water sends it home.' },
  stomp: { name: 'Stomp', line: 'Sink every empty dry square around it in ranks 3–6.' },
  block: { name: 'Block', line: "A square nobody can sink or step on, for 4 turns." },
  escape: { name: 'Escape', line: 'Teleport to an empty dry square up to 2 squares away.' },
};

/** Castle trait text keyed by power, for the selected-animal panel's fallback. */
export const CASTLE_TRAIT_BY_POWER: Record<PowerKind, { name: string; line: string }> = {
  sidestep: TRAIT_TEXT.p, doubleJump: TRAIT_TEXT.n, headbutt: TRAIT_TEXT.b, stomp: TRAIT_TEXT.r, block: TRAIT_TEXT.q, escape: TRAIT_TEXT.k,
};

const pair = (k: PieceKind) => `${ANIMAL_NAME.land[k]} / ${ANIMAL_NAME.sea[k]}`;

/** The "How it works" sheet for both modes. */
export const BOARD_HOW_TO: Record<BoardMode, { title: string; items: string[] }[]> = {
  castle: [
    { title: 'Win', items: [
      'Stand on a castle (a level-3 square) and still be there at the start of your next turn.',
      'So when you step up, your opponent gets one turn to dig under you or push you off.',
      "After round 30 it's a draw. If neither side can do anything for a whole round, it's a draw too.",
      'No luck: no die, no duels, no cards. Everything is visible.',
    ] },
    { title: 'The draft', items: [
      'Each side picks 2 of its 6 animals. Picks alternate: Land, Sea, Land, Sea.',
      'Land starts on c2 and f2 (first pick on c2). Sea starts on c7 and f7.',
    ] },
    { title: 'Your turn', items: [
      '👣 Move one of your animals 1 step, in any direction, onto an empty square. It may go up at most 1 level, and down any number.',
      '🏖️ Then build or dig one square next to where that animal now stands.',
      'Build: +1 level, up to 3. Never on a square with an animal on it.',
      'Dig: −1 level, down to 0. You may dig under an enemy (it rides down with the square), but not under your own animal.',
    ] },
    { title: 'The tide', items: [
      '🌊 At the end of every 5th round, every empty beach square (ranks 5–8) loses one level. The meadow (ranks 1–4) never wears down.',
    ] },
    { title: 'Traits (always on)', items: [
      `⛏️ ${pair('p')}, Digger: after a dig, it may dig once more (the same square or another next to it). End turn skips it.`,
      `🦘 ${pair('n')}, Leaper: its move may be a knight hop instead of a step (still up at most 1 level).`,
      `🧗 ${pair('b')}, Climber: it may go up 2 levels in one step.`,
      `🧱 ${pair('r')}, Builder: a build adds 2 levels (only 1 on a level-2 square).`,
      `👐 ${pair('q')}, Shover: instead of moving, push a neighbouring enemy 1 square straight away. It may drop any number of levels but go up at most 1, and only onto an empty square. Then the shover builds or digs next to itself.`,
      `💨 ${pair('k')}, Zoomer: its move may be 2 steps. Each step follows the climbing rule, and it can't pass through an animal.`,
    ] },
  ],
  stones: [
    { title: 'Win', items: [
      'Be the first to stand an animal on the enemy back rank (Land on rank 8, Sea on rank 1).',
      "After round 25 it's a draw.",
      'No luck: no die, no duels, no cards. Everything is visible.',
    ] },
    { title: 'The sea', items: [
      'Ranks 3–6 start under water. Ranks 1–2 and 7–8 are dry.',
      'Six animals a side, one of each: Land on b2–g2, Sea on b7–g7.',
    ] },
    { title: 'Your turn', items: [
      '🪨 First shape the sea: raise one sunk square that touches dry land, or sink one empty dry square in ranks 3–6.',
      '⚡ Or use a power instead. A power is your whole turn: no move after it.',
      '👣 Then move one animal 1 step onto an empty dry square.',
      "🫧 Fresh squares: a square raised or sunk on the last turn can't be raised or sunk this turn.",
    ] },
    { title: 'Powers (once per game)', items: [
      `🌉 ${pair('p')}, Bridge: raise two sunk squares in a straight line. The first must touch dry land.`,
      `🐴 ${pair('n')}, Double jump: two knight hops onto empty dry squares. Water in between doesn't matter.`,
      `🐐 ${pair('b')}, Headbutt: push a neighbouring enemy 1 square straight away. Into the water, it's sent home (the nearest empty square on its back rank). Not off the board, or into an animal or block.`,
      `🐘 ${pair('r')}, Stomp: sink every empty dry square around it in ranks 3–6, fresh ones too.`,
      `🐱 ${pair('q')}, Block: a vase or ink cloud on an empty dry square. It can't be sunk or stepped on for 4 turns.`,
      `👑 ${pair('k')}, Escape: teleport to an empty dry square up to 2 squares away.`,
    ] },
  ],
};

// ---------- In-game words ----------

const ord = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`;

/** Name of an animal on the board by id. */
export function animalOf(st: ArenaState, id: string | null | undefined): { side: Side; kind: PieceKind; name: string } | null {
  const p = id ? st.pieces.find((x) => x.id === id) : undefined;
  return p ? { side: p.side, kind: p.kind, name: ANIMAL_NAME[p.side][p.kind] } : null;
}

/**
 * What the side to move does now, in plain words. `human` = said to the player ("Build or dig next to your Goat");
 * otherwise it describes the other side's turn ("Building or digging").
 */
export function stageWords(st: ArenaState, human: boolean): string {
  const stage = st.stage ?? (st.phase === 'draft' ? 'pick' : 'move');
  if (st.phase === 'draft' || stage === 'pick') {
    const mine = st.draft?.picks[st.turn].length ?? 0;
    const size = st.draft?.size ?? 2;
    return human ? `Pick your ${ord(mine + 1)} animal (of ${size})` : 'Picking an animal';
  }
  const mover = animalOf(st, st.mover);
  if (st.mode === 'castle') {
    switch (stage) {
      case 'move': return human ? 'Move an animal' : 'Moving an animal';
      case 'shape': return human ? (mover ? `Build or dig next to your ${mover.name}` : 'Build or dig') : 'Building or digging';
      case 'more': return human ? 'Dig again or end turn' : 'Digging again';
    }
  }
  return stage === 'shape'
    ? human ? 'Raise or sink a square, or use a power' : 'Shaping the sea'
    : human ? 'Move an animal' : 'Moving an animal';
}

/**
 * The crowned warning. `you` is the human side vs a bot (null in a local game). Says who must answer and how:
 * "dig under it or push it off" only when the answering side has a Shover.
 */
export function crownWords(st: ArenaState, you: Side | null): string | null {
  const c = st.crowned;
  if (!c) return null;
  const a = animalOf(st, c.pieceId);
  const name = a?.name ?? 'animal';
  const foe: Side = c.side === 'land' ? 'sea' : 'land';
  const canPush = st.pieces.some((p) => p.side === foe && p.kind === 'q');
  const answer = canPush ? 'dig under it or push it off!' : 'dig under it!';
  if (you === c.side) return `Your ${name} holds a castle! Keep it there through their turn to win.`;
  return `${SIDE_NAME[c.side]}'s ${name} holds a castle: ${answer}`;
}

/** "Tide in N" for the chip, or null. Mirrors Sumo's "Island sinks in N": 1 means the end of this round. */
export function tideWords(n: number | null | undefined): { text: string; urgent: boolean } | null {
  if (n === null || n === undefined) return null;
  return n <= 1 ? { text: 'Tide after this round!', urgent: true } : { text: `Tide in ${n}`, urgent: false };
}

/** The result line for the board-game modes, or null (the generic wording applies, e.g. resign). */
export function boardLine(r: GameOver, st: ArenaState | null, mode: PlayMode | undefined): string | null {
  const m = st?.mode ?? mode;
  if (!isBoardMode(m)) return null;
  const w = r.winner;
  switch (r.reason) {
    case 'castle': {
      if (!w) return null;
      const a = st && st.crowned?.side === w ? animalOf(st, st.crowned.pieceId) : null;
      return a ? `${SIDE_NAME[w]} wins by holding the castle: the ${a.name} stood its ground!` : `${SIDE_NAME[w]} wins by holding the castle!`;
    }
    case 'crossed': {
      if (!w) return null;
      const rank = w === 'land' ? '8' : '1';
      const p = st?.pieces.find((x) => x.side === w && x.square[1] === rank);
      return p ? `${SIDE_NAME[w]} wins by crossing the sea: the ${ANIMAL_NAME[w][p.kind]} reached the far shore!` : `${SIDE_NAME[w]} wins by crossing the sea!`;
    }
    case 'rounds': {
      const cap = st ? `Round ${st.maxRounds} is over` : 'The last round is over';
      if (w) return `${cap}. ${SIDE_NAME[w]} wins.`;
      return m === 'castle' ? `${cap} and nobody held a castle.` : `${cap} and nobody got across.`;
    }
    case 'stalemate':
      return 'Nobody could do anything for a whole round.';
    default:
      return null;
  }
}

/** The animal that won a board game (on the castle, or across the sea), for the result art. */
export function boardWinner(r: GameOver, st: ArenaState | null): { side: Side; kind: PieceKind } | null {
  if (!st || !r.winner) return null;
  if (r.reason === 'castle' && st.crowned?.side === r.winner) {
    const a = animalOf(st, st.crowned.pieceId);
    return a ? { side: a.side, kind: a.kind } : null;
  }
  if (r.reason === 'crossed') {
    const rank = r.winner === 'land' ? '8' : '1';
    const p = st.pieces.find((x) => x.side === r.winner && x.square[1] === rank);
    return p ? { side: p.side, kind: p.kind } : null;
  }
  return null;
}
