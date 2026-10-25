import { describe, expect, it } from 'vitest';
import type { MoveResult, PieceKind, Side } from '../contracts/types';
import { formatClock, moveRows, tallyCaptures } from './format';
import {
  SETTINGS_KEY,
  checkFen,
  defaultSettings,
  loadSettings,
  loadSetup,
  sanitizeSettings,
  saveSettings,
  toGameOptions,
  type KeyValueStore,
} from './settings';

const memStore = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

const mv = (side: Side, san: string, captured?: PieceKind, promotion?: PieceKind): MoveResult => ({
  pieceId: 'x', side, kind: 'p', from: 'e2', to: 'e4', san, flags: [], check: false, fenAfter: '',
  ...(captured ? { captured: { id: 'y', side: side === 'land' ? 'sea' : 'land', kind: captured, square: 'e4' } } : {}),
  ...(promotion ? { promotion } : {}),
});

describe('settings', () => {
  it('round-trips through storage', () => {
    const store = memStore();
    const s = { ...defaultSettings(), musicVolume: 0.2, landSkin: { palette: 'candy' } };
    saveSettings(store, s);
    expect(loadSettings(store, defaultSettings())).toEqual(s);
  });

  it('falls back to defaults on junk, and clamps bad values', () => {
    expect(loadSettings(memStore({ [SETTINGS_KEY]: '{not json' }), defaultSettings())).toEqual(defaultSettings());
    const s = sanitizeSettings({ musicVolume: 4, sfxVolume: 'loud', quality: 'ultra', landSkin: { palette: 3 } }, defaultSettings());
    expect(s.musicVolume).toBe(1);
    expect(s.sfxVolume).toBe(0.8);
    expect(s.quality).toBe('auto');
    expect(s.landSkin).toEqual({});
  });

  it('survives storage that throws', () => {
    const bad: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadSettings(bad, defaultSettings(true)).reducedMotion).toBe(true);
    expect(() => saveSettings(bad, defaultSettings())).not.toThrow();
  });
});

describe('setup', () => {
  it('builds bot options with the bot on the other side', () => {
    const o = toGameOptions({ opponent: 'bot', level: 5, side: 'sea', timeId: '5+0', weirdMode: true }, { initialMs: 300000, incrementMs: 0 }, undefined);
    expect(o).toEqual({ opponent: { type: 'bot', level: 5, botSide: 'land' }, time: { initialMs: 300000, incrementMs: 0 }, weirdMode: true });
  });

  it('resolves a random side', () => {
    const c = { opponent: 'bot' as const, level: 1 as const, side: 'random' as const, timeId: 'none', weirdMode: false };
    const t = { initialMs: null, incrementMs: 0 };
    expect(toGameOptions(c, t, undefined, () => 0.1).opponent).toMatchObject({ botSide: 'sea' });
    expect(toGameOptions(c, t, undefined, () => 0.9).opponent).toMatchObject({ botSide: 'land' });
  });

  it('ignores a stale saved setup', () => {
    const s = loadSetup(memStore({ 'menagerie.setup.v1': JSON.stringify({ level: 42, timeId: 'gone', opponent: 'online' }) }), ['none']);
    expect(s).toMatchObject({ level: 3, timeId: 'none', opponent: 'bot' });
  });

  it('checks FEN shape', () => {
    expect(checkFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
    expect(checkFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w')).toMatch(/8 rows/);
    expect(checkFen('rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')).toMatch(/add up/);
    expect(checkFen('8/8/8/8/8/8/8/8 w')).toMatch(/king/);
  });
});

describe('format', () => {
  it('formats clocks', () => {
    expect(formatClock(null)).toBe('∞');
    expect(formatClock(600000)).toBe('10:00');
    expect(formatClock(61001)).toBe('1:02');
    expect(formatClock(9950)).toBe('9.9');
    expect(formatClock(-5)).toBe('0.0');
  });

  it('tallies captures and promotions', () => {
    const t = tallyCaptures([mv('land', 'exd5', 'p'), mv('sea', 'Qxd5', 'n'), mv('land', 'Bxd5', 'q'), mv('sea', 'a1=Q', undefined, 'q')]);
    expect(t.land).toEqual(['q', 'p']);
    expect(t.sea).toEqual(['n']);
    expect(t.diff).toBe(1 - 3 + 9 - 8);
  });

  it('numbers move rows, including a Sea-first start', () => {
    expect(moveRows([mv('land', 'e4'), mv('sea', 'e5'), mv('land', 'Nf3')])).toEqual([{ n: 1, land: 'e4', sea: 'e5' }, { n: 2, land: 'Nf3' }]);
    expect(moveRows([mv('sea', 'e5'), mv('land', 'Nf3')])).toEqual([{ n: 1, sea: 'e5' }, { n: 2, land: 'Nf3' }]);
  });
});
