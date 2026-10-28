import { describe, expect, it } from 'vitest';
import type { ArenaState, AudioCue } from '../contracts/types';
import { cueFn } from '../audio/cues';
import { boardLine, crownWords, stageWords, tideWords } from './boardText';
import { ALL_MODES, HOW_TO, MODE_TEXT } from './modeText';
import { partyLine } from './screens/overlays';
import { defaultSetup, loadSetup, saveSetup, toGameOptions, type KeyValueStore } from './settings';

const memStore = (): KeyValueStore => {
  const data: Record<string, string> = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

const castle = (o: Partial<ArenaState> = {}): ArenaState => ({
  mode: 'castle', round: 3, turn: 'land', phase: 'action', die: null, ap: 0,
  pieces: [
    { id: 'land-b-c2', side: 'land', kind: 'b', square: 'd3' },
    { id: 'land-r-f2', side: 'land', kind: 'r', square: 'f2' },
    { id: 'sea-q-c7', side: 'sea', kind: 'q', square: 'e4' },
    { id: 'sea-p-f7', side: 'sea', kind: 'p', square: 'f7' },
  ],
  out: [], powersUsed: [], statuses: [], squares: [], duelTokens: { land: 0, sea: 0 }, sunk: [], sinkingNext: [], nextSinkIn: null,
  treasures: [], score: { land: 0, sea: 0 }, target: 0, nextWheelIn: null, maxRounds: 30,
  stage: 'move', mover: null, levels: { e4: 3 }, crowned: null, nextTideIn: 2, draft: { size: 2, picks: { land: ['b', 'r'], sea: ['q', 'p'] } },
  ...o,
});

describe('board-game modes (Phase 6)', () => {
  it('offers both modes with rules, and remembers them on setup without clock, Weird Mode or FEN', () => {
    expect(ALL_MODES).toContain('castle');
    expect(ALL_MODES).toContain('stones');
    expect(MODE_TEXT.castle.name).toBe('Sandcastle King');
    expect(HOW_TO.castle.map((s) => s.title)).toContain('Traits (always on)');
    expect(HOW_TO.stones.map((s) => s.title)).toContain('Powers (once per game)');
    const store = memStore();
    const c = { ...defaultSetup(), mode: 'stones' as const, weirdMode: true };
    saveSetup(store, c);
    expect(loadSetup(store, ['none']).mode).toBe('stones');
    const o = toGameOptions(c, { initialMs: 300_000, incrementMs: 0 }, '8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(o).toMatchObject({ mode: 'stones', weirdMode: false, time: { initialMs: null } });
    expect(o.fen).toBeUndefined();
  });

  it('words each stage', () => {
    expect(stageWords(castle(), true)).toBe('Move an animal');
    expect(stageWords(castle({ stage: 'shape', mover: 'land-b-c2' }), true)).toBe('Build or dig next to your Mountain Goat');
    expect(stageWords(castle({ stage: 'more', mover: 'sea-p-f7', turn: 'sea' }), true)).toBe('Dig again or end turn');
    expect(stageWords(castle({ stage: 'shape' }), false)).toBe('Building or digging');
    expect(stageWords(castle({ phase: 'draft', stage: 'pick', draft: { size: 2, picks: { land: ['b'], sea: ['q'] } } }), true)).toBe('Pick your 2nd animal (of 2)');
    expect(stageWords(castle({ mode: 'stones', stage: 'shape' }), true)).toBe('Raise or sink a square, or use a power');
    expect(stageWords(castle({ mode: 'stones', stage: 'move' }), true)).toBe('Move an animal');
  });

  it('warns loudly about a crowned animal, from each side', () => {
    const st = castle({ crowned: { pieceId: 'sea-q-c7', side: 'sea', square: 'e4' } });
    // Land has no Shover here, so only digging can answer.
    expect(crownWords(st, 'land')).toBe("Sea's Octopus holds a castle: dig under it!");
    expect(crownWords(st, 'sea')).toBe('Your Octopus holds a castle! Keep it there through their turn to win.');
    const withShover = { ...st, pieces: [...st.pieces, { id: 'land-q-c2', side: 'land' as const, kind: 'q' as const, square: 'a1' as const }] };
    expect(crownWords(withShover, null)).toBe("Sea's Octopus holds a castle: dig under it or push it off!");
    expect(crownWords(castle(), 'land')).toBeNull();
  });

  it('counts down the tide', () => {
    expect(tideWords(3)).toEqual({ text: 'Tide in 3', urgent: false });
    expect(tideWords(1)?.urgent).toBe(true);
    expect(tideWords(null)).toBeNull();
  });

  it('words the board-game endings', () => {
    const st = castle({ crowned: { pieceId: 'sea-q-c7', side: 'sea', square: 'e4' } });
    expect(boardLine({ winner: 'sea', reason: 'castle' }, st, 'castle')).toBe('Sea wins by holding the castle: the Octopus stood its ground!');
    expect(partyLine({ winner: null, reason: 'rounds' }, castle({ round: 31 }), 'castle')).toBe('Round 30 is over and nobody held a castle.');
    const stones = castle({ mode: 'stones', maxRounds: 25, pieces: [{ id: 'land-k-e2', side: 'land', kind: 'k', square: 'e8' }] });
    expect(boardLine({ winner: 'land', reason: 'crossed' }, stones, 'stones')).toBe('Land wins by crossing the sea: the Pug reached the far shore!');
    expect(boardLine({ winner: null, reason: 'rounds' }, stones, 'stones')).toBe('Round 25 is over and nobody got across.');
    expect(boardLine({ winner: 'land', reason: 'resign' }, stones, 'stones')).toBeNull();
    expect(boardLine({ winner: 'land', reason: 'treasure' }, null, 'raid')).toBeNull();
  });

  it('has a sound for every Phase 6 cue', () => {
    const want = ['build', 'dig', 'raise', 'sinkStone', 'climb', 'flag', 'tideWear', 'draftPick'] as AudioCue[];
    for (const c of want) expect(cueFn(c), c).toBeTypeOf('function');
  });
});
