/**
 * Every word the UI shows about the game modes (Phase 3), in one place like config.ts.
 * Rules text follows GAME_SPEC.md "Game modes". If the spec changes, change it here too.
 */
import type { ArenaMode, CardSuit, DieValue, GameMode, Hand, JokerOutcome, PieceKind, PlayMode, PowerBlock, PowerKind, Side, WheelOutcome } from '../contracts/types';

export const MODE_TEXT: Record<PlayMode, { name: string; pitch: string; icon: string }> = {
  classic: { name: 'Classic', pitch: 'Real chess, exactly. Every move in character.', icon: '♟️' },
  normal: { name: 'Normal', pitch: 'Chess plus one animal power per piece.', icon: '⚡' },
  crazy: { name: 'Crazy', pitch: 'Powers, dice, duels, cards and the Wheel of Chaos. Bonk the king to win.', icon: '🎲' },
  // Phase 4: party modes (not chess).
  sumo: { name: 'Sumo', pitch: 'Shove the enemy king into the sea while the island sinks.', icon: '🏝️' },
  raid: { name: 'Raid', pitch: "Grab their treasure, pass and run it home. First to 5 wins.", icon: '🦴' },
};

export const MODES: GameMode[] = ['classic', 'normal', 'crazy'];
/** Phase 4: the party modes, shown as a second row on the setup screen. */
export const ARENA_MODES: ArenaMode[] = ['sumo', 'raid'];
export const ALL_MODES: PlayMode[] = [...MODES, ...ARENA_MODES];

export const POWER_TEXT: Record<PowerKind, { name: string; line: string; flavour: Record<Side, string> }> = {
  sidestep: { name: 'Sidestep', line: 'Move one square left or right, to an empty square. No capture.', flavour: { land: 'The pup digs across.', sea: 'The crab scuttles.' } },
  doubleJump: { name: 'Double jump', line: 'Two knight hops in one turn. The first must land on an empty square.', flavour: { land: 'The horse leaps twice.', sea: 'The seahorse bubbles twice.' } },
  headbutt: { name: 'Headbutt', line: 'Push a neighbouring enemy one square straight away. You stay put.', flavour: { land: 'The goat rams.', sea: 'The pufferfish bonks.' } },
  stomp: { name: 'Stomp', line: "Stun every neighbouring enemy (not the king): it can't act next turn.", flavour: { land: 'The elephant stomps.', sea: 'The turtle slams its shell.' } },
  block: { name: 'Block', line: 'Block an empty square. Nothing can land on it or pass through.', flavour: { land: 'The cat knocks over a vase.', sea: 'The octopus inks it.' } },
  escape: { name: 'Escape', line: 'Teleport to an empty square up to 2 squares away.', flavour: { land: 'Pug zoomies!', sea: 'The blobfish blorps.' } },
};

/** Why the power button is greyed. */
export const POWER_BLOCK_TEXT: Record<PowerBlock, string> = {
  classic: 'No powers in Classic',
  used: 'Used',
  stunned: 'Stunned',
  frozen: 'Frozen',
  noTarget: 'No target',
  notYourTurn: 'Not your turn',
  wrongPhase: 'Not right now',
};

export const SUIT: Record<CardSuit, { symbol: string; name: string; line: string; red: boolean }> = {
  hearts: { symbol: '♥', name: 'Revive', line: 'Bring back one of your captured animals.', red: true },
  diamonds: { symbol: '♦', name: 'Swap', line: 'Two of your pieces trade places.', red: true },
  clubs: { symbol: '♣', name: 'Freeze', line: 'Freeze an enemy piece (not the king) for 2 turns.', red: false },
  spades: { symbol: '♠', name: 'Dig', line: 'One of your pawns digs one square back.', red: false },
  joker: { symbol: '★', name: 'Joker', line: 'A random wild effect!', red: false },
};

export const JOKER_TEXT: Record<JokerOutcome, { name: string; line: string; icon: string }> = {
  party: { name: 'Party!', line: 'All your used powers recharge.', icon: '🎉' },
  teleport: { name: 'Teleport!', line: 'One of your pieces jumps to a random square in your half.', icon: '✨' },
  butterfingers: { name: 'Butterfingers!', line: 'A random enemy piece is frozen for 2 turns.', icon: '🧊' },
  double: { name: 'Double!', line: 'Draw two cards.', icon: '🃏' },
};

export const WHEEL_TEXT: Record<WheelOutcome, { name: string; line: string; icon: string; color: string }> = {
  tide: { name: 'Tide!', line: 'Land pieces on the beach are swept back a rank.', icon: '🌊', color: '#4fb9d6' },
  pigeon: { name: 'Pigeon!', line: 'A pigeon steals a random pawn.', icon: '🐦', color: '#b9a7e0' },
  earthquake: { name: 'Earthquake!', line: 'Every piece shifts one file sideways.', icon: '🌋', color: '#e58a4d' },
  disco: { name: 'Disco!', line: 'Every used power recharges, on both sides.', icon: '🪩', color: '#f2b544' },
};
/** Slice order on the wheel, clockwise from the top. */
export const WHEEL_ORDER: WheelOutcome[] = ['tide', 'pigeon', 'earthquake', 'disco'];

export const DIE_TEXT = (value: DieValue): { call: string; line: string; loud: boolean } =>
  value === 1 ? { call: 'BANANA PEEL!', line: 'Move a piece and it slides one more square.', loud: true }
    : value === 6 ? { call: 'LUCKY!', line: 'Take a bonus before you act.', loud: true }
      : { call: String(value), line: 'A normal turn.', loud: false };

export const LUCKY_TEXT = {
  recharge: { name: 'Recharge', line: 'One used power comes back.', icon: '⚡', off: 'No used powers' },
  pawnStep: { name: 'Pawn step', line: 'One pawn steps forward one square.', icon: '🐾', off: 'No pawn can step' },
};

export const HAND: Record<Hand, { icon: string; name: string; key: string }> = {
  rock: { icon: '✊', name: 'Rock', key: 'r' },
  paper: { icon: '✋', name: 'Paper', key: 'p' },
  scissors: { icon: '✌️', name: 'Scissors', key: 's' },
};
export const HANDS: Hand[] = ['rock', 'paper', 'scissors'];

/** Kind of a piece from its id ("land-n-g1", "sea-p-c7-promo1"). Only a fallback: a promoted piece reads as its old kind. */
export function kindFromId(id: string): PieceKind | null {
  const k = id.split('-')[1];
  return k && 'pnbrqk'.includes(k) && k.length === 1 ? (k as PieceKind) : null;
}

export function sideFromId(id: string): Side | null {
  const s = id.split('-')[0];
  return s === 'land' || s === 'sea' ? s : null;
}

/** The "How it works" sheet: plain-words rules per mode. Party modes follow GAME_SPEC.md "Party modes". */
export const HOW_TO: Record<PlayMode, { title: string; items: string[] }[]> = {
  classic: [
    { title: 'Classic', items: [
      'Real chess, exactly: castling, en passant, promotion, check and mate.',
      'Land moves first. Checkmate the other king to win.',
      'Weird Mode is optional: odd things happen every few turns, but the rules never change.',
    ] },
  ],
  normal: [
    { title: 'The basics', items: [
      'Chess as usual: check and checkmate still apply.',
      'Every piece has one animal power it can use once per game.',
      'Using a power is your whole turn: that piece doesn\'t also move.',
      'A power may not leave your own king in check.',
      'A promoted or revived piece gets a fresh power.',
    ] },
    { title: 'The powers', items: [
      '🐾 Pawn, Sidestep: one square left or right, to an empty square. No capture.',
      '🐴 Knight, Double jump: two knight hops. The first lands on an empty square; the second may capture.',
      '🐐 Bishop, Headbutt: push a neighbouring enemy (even the king) one square straight away.',
      '🐘 Rook, Stomp: stun every neighbouring enemy except the king. Stunned pieces skip their next turn.',
      '🐱 Queen, Block: block an empty square. Nothing can land on it or slide through it. It lasts until the start of your second turn after.',
      '👑 King, Escape: teleport to a safe empty square up to 2 squares away. It uses up castling.',
    ] },
    { title: 'Good to know', items: [
      'Stunned and frozen pieces still guard squares and still give check. They just can\'t move.',
      'No power can put a pawn on the first or last rank.',
    ] },
  ],
  crazy: [
    { title: 'Win by bonking the king', items: [
      'Everything from Normal, plus luck.',
      'There is no check rule: capture the king to win. "King in danger!" warns you when yours is attacked.',
      'A draw only happens when just the two kings are left, or by the fifty-move rule.',
      'No undo: luck is luck.',
    ] },
    { title: 'Each turn', items: [
      '🎡 Every 5 rounds the Wheel of Chaos spins: Tide, Pigeon, Earthquake or Disco.',
      '🃏 Every 3rd turn you draw a chaos card (you can hold 3).',
      '🎲 Roll the fate die. 1 = banana peel: the piece you move slides one more square. 6 = lucky: recharge a power or step a pawn first.',
      'Then move, use a power or play a card.',
    ] },
    { title: 'Duels', items: [
      'When your piece is about to be taken, you may call a rock-paper-scissors duel. You have 3 duel tokens per game.',
      'Win and the attacker is bonked back. Lose and the capture goes ahead. 3 ties in a row: the attacker wins.',
    ] },
    { title: 'Chaos cards', items: [
      '♥ Revive: bring a captured animal back.',
      '♦ Swap: two of your pieces trade places.',
      '♣ Freeze: an enemy piece can\'t act for 2 turns.',
      '♠ Dig: one of your pawns steps one square back.',
      '★ Joker: a surprise! Party, Teleport, Butterfingers or Double.',
    ] },
    { title: 'The wheel', items: [
      '🌊 Tide: Land pieces on the beach are swept back a rank.',
      '🐦 Pigeon: a random pawn is stolen (it can be revived).',
      '🌋 Earthquake: every piece shifts one file left or right.',
      '🪩 Disco: every used power recharges.',
    ] },
  ],
  sumo: [
    { title: 'Win', items: [
      'Push the enemy king into the water.',
      'If only your own king falls in, you lose. Both kings at once is a draw, even on your own turn.',
      'After round 15, the side with more animals left wins.',
    ] },
    { title: 'Your turn', items: [
      'Six animals a side. Roll the die for action points (AP): 1–2 gives 2 AP, 3–4 gives 3, 5–6 gives 4.',
      'Spend AP on any animals, in any order, then press End turn. Unused AP is lost.',
      '👣 Step (1 AP): one square in any direction, onto an empty, dry square.',
      '💥 Shove (2 AP, 3 against the heavy king or rook): a neighbouring enemy moves one square straight away. Animals behind it move too, yours included.',
      'A shove onto a blocked square can\'t be done, and nor can one with a dug-in animal anywhere in the line. Anyone pushed onto water or off the board falls in, yours included.',
      'Only the animal you shove decides whether it costs 3 AP.',
      'If you have AP left but nothing you can afford, the turn ends by itself.',
    ] },
    { title: 'The island sinks', items: [
      '🌊 The outer ring sinks after round 3, the next after round 6, the next after round 9. The middle 2×2 always stays.',
      'The ring about to sink wobbles for the whole round before. Anyone still on it falls in.',
    ] },
    { title: 'Powers (2 AP, once per game)', items: [
      '🐾 Pawn, Dig in: it can\'t be pushed until the start of your next turn.',
      '🐴 Knight, Double jump: two knight hops onto empty, dry squares.',
      '🐐 Bishop, Headbutt: shove a neighbouring enemy 2 squares, heavy or not. If the second square is refused, it stops after one.',
      '🐘 Rook, Stomp: shove every neighbouring enemy (the king too) 1 square straight away. The farthest go first; a refused line is skipped.',
      '🐱 Queen, Block: a vase or ink wall on an empty dry square, for 4 turns.',
      '👑 King, Escape: teleport to an empty dry square up to 2 squares away.',
    ] },
    { title: 'Duels', items: [
      '✊ When a shove would push your animal into the sea, you may call rock-paper-scissors. 2 tokens per game.',
      'Win and the shove fails (the attacker\'s AP is still spent). Powers (headbutt, stomp) and sinking can\'t be dueled.',
    ] },
  ],
  raid: [
    { title: 'Win', items: [
      'First to 5 points. After round 12, more points wins; equal is a draw.',
    ] },
    { title: 'The treasures', items: [
      'Land\'s half is the meadow (ranks 1–4). Sea\'s half is the beach (ranks 5–8).',
      '🦴 Land\'s bone lies at e3. 🦪 Sea\'s pearl lies at d6. Both are close to the middle, so raids are quick.',
      'No guarding: you can\'t stand on your own treasure\'s square. While a treasure is away, its home square is closed.',
      'Grab (free): step onto the enemy treasure at its home to pick it up. +1 point.',
      'Carrying is slow: each step costs 2 AP, and no power.',
      'Bring it home: carry it into your own half for +2 points, however it gets there (the tide counts too). It then goes back home.',
      'Only the square an animal finishes on picks a treasure up, not the middle of a double jump.',
    ] },
    { title: 'Your turn', items: [
      'Six animals a side. Roll the die for action points (AP): 1–2 gives 2 AP, 3–4 gives 3, 5–6 gives 4.',
      'Spend AP on any animals, in any order, then press End turn. Unused AP is lost.',
      '👣 Step (1 AP): one square in any direction, onto an empty square.',
      '🤾 Pass and run (1 AP): the carrier throws the treasure to a teammate in a straight line, up to 2 squares away. If the catcher is in its own half, the +2 scores at once.',
      'An enemy on the square in between intercepts the throw, and the treasure flies straight home.',
      '👋 Tag (1 AP): in your own half, tag a neighbouring enemy that is in your half too. An animal that isn\'t carrying is stunned for its next turn (and can\'t be tagged again while stunned).',
      'A tagged carrier is sent to the nearest free square on its back rank and drops the treasure where it was tagged.',
      'If you have AP left but nothing you can afford, the turn ends by itself.',
      'A dropped treasure can be picked up again, but scores no grab point. If its owner steps on it, it flies home.',
    ] },
    { title: 'Powers (2 AP, once per game)', items: [
      'The same as Normal mode: Sidestep, Double jump, Headbutt, Stomp, Block, Escape. Sidestep costs no AP.',
      'A headbutted carrier drops the treasure where it stood. Stomped enemies (not kings) are stunned for their next turn.',
      'Nothing can put an animal on its own treasure\'s home square: it stays where it is instead.',
    ] },
    { title: 'Duels and the wheel', items: [
      '✊ When your carrier is tagged, you may call rock-paper-scissors. 2 tokens per game. Win and the tag fails.',
      '🎡 Every 5 rounds the Wheel of Chaos spins.',
      '🌊 Tide: every animal in the other side\'s half is swept back a rank toward home.',
      '🐦 Pigeon: grabs a carried or dropped treasure and drops it on a random empty square in its owner\'s half.',
      '🌋 Earthquake: every animal shifts one file.',
      '🪩 Disco: every power recharges.',
    ] },
  ],
};

// ---------- Phase 4: party modes ----------

/** Power names and lines that differ from Normal mode (the selected-animal panel uses these). */
export const ARENA_POWER_TEXT: Record<ArenaMode, Partial<Record<PowerKind, { name: string; line: string }>>> = {
  sumo: {
    sidestep: { name: 'Dig in', line: "Can't be pushed until the start of your next turn." },
    doubleJump: { name: 'Double jump', line: 'Two knight hops onto empty, dry squares.' },
    headbutt: { name: 'Headbutt', line: 'Shove a neighbouring enemy 2 squares, heavy or not.' },
    stomp: { name: 'Stomp', line: 'Shove every neighbouring enemy 1 square. The farthest go first.' },
    block: { name: 'Block', line: 'A wall on an empty dry square, for 4 turns.' },
    escape: { name: 'Escape', line: 'Teleport to an empty dry square up to 2 squares away.' },
  },
  raid: {
    headbutt: { name: 'Headbutt', line: 'Push a neighbouring enemy one square. A carrier drops the treasure.' },
    stomp: { name: 'Stomp', line: 'Stun every neighbouring enemy (not the king) for its next turn.' },
    block: { name: 'Block', line: 'Block an empty square for 4 turns.' },
  },
};

/** The Wheel of Chaos in Raid moves animals and treasures, not chess pieces. */
export const RAID_WHEEL_LINE: Record<WheelOutcome, string> = {
  tide: 'Every animal in the other side\'s half is swept back a rank.',
  pigeon: 'It grabs a loose or carried treasure and drops it in its owner\'s half.',
  earthquake: 'Every animal shifts one file sideways.',
  disco: 'Every used power recharges.',
};

/** Raid treasures: whose it is decides what it is. */
export const TREASURE: Record<Side, { name: string; icon: string }> = {
  land: { name: 'bone', icon: '🦴' },
  sea: { name: 'pearl', icon: '🦪' },
};

/** AP from the die (GAME_SPEC "Party modes"). Only a fallback when integration doesn't pass the AP. */
export const apFromDie = (value: DieValue): number => (value <= 2 ? 2 : value <= 4 ? 3 : 4);
