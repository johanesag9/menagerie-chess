import { describe, expect, it } from 'vitest';
import type { ActionRecord, ArenaState, AudioCue, DuelInfo, MoveResult, PieceKind, PieceState, Side, SideModeState } from '../contracts/types';
import { cueFn } from '../audio/cues';
import { formatClock, listRows, moveRows, powerCounts, tallyCaptures, tallyFromCaptured } from './format';
import { ALL_MODES, HOW_TO, MODE_TEXT, apFromDie, kindFromId, sideFromId } from './modeText';
import { partyLine } from './screens/overlays';
import { duelWords } from './screens/chaos';
import {
  SETTINGS_KEY,
  checkFen,
  defaultSettings,
  defaultSetup,
  loadSettings,
  loadSetup,
  sanitizeSettings,
  saveSettings,
  saveSetup,
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
    const o = toGameOptions({ mode: 'classic', opponent: 'bot', level: 5, side: 'sea', timeId: '5+0', weirdMode: true }, { initialMs: 300000, incrementMs: 0 }, undefined);
    expect(o).toEqual({ mode: 'classic', opponent: { type: 'bot', level: 5, botSide: 'land' }, time: { initialMs: 300000, incrementMs: 0 }, weirdMode: true });
  });

  it('resolves a random side', () => {
    const c = { mode: 'normal' as const, opponent: 'bot' as const, level: 1 as const, side: 'random' as const, timeId: 'none', weirdMode: false };
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

describe('Phase 3: modes', () => {
  const log = (side: Side | null, kind: ActionRecord['kind'], label: string = kind): ActionRecord => ({ side, kind, label });

  it('remembers the mode and turns Weird Mode off in Crazy', () => {
    const store = memStore();
    const c = { ...defaultSetup(), mode: 'crazy' as const, weirdMode: true };
    saveSetup(store, c);
    expect(loadSetup(store, ['none']).mode).toBe('crazy');
    expect(toGameOptions(c, { initialMs: null, incrementMs: 0 }, undefined)).toMatchObject({ mode: 'crazy', weirdMode: false });
    expect(toGameOptions({ ...c, mode: 'normal' }, { initialMs: null, incrementMs: 0 }, undefined)).toMatchObject({ mode: 'normal', weirdMode: true });
    expect(loadSetup(memStore({ 'menagerie.setup.v1': JSON.stringify({ mode: 'bonkers' }) }), ['none']).mode).toBe('classic');
  });

  it('puts log lines between moves, numbered by round', () => {
    const rows = listRows([
      { move: mv('land', 'e4') },
      { log: log('sea', 'power', 'Octopus: Block d5') },
      { move: mv('land', 'd4') },
      { move: mv('sea', 'e5') },
      { log: log(null, 'wheel') },
      { log: log('land', 'bonus') },
      { move: mv('land', 'Nf3') },
      { log: log('land', 'move', 'Nf3') },
    ]);
    expect(rows).toEqual([
      { type: 'move', n: 1, land: 'e4' },
      { type: 'log', n: 1, record: log('sea', 'power', 'Octopus: Block d5') },
      { type: 'move', n: 2, land: 'd4', sea: 'e5' },
      { type: 'log', n: 3, record: log(null, 'wheel') },
      { type: 'log', n: 3, record: log('land', 'bonus') },
      { type: 'move', n: 3, land: 'Nf3' },
    ]);
  });

  it('starts a new "… e5" row when a log line sits between Land and Sea', () => {
    const rows = listRows([{ move: mv('land', 'e4') }, { log: log('sea', 'bonus') }, { move: mv('sea', 'e5') }, { move: mv('land', 'd4') }]);
    expect(rows.filter((r) => r.type === 'move')).toEqual([
      { type: 'move', n: 1, land: 'e4' }, { type: 'move', n: 1, sea: 'e5' }, { type: 'move', n: 2, land: 'd4' },
    ]);
    // Classic (moves only) numbers rows exactly like moveRows.
    const moves = [mv('land', 'e4'), mv('sea', 'e5'), mv('land', 'Nf3')];
    expect(listRows(moves.map((m) => ({ move: m }))).map(({ n, land, sea }: { n: number; land?: string; sea?: string }) => ({ n, land, sea })))
      .toEqual(moveRows(moves).map((r) => ({ n: r.n, land: r.land, sea: r.sea })));
  });

  it('tallies trays from the mode state (pigeon and revive included)', () => {
    const p = (side: Side, kind: PieceKind): PieceState => ({ id: `${side}-${kind}-x`, side, kind, square: 'a1' });
    const t = tallyFromCaptured([p('land', 'p')], [p('sea', 'n'), p('sea', 'q')]);
    expect(t.land).toEqual(['q', 'n']);
    expect(t.sea).toEqual(['p']);
    expect(t.diff).toBe(12 - 1);
  });

  it('counts powers left per kind', () => {
    const s: SideModeState = { powersUsed: ['land-n-g1', 'land-p-e2'], hand: [], playableCards: [], duelTokens: 3, captured: [{ id: 'land-p-a2', side: 'land', kind: 'p', square: 'a4' }], nextCardIn: 3 };
    const guess = powerCounts('land', s, null, kindFromId);
    expect(guess.p).toEqual({ total: 7, left: 6 });
    expect(guess.n).toEqual({ total: 2, left: 1 });
    expect(guess.k).toEqual({ total: 1, left: 1 });
    const live: PieceState[] = [
      { id: 'land-n-g1', side: 'land', kind: 'n', square: 'f3' },
      { id: 'land-p-e7-promo1', side: 'land', kind: 'q', square: 'e8' },
      { id: 'sea-k-e8', side: 'sea', kind: 'k', square: 'h8' },
    ];
    const exact = powerCounts('land', { ...s, powersUsed: ['land-n-g1'] }, live, kindFromId);
    expect(exact.n).toEqual({ total: 1, left: 0 });
    expect(exact.q).toEqual({ total: 1, left: 1 });
    expect(exact.p.total).toBe(0);
  });

  it('reads kind and side from piece ids', () => {
    expect(kindFromId('sea-n-g8')).toBe('n');
    expect(sideFromId('sea-n-g8')).toBe('sea');
    expect(kindFromId('weird')).toBeNull();
  });

  it('has a sound for every Phase 3 cue', () => {
    const want = [
      'power:sidestep', 'power:doubleJump', 'power:headbutt', 'power:stomp', 'power:block', 'power:escape',
      'dieRoll', 'dieBanana', 'dieLucky', 'cardDraw', 'cardPlay', 'joker', 'duelCall', 'duelThrow', 'duelWin', 'duelLose', 'bonk',
      'wheelSpin', 'wheelStop', 'chaos:tide', 'chaos:pigeon', 'chaos:earthquake', 'chaos:disco',
      'stun', 'freeze', 'block', 'revive', 'slip', 'recharge',
    ] as AudioCue[];
    for (const c of want) expect(cueFn(c), c).toBeTypeOf('function');
  });
});

describe('Phase 4: party modes', () => {
  const arena = (o: Partial<ArenaState> = {}): ArenaState => ({
    mode: 'sumo', round: 15, turn: 'sea', phase: 'over', die: null, ap: 0,
    pieces: [
      { id: 'land-k-e2', side: 'land', kind: 'k', square: 'd4' }, { id: 'land-n-b2', side: 'land', kind: 'n', square: 'c4' },
      { id: 'land-r-f2', side: 'land', kind: 'r', square: 'e4' }, { id: 'sea-k-e7', side: 'sea', kind: 'k', square: 'e5' },
    ],
    out: [], powersUsed: [], statuses: [], squares: [], duelTokens: { land: 2, sea: 2 },
    sunk: [], sinkingNext: [], nextSinkIn: null, treasures: [], score: { land: 0, sea: 0 }, target: 0, nextWheelIn: null, maxRounds: 15,
    ...o,
  });

  it('remembers a party mode and drops clock, Weird Mode and FEN for it', () => {
    const store = memStore();
    const c = { ...defaultSetup(), mode: 'raid' as const, weirdMode: true, timeId: '5+0' };
    saveSetup(store, c);
    expect(loadSetup(store, ['none', '5+0']).mode).toBe('raid');
    const o = toGameOptions(c, { initialMs: 300_000, incrementMs: 0 }, '8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(o).toMatchObject({ mode: 'raid', weirdMode: false, time: { initialMs: null, incrementMs: 0 } });
    expect(o.fen).toBeUndefined();
  });

  it('has a name, pitch and rules for every mode', () => {
    for (const m of ALL_MODES) {
      expect(MODE_TEXT[m].pitch.length, m).toBeGreaterThan(10);
      expect(HOW_TO[m].length, m).toBeGreaterThan(0);
    }
  });

  it('turns the die into AP like the spec', () => {
    expect([1, 2, 3, 4, 5, 6].map((v) => apFromDie(v as 1))).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it('words shove and tag duels', () => {
    const info: DuelInfo = { attackerId: 'sea-r-f7', victimId: 'land-k-e2', via: 'shove', from: 'e5', to: 'e4', attacker: 'sea', defender: 'land', tokensLeft: 2 };
    expect(duelWords(info, 'Sea Turtle', 'Pug', 'your').line).toBe("Sea's Sea Turtle wants to shove your Pug into the sea!");
    const tag = duelWords({ ...info, via: 'tag', attacker: 'land', defender: 'sea' }, 'Cat', 'Seahorse', 'your');
    expect(tag.line).toContain('drop the bone');
    expect(tag.lose).toContain('goes home');
  });

  it('words the party endings', () => {
    expect(partyLine({ winner: 'sea', reason: 'kingOverboard' }, arena(), 'sumo')).toBe("Sea wins: Land's Pug fell into the sea!");
    expect(partyLine({ winner: null, reason: 'kingOverboard' }, arena(), 'sumo')).toContain('Both kings');
    expect(partyLine({ winner: 'land', reason: 'rounds' }, arena(), 'sumo')).toBe('Round 15 is over. Land wins with more animals left (3 to 1).');
    const raid = arena({ mode: 'raid', maxRounds: 20, score: { land: 3, sea: 1 }, target: 3 });
    expect(partyLine({ winner: 'land', reason: 'treasure' }, raid, 'raid')).toBe('Land wins 3–1 by raiding the pearl!');
    expect(partyLine({ winner: null, reason: 'rounds' }, { ...raid, score: { land: 1, sea: 1 } }, 'raid')).toBe('Round 20 is over, level on points (1–1).');
    expect(partyLine({ winner: 'land', reason: 'checkmate' }, null, 'classic')).toBeNull();
  });

  it('lists step lines in the party modes only', () => {
    const steps = [{ log: { side: 'land' as const, kind: 'move' as const, label: 'Pug d3→d4' } }];
    expect(listRows(steps)).toEqual([]);
    expect(listRows(steps, true)).toEqual([{ type: 'log', n: 1, record: steps[0].log }]);
  });

  it('has a sound for every Phase 4 cue', () => {
    const want = ['step', 'shove', 'tag', 'splash', 'sinkWarn', 'sink', 'anchor', 'pickup', 'drop', 'treasureHome', 'score', 'endTurn'] as AudioCue[];
    for (const c of want) expect(cueFn(c), c).toBeTypeOf('function');
  });
});
