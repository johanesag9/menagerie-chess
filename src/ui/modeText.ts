/**
 * Every word the UI shows about the game modes (Phase 3), in one place like config.ts.
 * Rules text follows GAME_SPEC.md "Game modes". If the spec changes, change it here too.
 */
import type { CardSuit, DieValue, GameMode, Hand, JokerOutcome, PieceKind, PowerBlock, PowerKind, Side, WheelOutcome } from '../contracts/types';

export const MODE_TEXT: Record<GameMode, { name: string; pitch: string; icon: string }> = {
  classic: { name: 'Classic', pitch: 'Real chess, exactly. Every move in character.', icon: '♟️' },
  normal: { name: 'Normal', pitch: 'Chess plus one animal power per piece.', icon: '⚡' },
  crazy: { name: 'Crazy', pitch: 'Powers, dice, duels, cards and the Wheel of Chaos. Bonk the king to win.', icon: '🎲' },
};

export const MODES: GameMode[] = ['classic', 'normal', 'crazy'];

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

/** The "How it works" sheet: plain-words rules per mode. */
export const HOW_TO: Record<GameMode, { title: string; items: string[] }[]> = {
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
};
