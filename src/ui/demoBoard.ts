/**
 * Demo for the board-game modes (Sandcastle King, Stepping Stones): fake ArenaStates that follow GAME_SPEC
 * "Board-game modes", the draft, every HUD stage (crowned and 'more' too), the Build/Dig and Raise/Sink toggle,
 * a short scripted castle turn, and the result screen. All inputs are fake: the stand-in board draws levels,
 * water, fresh squares and animals so the scripts read. It is not the real world and the rules are not run here.
 */
import type { ArenaState, BoardMode, GameOptions, PieceKind, PieceState, Side, Square } from '../contracts/types';
import { isBoardMode } from '../contracts/types';
import { TRAIT_ORDER, TRAIT_TEXT } from './boardText';
import { animalIcon } from './icons';
import type { MenagerieUi } from './index';

type Section = (title: string, hint?: string) => HTMLElement;
type Btn = (parent: HTMLElement, label: string, fn: () => void) => HTMLButtonElement;

const FILES = 'abcdefgh';
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const sq = (f: number, r: number): Square | null => (f < 0 || f > 7 || r < 0 || r > 7 ? null : (`${FILES[f]}${r + 1}` as Square));
const xy = (s: Square): [number, number] => [FILES.indexOf(s[0]), Number(s[1]) - 1];
const ALL: Square[] = Array.from({ length: 64 }, (_, i) => sq(i % 8, Math.floor(i / 8))!);
const TRAITS = Object.fromEntries(TRAIT_ORDER.map((k) => [k, { name: TRAIT_TEXT[k].name, line: TRAIT_TEXT[k].line }])) as Record<PieceKind, { name: string; line: string }>;
/** Stones roster, as in the party modes: Land on b2–g2, Sea on b7–g7. */
const ROSTER: [PieceKind, string][] = [['n', 'b'], ['b', 'c'], ['q', 'd'], ['k', 'e'], ['r', 'f'], ['p', 'g']];

function baseState(mode: BoardMode): ArenaState {
  return {
    mode, round: 1, turn: 'land', phase: 'action', die: null, ap: 0, pieces: [], out: [], powersUsed: [], statuses: [], squares: [],
    duelTokens: { land: 0, sea: 0 }, sunk: [], sinkingNext: [], nextSinkIn: null, treasures: [], score: { land: 0, sea: 0 }, target: 0,
    nextWheelIn: null, maxRounds: mode === 'castle' ? 30 : 25,
  };
}

/** A fake board game. `st` is the snapshot the UI gets; helpers keep the derived fields honest. */
export class FakeBoard {
  st: ArenaState;

  constructor(private ui: MenagerieUi, mode: BoardMode) {
    const st = baseState(mode);
    if (mode === 'castle') {
      Object.assign(st, { phase: 'draft', stage: 'pick', mover: null, levels: {}, crowned: null, nextTideIn: 5, draft: { size: 2, picks: { land: [], sea: [] } } });
    } else {
      for (const side of ['land', 'sea'] as const) {
        for (const [kind, file] of ROSTER) {
          const square = `${file}${side === 'land' ? 2 : 7}` as Square;
          st.pieces.push({ id: `${side}-${kind}-${square}`, side, kind, square });
        }
      }
      Object.assign(st, { stage: 'shape', sunk: ALL.filter((s) => s[1] >= '3' && s[1] <= '6'), fresh: [] });
    }
    this.st = st;
    this.derive();
  }

  /** Castle: enter the drafted animals (Land c2, f2; Sea c7, f7; first pick on c). */
  enter(): void {
    const st = this.st;
    st.pieces = [];
    for (const side of ['land', 'sea'] as const) {
      st.draft!.picks[side].forEach((kind, i) => {
        const square = `${i === 0 ? 'c' : 'f'}${side === 'land' ? 2 : 7}` as Square;
        st.pieces.push({ id: `${side}-${kind}-${square}`, side, kind, square });
      });
    }
    st.phase = 'action';
    st.stage = 'move';
    st.turn = 'land';
  }

  /** Stones: each side's shortest dry path (8 directions, empty squares) to the enemy back rank. */
  derive(): void {
    const st = this.st;
    if (st.mode !== 'stones') return;
    const blocked = new Set<Square>([...st.sunk, ...st.squares.map((e) => e.square)]);
    const taken = new Set(st.pieces.map((p) => p.square));
    const path = (side: Side): number | null => {
      const goal = side === 'land' ? '8' : '1';
      const seen = new Set<Square>();
      let front = st.pieces.filter((p) => p.side === side).map((p) => p.square);
      front.forEach((s) => seen.add(s));
      for (let d = 0; front.length; d++) {
        if (front.some((s) => s[1] === goal)) return d;
        const next: Square[] = [];
        for (const s of front) {
          const [f, r] = xy(s);
          for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
            const n = sq(f + df, r + dr);
            if (n && !seen.has(n) && !blocked.has(n) && !taken.has(n)) {
              seen.add(n);
              next.push(n);
            }
          }
        }
        front = next;
      }
      return null;
    };
    st.pathLength = { land: path('land'), sea: path('sea') };
  }

  push(): void {
    this.derive();
    this.ui.setArenaState(structuredClone(this.st));
    drawBoard(this.st);
  }

  piece(id: string): PieceState {
    return this.st.pieces.find((p) => p.id === id)!;
  }

  level(s: Square): number {
    return this.st.levels?.[s] ?? 0;
  }

  setLevel(s: Square, n: number): void {
    this.st.levels![s] = Math.max(0, Math.min(3, n)) as 0;
  }
}

// ---------- Stand-in board (demo only) ----------

const SAND = ['', '#ecd09a', '#d9ae67', '#b98a42'];
let original: string[] | null = null;
function drawBoard(st: ArenaState | null): void {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('#board > i'));
  if (!cells.length) return;
  original ??= cells.map((c) => c.style.background);
  cells.forEach((c, i) => {
    const s = sq(i % 8, 7 - Math.floor(i / 8))!;
    c.style.background = original![i];
    c.style.outline = '';
    c.style.display = 'grid';
    c.style.placeItems = 'center';
    c.style.position = 'relative';
    c.innerHTML = '';
    if (!st) return;
    const lvl = st.levels?.[s] ?? 0;
    const wet = st.sunk.includes(s);
    const fresh = st.fresh?.includes(s);
    const bg = wet ? '#3c8fb5' : lvl ? SAND[lvl] : '';
    const p = st.pieces.find((x) => x.square === s);
    const crown = p && st.crowned?.pieceId === p.id;
    c.innerHTML = `${bg ? `<b style="position:absolute;inset:0;background:${bg};${lvl ? `box-shadow:inset 0 -${lvl * 3}px 0 rgba(0,0,0,.18)` : ''}"></b>` : ''}`
      + (fresh ? '<b style="position:absolute;inset:3px;border:2px dashed #fff;border-radius:3px"></b>' : '')
      + (lvl ? `<small style="position:absolute;left:3px;top:1px;font:700 min(2.4vmin,13px)/1 system-ui;color:#5b3d12">${lvl === 3 ? '🏰' : lvl}</small>` : '')
      + (p ? `<span style="position:relative;width:80%;height:80%;display:block">${animalIcon(p.side, p.kind, { disc: true })}${crown ? '<i style="position:absolute;top:-30%;left:30%;font-style:normal;font-size:min(4vmin,22px)">👑</i>' : ''}</span>` : '');
  });
}

// ---------- Drawer ----------

export function addBoardControls(ui: MenagerieUi, section: Section, btn: Btn, note: (n: string, p: unknown) => void, stop: () => void): { start(o: GameOptions): void } {
  let fb: FakeBoard | null = null;
  let gen = 0;
  const BOT: GameOptions = { mode: 'castle', opponent: { type: 'bot', level: 4, botSide: 'sea' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };
  let endTurnWaiter: (() => void) | null = null;
  /** The toggle as the player last left it (integration keeps this too). */
  let shapeDir: 'up' | 'down' = 'up';

  /** A quiet game screen with a board-game state. */
  function stage(mode: BoardMode, local = false): FakeBoard {
    stop();
    gen++;
    ui.setGameInfo({ ...BOT, mode, ...(local ? { opponent: { type: 'local' } } : {}) });
    ui.show('game');
    ui.setSelection(null);
    ui.setPrompt(null);
    ui.setShapeMode(null);
    ui.setBotThinking(false);
    endTurnWaiter = null;
    fb = new FakeBoard(ui, mode);
    ui.setTurn('land');
    return fb;
  }

  /** A castle after the draft: Land Goat + Elephant, Sea Octopus + Crab, with some sand already built. */
  function castleMid(local = false): FakeBoard {
    const f = stage('castle', local);
    f.st.draft!.picks = { land: ['b', 'r'], sea: ['q', 'p'] };
    f.enter();
    f.st.round = 4;
    f.st.nextTideIn = 2;
    f.st.levels = { d3: 1, d4: 2, e4: 3, e5: 1, c6: 2, f5: 1, f3: 1 };
    return f;
  }

  /** The shape toggle as integration would drive it (castle: shape options around the mover). */
  function shapeFor(f: FakeBoard, dir: 'up' | 'down' = 'up', upBy?: number): void {
    shapeDir = dir;
    ui.setShapeMode({ dir, canUp: true, canDown: true, mode: f.st.mode as BoardMode, upBy });
  }

  // The toggle tells integration; integration answers with the new state. The demo echoes it.
  ui.on('shapeMode', ({ dir }) => {
    note('shapeMode', { dir });
    shapeDir = dir;
    if (!fb) return;
    const mover = fb.st.mover ? fb.st.pieces.find((p) => p.id === fb!.st.mover) : undefined;
    ui.setShapeMode({ dir, canUp: true, canDown: true, mode: fb.st.mode as BoardMode, upBy: mover?.kind === 'r' ? 2 : undefined });
  });
  ui.on('draftPicked', (p) => note('draftPicked', p));
  ui.on('endTurn', () => {
    const w = endTurnWaiter;
    endTurnWaiter = null;
    w?.();
  });
  ui.on('screenChanged', ({ screen }) => {
    if (screen === 'title' || screen === 'setup') {
      gen++;
      fb = null;
      drawBoard(null);
    }
  });

  /** The castle draft: you pick with the picker; the demo bot picks its first free animal after a pause. */
  async function draft(f: FakeBoard, my: number): Promise<void> {
    const o = ui.gameInfo!;
    const botSide = o.opponent.type === 'bot' ? o.opponent.botSide : null;
    const d = f.st.draft!;
    for (let i = 0; i < d.size * 2 && my === gen; i++) {
      const side: Side = i % 2 === 0 ? 'land' : 'sea';
      f.st.turn = side;
      ui.setTurn(side);
      f.push();
      let kind: PieceKind;
      if (side === botSide) {
        ui.setBotThinking(true);
        await wait(900);
        ui.setBotThinking(false);
        kind = (['b', 'q', 'p', 'r', 'n', 'k'] as PieceKind[]).find((k) => !d.picks[side].includes(k))!;
        ui.audio.play('draftPick');
      } else {
        kind = await ui.askDraft(side, { picks: structuredClone(d.picks), size: d.size, traits: TRAITS, hotSeat: botSide === null });
      }
      if (my !== gen) return;
      d.picks[side].push(kind);
      ui.addLog({ side, kind: 'move', label: `Picks the ${TRAIT_TEXT[kind].name}` });
    }
    f.push();
    await wait(400);
    f.enter();
    ui.audio.play('step');
    ui.setTurn('land');
    f.push();
  }

  // The setup screen's Start for Sandcastle King / Stepping Stones.
  async function start(o: GameOptions): Promise<void> {
    stop();
    const my = ++gen;
    ui.setShapeMode(null);
    fb = new FakeBoard(ui, o.mode as BoardMode);
    ui.setTurn('land');
    fb.push();
    if (fb.st.mode === 'castle') {
      await draft(fb, my);
      note('demo', 'Draft done. Use the drawer for the castle stages.');
    } else {
      shapeFor(fb);
      note('demo', 'Stones start. Use the drawer for the stages.');
    }
  }

  // ----- Castle -----
  const castle = section('Sandcastle King', 'Fake states. The stand-in board shows levels (1–3, 🏰 = castle) and animals.');
  btn(castle, 'Draft vs bot', () => {
    const f = stage('castle');
    void draft(f, gen);
  });
  btn(castle, 'Draft, 2 players', () => {
    const f = stage('castle', true);
    void draft(f, gen);
  });
  btn(castle, 'Draft: Sea picks 2nd', () => {
    const f = stage('castle', true);
    f.st.draft!.picks = { land: ['b'], sea: ['q'] };
    f.st.turn = 'land';
    f.push();
    void ui.askDraft('land', { picks: structuredClone(f.st.draft!.picks), size: 2, traits: TRAITS, hotSeat: true }).then((k) => note('askDraft →', k));
  });
  btn(castle, 'Stage: move', () => {
    const f = castleMid();
    f.push();
  });
  btn(castle, 'Stage: build or dig', () => {
    const f = castleMid();
    f.piece('land-b-c2').square = 'd3';
    f.st.stage = 'shape';
    f.st.mover = 'land-b-c2';
    f.push();
    shapeFor(f);
  });
  btn(castle, 'Builder ×2', () => {
    const f = castleMid();
    f.piece('land-r-f2').square = 'e3';
    f.st.stage = 'shape';
    f.st.mover = 'land-r-f2';
    f.push();
    shapeFor(f, 'up', 2);
  });
  btn(castle, "Stage 'more' (Digger)", () => {
    const f = castleMid(true);
    f.st.turn = 'sea';
    ui.setTurn('sea');
    f.piece('sea-p-f7').square = 'e6';
    f.st.stage = 'more';
    f.st.mover = 'sea-p-f7';
    f.setLevel('e5', 0);
    f.push();
    ui.setShapeMode({ dir: 'down', canUp: false, canDown: true, mode: 'castle' });
    const my = gen;
    endTurnWaiter = () => {
      if (my !== gen) return;
      note('endTurn', {});
      ui.setShapeMode(null);
      f.st.turn = 'land';
      f.st.stage = 'move';
      f.st.mover = null;
      f.st.round++;
      ui.setTurn('land');
      f.push();
    };
  });
  btn(castle, 'Crowned: theirs', () => {
    const f = castleMid();
    f.piece('sea-q-c7').square = 'e4';
    f.st.crowned = { pieceId: 'sea-q-c7', side: 'sea', square: 'e4' };
    f.push();
    ui.audio.play('flag');
  });
  btn(castle, 'Crowned: yours', () => {
    const f = castleMid();
    f.piece('land-b-c2').square = 'e4';
    f.st.crowned = { pieceId: 'land-b-c2', side: 'land', square: 'e4' };
    f.st.turn = 'sea';
    ui.setTurn('sea');
    ui.setBotThinking(true);
    f.push();
    ui.audio.play('flag');
  });
  btn(castle, 'Crowned, no Shover', () => {
    const f = castleMid(true);
    f.st.pieces = f.st.pieces.map((p) => (p.id === 'land-r-f2' ? { ...p, kind: 'k', id: 'land-k-f2' } : p));
    f.piece('sea-q-c7').square = 'e4';
    f.st.crowned = { pieceId: 'sea-q-c7', side: 'sea', square: 'e4' };
    f.st.draft!.picks.land = ['b', 'k'];
    f.push();
  });
  btn(castle, 'Tide wears the beach', async () => {
    const f = castleMid();
    f.st.nextTideIn = 1;
    f.push();
    await wait(900);
    for (const s of Object.keys(f.st.levels!) as Square[]) {
      if (Number(s[1]) >= 5 && !f.st.pieces.some((p) => p.square === s)) f.setLevel(s, f.level(s) - 1);
    }
    f.st.nextTideIn = 5;
    f.st.round++;
    ui.audio.play('tideWear');
    f.push();
    ui.addLog({ side: null, kind: 'wheel', label: 'The tide wore the beach down' });
    await ui.announce('The tide wears the beach!', 'info');
  });
  btn(castle, 'Scripted turn', () => void castleTurn());

  /** Your move, your shape (the toggle decides build or dig), then the demo bot's turn and a crown. */
  async function castleTurn(): Promise<void> {
    const f = castleMid();
    const my = gen;
    f.push();
    await wait(1200);
    f.piece('land-b-c2').square = 'd3';
    ui.audio.play('climb');
    f.st.stage = 'shape';
    f.st.mover = 'land-b-c2';
    ui.addLog({ side: 'land', kind: 'move', label: 'Mountain Goat c2→d3 (up to 1)' });
    f.push();
    shapeFor(f);
    note('demo', 'Flip the toggle within 3s: it decides build or dig on d4.');
    await wait(3000);
    if (my !== gen) return;
    const up = shapeDir === 'up';
    f.setLevel('d4', f.level('d4') + (up ? 1 : -1));
    ui.audio.play(up ? 'build' : 'dig');
    ui.addLog({ side: 'land', kind: 'move', label: up ? 'Builds d4' : 'Digs d4' });
    ui.setShapeMode(null);
    f.st.turn = 'sea';
    f.st.stage = 'move';
    f.st.mover = null;
    ui.setTurn('sea');
    f.push();
    ui.setBotThinking(true);
    await wait(1000);
    if (my !== gen) return;
    f.piece('sea-q-c7').square = 'd6';
    ui.audio.play('step');
    f.st.stage = 'shape';
    f.st.mover = 'sea-q-c7';
    f.push();
    await wait(900);
    if (my !== gen) return;
    f.setLevel('e5', 2);
    ui.audio.play('build');
    f.st.turn = 'land';
    f.st.stage = 'move';
    f.st.mover = null;
    f.st.round++;
    ui.setBotThinking(false);
    ui.setTurn('land');
    f.push();
    await wait(1200);
    if (my !== gen) return;
    // You climb onto the castle: the crown and the flag.
    f.piece('land-b-c2').square = 'e4';
    ui.audio.play('climb');
    f.st.crowned = { pieceId: 'land-b-c2', side: 'land', square: 'e4' };
    f.st.stage = 'shape';
    f.st.mover = 'land-b-c2';
    f.push();
    ui.audio.play('flag');
    shapeFor(f);
    note('script', 'done');
  }

  // ----- Stones -----
  const stones = section('Stepping Stones', 'Ranks 3–6 start under water. Dashed squares are fresh. Paths are worked out on the fake board.');
  btn(stones, 'Start: raise or sink', () => {
    const f = stage('stones');
    f.push();
    shapeFor(f);
  });
  btn(stones, 'Stage: move', () => {
    const f = stage('stones');
    f.st.sunk = f.st.sunk.filter((s) => s !== 'd3');
    f.st.fresh = ['d3'];
    f.st.stage = 'move';
    f.push();
  });
  btn(stones, 'Midgame, 2 players', () => {
    const f = stage('stones', true);
    f.st.round = 9;
    f.st.sunk = f.st.sunk.filter((s) => !['c3', 'c4', 'd5', 'd6', 'f6', 'f5', 'e4'].includes(s));
    f.st.fresh = ['e4', 'g5'];
    f.st.powersUsed = ['land-p-g2', 'sea-n-b7', 'sea-r-f7'];
    f.piece('land-b-c2').square = 'c4';
    f.piece('sea-q-d7').square = 'd6';
    f.st.turn = 'sea';
    ui.setTurn('sea');
    f.push();
    shapeFor(f, 'down');
  });
  btn(stones, 'Their path is 1!', () => {
    const f = stage('stones');
    f.st.round = 14;
    // The Blobfish escaped across to a2: one step from Land's back rank.
    f.st.sunk = f.st.sunk.filter((s) => !['e3', 'e4', 'e5', 'e6', 'd3'].includes(s));
    f.piece('sea-k-e7').square = 'a2';
    f.st.powersUsed = ['sea-k-e7'];
    f.push();
    shapeFor(f, 'down');
  });
  btn(stones, 'Only sink possible', () => {
    const f = stage('stones');
    f.push();
    ui.setShapeMode({ dir: 'down', canUp: false, canDown: true, mode: 'stones' });
  });
  btn(stones, 'Bot thinking', () => {
    const f = stage('stones');
    f.st.turn = 'sea';
    ui.setTurn('sea');
    ui.setBotThinking(true);
    f.push();
  });
  btn(stones, 'Hide toggle', () => ui.setShapeMode(null));

  // ----- Results -----
  const res = section('Board-game results');
  btn(res, 'Castle: you win', () => {
    const f = castleMid();
    f.piece('land-b-c2').square = 'e4';
    f.st.crowned = { pieceId: 'land-b-c2', side: 'land', square: 'e4' };
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: 'land', reason: 'castle' });
  });
  btn(res, 'Castle: bot wins', () => {
    const f = castleMid();
    f.piece('sea-q-c7').square = 'e4';
    f.st.crowned = { pieceId: 'sea-q-c7', side: 'sea', square: 'e4' };
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: 'sea', reason: 'castle' });
  });
  btn(res, 'Castle: round 30', () => {
    const f = castleMid();
    f.st.round = 31;
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: null, reason: 'rounds' });
  });
  btn(res, 'Stones: crossed', () => {
    const f = stage('stones', true);
    f.piece('sea-k-e7').square = 'e1';
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: 'sea', reason: 'crossed' });
  });
  btn(res, 'Stones: round 25', () => {
    const f = stage('stones');
    f.st.round = 26;
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: null, reason: 'rounds' });
  });

  const sounds = section('Board-game sounds');
  (['build', 'dig', 'raise', 'sinkStone', 'climb', 'flag', 'tideWear', 'draftPick'] as const).forEach((c) => btn(sounds, c, () => ui.audio.play(c)));

  Object.assign(window, { __board: { stage, castleMid, castleTurn, draft, get fb() { return fb; } } });
  return { start: (o) => (isBoardMode(o.mode) ? void start(o) : undefined) };
}

