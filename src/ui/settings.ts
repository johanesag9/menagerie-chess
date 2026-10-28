/**
 * Settings and last-used setup, kept in localStorage. Every read and write is wrapped:
 * private windows and blocked storage just fall back to defaults.
 */
import type { BotLevel, GameOptions, PlayMode, QualityTier, Settings, Side, SkinChoice } from '../contracts/types';
import { isArenaMode } from '../contracts/types';

export const SETTINGS_KEY = 'menagerie.settings.v1';
export const SETUP_KEY = 'menagerie.setup.v1';

/** The bits of Storage we use, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    quality: 'auto',
    reducedMotion: prefersReducedMotion,
    showCoordinates: false,
    landSkin: {},
    seaSkin: {},
  };
}

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const QUALITIES: (QualityTier | 'auto')[] = ['auto', 'high', 'low'];

function skin(v: unknown): SkinChoice {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: SkinChoice = {};
  if (typeof o.palette === 'string' && o.palette) out.palette = o.palette;
  if (typeof o.accessory === 'string' && o.accessory) out.accessory = o.accessory;
  return out;
}

/** Fill gaps and clamp anything odd, so a stale or hand-edited save never breaks the game. */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const o = raw as Record<string, unknown>;
  return {
    musicVolume: clamp01(o.musicVolume, defaults.musicVolume),
    sfxVolume: clamp01(o.sfxVolume, defaults.sfxVolume),
    quality: QUALITIES.includes(o.quality as QualityTier) ? (o.quality as Settings['quality']) : defaults.quality,
    reducedMotion: bool(o.reducedMotion, defaults.reducedMotion),
    showCoordinates: bool(o.showCoordinates, defaults.showCoordinates),
    landSkin: o.landSkin === undefined ? defaults.landSkin : skin(o.landSkin),
    seaSkin: o.seaSkin === undefined ? defaults.seaSkin : skin(o.seaSkin),
  };
}

export function loadSettings(store: KeyValueStore | null, defaults: Settings): Settings {
  try {
    const s = store?.getItem(SETTINGS_KEY);
    return s ? sanitizeSettings(JSON.parse(s), defaults) : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(store: KeyValueStore | null, s: Settings): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: settings still work for this visit */
  }
}

// ---------- Setup screen memory ----------

/** What the setup screen remembers between visits. `side` is the human's side vs the bot. */
export interface SetupChoice {
  mode: PlayMode;
  opponent: 'local' | 'bot';
  level: BotLevel;
  side: Side | 'random';
  timeId: string;
  weirdMode: boolean;
}

const PLAY_MODES: PlayMode[] = ['classic', 'normal', 'crazy', 'sumo', 'raid'];

export const defaultSetup = (): SetupChoice => ({ mode: 'classic', opponent: 'bot', level: 3, side: 'land', timeId: 'none', weirdMode: false });

export function loadSetup(store: KeyValueStore | null, timeIds: string[]): SetupChoice {
  const d = defaultSetup();
  try {
    const s = store?.getItem(SETUP_KEY);
    if (!s) return d;
    const o = JSON.parse(s) as Record<string, unknown>;
    return {
      mode: PLAY_MODES.includes(o.mode as PlayMode) ? (o.mode as PlayMode) : d.mode,
      opponent: o.opponent === 'local' || o.opponent === 'bot' ? o.opponent : d.opponent,
      level: typeof o.level === 'number' && o.level >= 1 && o.level <= 8 ? (Math.round(o.level) as BotLevel) : d.level,
      side: o.side === 'land' || o.side === 'sea' || o.side === 'random' ? o.side : d.side,
      timeId: typeof o.timeId === 'string' && timeIds.includes(o.timeId) ? o.timeId : d.timeId,
      weirdMode: bool(o.weirdMode, d.weirdMode),
    };
  } catch {
    return d;
  }
}

export function saveSetup(store: KeyValueStore | null, c: SetupChoice): void {
  try {
    store?.setItem(SETUP_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** Turn setup choices into the GameOptions core expects. `rand` is injectable for tests. */
export function toGameOptions(
  c: SetupChoice,
  time: GameOptions['time'],
  fen: string | undefined,
  rand: () => number = Math.random,
): GameOptions {
  const human: Side = c.side === 'random' ? (rand() < 0.5 ? 'land' : 'sea') : c.side;
  // Party modes have no clock, no Weird Mode and no FEN.
  const party = isArenaMode(c.mode);
  const opts: GameOptions = {
    mode: c.mode,
    opponent: c.opponent === 'bot' ? { type: 'bot', level: c.level, botSide: human === 'land' ? 'sea' : 'land' } : { type: 'local' },
    time: party ? { initialMs: null, incrementMs: 0 } : { ...time },
    // Crazy has the Wheel of Chaos instead of Weird Mode.
    weirdMode: c.mode === 'crazy' || party ? false : c.weirdMode,
  };
  if (fen && !party) opts.fen = fen;
  return opts;
}

/** Rough shape check only (core does the real validation). Returns an error message or null. */
export function checkFen(fen: string): string | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return 'A FEN needs at least the board and whose turn it is.';
  const rows = parts[0].split('/');
  if (rows.length !== 8) return 'The board part needs 8 rows separated by "/".';
  for (const row of rows) {
    let n = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) n += Number(ch);
      else if (/[prnbqkPRNBQK]/.test(ch)) n += 1;
      else return `"${ch}" isn't a piece letter.`;
    }
    if (n !== 8) return 'Each row must add up to 8 squares.';
  }
  if ((parts[0].match(/K/g) ?? []).length !== 1 || (parts[0].match(/k/g) ?? []).length !== 1) return 'Each side needs exactly one king.';
  if (parts[1] !== 'w' && parts[1] !== 'b') return 'Turn must be "w" (Land) or "b" (Sea).';
  return null;
}
