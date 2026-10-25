/**
 * Every name and label the UI shows lives here, so wording is easy to change in one place.
 */
import type { BotLevel, EmoteKind, GameOverReason, PieceKind, Side, TimeControl, WeirdEventKind } from '../contracts/types';

/** Working title. Change it here and the wordmark, page and result screens follow. */
export const GAME_NAME = 'Menagerie Chess';
export const TAGLINE = 'Land vs Sea';

export const SIDE_NAME: Record<Side, string> = { land: 'Land', sea: 'Sea' };

/** Mirrors the roster in GAME_SPEC.md. The cast's displayName() is the source of truth once wired. */
export const ANIMAL_NAME: Record<Side, Record<PieceKind, string>> = {
  land: { p: 'Dachshund', n: 'Horse', b: 'Mountain Goat', r: 'Elephant', q: 'Cat', k: 'Pug' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Sea Turtle', q: 'Octopus', k: 'Blobfish' },
};

export const BOT_LEVELS: { level: BotLevel; name: string }[] = [
  { level: 1, name: 'Sleepy Snail' },
  { level: 2, name: 'Curious Puppy' },
  { level: 3, name: 'Busy Beaver' },
  { level: 4, name: 'Clever Crow' },
  { level: 5, name: 'Sly Fox' },
  { level: 6, name: 'Wise Owl' },
  { level: 7, name: 'Shark Tactician' },
  { level: 8, name: 'Grandmaster Kraken' },
];

export const botName = (level: BotLevel): string => BOT_LEVELS.find((b) => b.level === level)?.name ?? `Bot ${level}`;

export const TIME_CONTROLS: { id: string; label: string; time: TimeControl }[] = [
  { id: 'none', label: 'Untimed', time: { initialMs: null, incrementMs: 0 } },
  { id: '3+2', label: '3 + 2', time: { initialMs: 3 * 60_000, incrementMs: 2000 } },
  { id: '5+0', label: '5 min', time: { initialMs: 5 * 60_000, incrementMs: 0 } },
  { id: '10+0', label: '10 min', time: { initialMs: 10 * 60_000, incrementMs: 0 } },
  { id: '15+10', label: '15 + 10', time: { initialMs: 15 * 60_000, incrementMs: 10_000 } },
];

export const EMOTES: { kind: EmoteKind; icon: string; label: string }[] = [
  { kind: 'laugh', icon: '😂', label: 'Laugh' },
  { kind: 'love', icon: '😍', label: 'Love' },
  { kind: 'shock', icon: '😲', label: 'Shock' },
  { kind: 'taunt', icon: '😜', label: 'Taunt' },
  { kind: 'angry', icon: '😠', label: 'Angry' },
  { kind: 'sleepy', icon: '😴', label: 'Sleepy' },
];

export const WEIRD_TEXT: Record<WeirdEventKind, { title: string; body: string; icon: string }> = {
  tilt: { title: 'Wobbly table!', body: 'The whole board tilts.', icon: '🌀' },
  fog: { title: 'Sea fog', body: 'Far squares go hazy.', icon: '🌫️' },
  gravityHop: { title: 'Boing!', body: 'Everyone bounces.', icon: '🦘' },
  pigeonPeek: { title: 'A pigeon drops by', body: 'Just visiting.', icon: '🐦' },
  tideSwap: { title: 'Tide swap', body: 'Meadow and beach trade colours.', icon: '🌊' },
  disco: { title: 'Disco time!', body: 'Party lights for a turn.', icon: '🪩' },
};

export const REASON_TEXT: Record<GameOverReason, string> = {
  checkmate: 'by checkmate',
  resign: 'by resignation',
  timeout: 'on time',
  stalemate: 'Stalemate',
  threefold: 'Threefold repetition',
  fiftyMove: 'Fifty-move rule',
  insufficient: 'Not enough pieces to mate',
  agreement: 'Agreed draw',
};

export const PROMOTION_KINDS = ['q', 'r', 'b', 'n'] as const;

/**
 * Stand-in skin list, used until integration passes the cast's real `listSkins()` through
 * `setSkinCatalog`. Names follow the cast stream's plan; the ids are guesses.
 */
export const FALLBACK_SKINS: Record<Side, { palettes: { id: string; name: string; swatch: string }[]; accessories: { id: string; name: string }[] }> = {
  land: {
    palettes: [
      { id: 'meadow', name: 'Meadow', swatch: '#c8873e' },
      { id: 'porcelain', name: 'Porcelain', swatch: '#3d6fb6' },
      { id: 'candy', name: 'Candy', swatch: '#f28bb5' },
      { id: 'gilded', name: 'Gilded', swatch: '#d9a521' },
    ],
    accessories: [
      { id: 'party-hat', name: 'Party hat' },
      { id: 'sunglasses', name: 'Sunglasses' },
      { id: 'bow-tie', name: 'Bow tie' },
      { id: 'flower-crown', name: 'Flower crown' },
      { id: 'pirate-hat', name: 'Pirate hat' },
      { id: 'top-hat', name: 'Top hat' },
    ],
  },
  sea: {
    palettes: [
      { id: 'lagoon', name: 'Lagoon', swatch: '#2aa6a0' },
      { id: 'abyss', name: 'Abyss', swatch: '#283a68' },
      { id: 'coral', name: 'Coral', swatch: '#ef7a63' },
      { id: 'pearl', name: 'Pearl', swatch: '#e9e2f2' },
    ],
    accessories: [
      { id: 'party-hat', name: 'Party hat' },
      { id: 'sunglasses', name: 'Sunglasses' },
      { id: 'bow-tie', name: 'Bow tie' },
      { id: 'flower-crown', name: 'Flower crown' },
      { id: 'pirate-hat', name: 'Pirate hat' },
      { id: 'top-hat', name: 'Top hat' },
    ],
  },
};
export type SkinCatalog = (typeof FALLBACK_SKINS)['land'];
