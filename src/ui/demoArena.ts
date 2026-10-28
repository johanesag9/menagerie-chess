/**
 * Demo for the party modes (Sumo, Raid): fake ArenaStates that follow the rules in GAME_SPEC "Party modes",
 * drawer buttons for every HUD state, banner, duel and result, and a scripted Sumo turn and Raid turn.
 * The stand-in board draws the animals, sunk squares and treasures so the scripts read. It is not the real world.
 */
import type { ArenaMode, ArenaState, DieValue, DuelInfo, GameOptions, Hand, PieceId, PieceKind, PieceState, Side, Square, WheelOutcome } from '../contracts/types';
import { isArenaMode } from '../contracts/types';
import { animalIcon } from './icons';
import type { MenagerieUi } from './index';
import { TREASURE, apFromDie } from './modeText';

type Section = (title: string, hint?: string) => HTMLElement;
type Btn = (parent: HTMLElement, label: string, fn: () => void) => HTMLButtonElement;

const FILES = 'abcdefgh';
const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const xy = (sq: Square): [number, number] => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
const sq = (f: number, r: number): Square | null => (f < 0 || f > 7 || r < 0 || r > 7 ? null : (`${FILES[f]}${r + 1}` as Square));
/** Rings from the edge in: 0 = the outer ring ... 3 = the middle 2×2. */
const ring = (s: Square): number => {
  const [f, r] = xy(s);
  return Math.min(f, 7 - f, r, 7 - r);
};
const ALL: Square[] = Array.from({ length: 64 }, (_, i) => sq(i % 8, Math.floor(i / 8))!);
const ringSquares = (n: number) => ALL.filter((s) => ring(s) === n);
const ROSTER: [PieceKind, string][] = [['n', 'b'], ['b', 'c'], ['q', 'd'], ['k', 'e'], ['r', 'f'], ['p', 'g']];
const SINK_ROUNDS = [3, 6, 9];

/** A fake arena game. `st` is the snapshot the UI gets; helpers keep the derived fields honest. */
export class FakeArena {
  st: ArenaState;

  constructor(private ui: MenagerieUi, mode: ArenaMode) {
    const pieces: PieceState[] = [];
    for (const side of ['land', 'sea'] as const) {
      for (const [kind, file] of ROSTER) {
        const square = `${file}${side === 'land' ? 2 : 7}` as Square;
        pieces.push({ id: `${side}-${kind}-${square}`, side, kind, square });
      }
    }
    this.st = {
      mode, round: 1, turn: 'land', phase: 'action', die: null, ap: 0, pieces, out: [], powersUsed: [], statuses: [], squares: [],
      duelTokens: { land: 2, sea: 2 }, sunk: [], sinkingNext: [], nextSinkIn: null,
      treasures: mode === 'raid' ? [{ owner: 'land', home: 'e1', square: 'e1', carrier: null }, { owner: 'sea', home: 'd8', square: 'd8', carrier: null }] : [],
      score: { land: 0, sea: 0 }, target: mode === 'raid' ? 3 : 0, nextWheelIn: null, maxRounds: mode === 'raid' ? 20 : 15,
    };
    this.derive();
  }

  /** Sumo: what has sunk, what wobbles, rounds to the next sink. Raid: rounds to the wheel. */
  derive(): void {
    const st = this.st;
    if (st.mode === 'sumo') {
      const gone = SINK_ROUNDS.filter((r) => r < st.round).length;
      st.sunk = ALL.filter((s) => ring(s) < gone);
      const next = SINK_ROUNDS.find((r) => r >= st.round);
      st.nextSinkIn = next === undefined ? null : next - st.round + 1;
      st.sinkingNext = next === st.round ? ringSquares(SINK_ROUNDS.indexOf(next)) : [];
    } else {
      st.nextWheelIn = 5 - ((st.round - 1) % 5);
    }
  }

  push(): void {
    this.ui.setArenaState(structuredClone(this.st));
    drawBoard(this.st);
  }

  piece(id: PieceId): PieceState {
    return this.st.pieces.find((p) => p.id === id)!;
  }

  at(s: Square): PieceState | undefined {
    return this.st.pieces.find((p) => p.square === s);
  }

  /** Put animals where a script wants them (ids keep their start squares). */
  place(spots: Record<PieceId, Square>): void {
    for (const [id, s] of Object.entries(spots)) this.piece(id).square = s;
  }

  fall(id: PieceId): void {
    const p = this.piece(id);
    this.st.pieces = this.st.pieces.filter((x) => x !== p);
    this.st.out.push(p);
  }

  free(s: Square | null): boolean {
    return !!s && !this.at(s) && !this.st.sunk.includes(s) && !this.st.squares.some((e) => e.square === s);
  }

  /** A legal random step for the side to move (the demo bot). */
  randomStep(side: Side): { id: PieceId; from: Square; to: Square } | null {
    const opts: { id: PieceId; from: Square; to: Square }[] = [];
    for (const p of this.st.pieces.filter((x) => x.side === side)) {
      const [f, r] = xy(p.square);
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        const to = sq(f + df, r + dr);
        const own = this.st.treasures.find((t) => t.owner === side)?.home;
        if ((df || dr) && to && this.free(to) && to !== own && !this.st.sinkingNext.includes(to)) opts.push({ id: p.id, from: p.square, to });
      }
    }
    return opts.length ? pick(opts) : null;
  }

  /** Start a turn: roll, AP from the die. */
  async roll(side: Side, value: DieValue): Promise<void> {
    this.st.turn = side;
    this.st.die = null;
    this.st.ap = 0;
    this.ui.setTurn(side);
    this.push();
    await this.ui.rollDie(side, value, 'none', { ap: apFromDie(value) });
    this.st.die = value;
    this.st.ap = apFromDie(value);
    this.push();
  }

  spend(n: number): void {
    this.st.ap = Math.max(0, this.st.ap - n);
  }
}

// ---------- Stand-in board (demo only) ----------

let base: string[] | null = null;
function drawBoard(st: ArenaState | null): void {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('#board > i'));
  if (!cells.length) return;
  base ??= cells.map((c) => c.style.background);
  cells.forEach((c, i) => {
    const s = sq(i % 8, 7 - Math.floor(i / 8))!;
    c.style.background = base![i];
    c.style.outline = '';
    c.innerHTML = '';
    c.style.display = 'grid';
    c.style.placeItems = 'center';
    if (!st) return;
    if (st.sunk.includes(s)) c.style.background = '#3c8fb5';
    else if (st.sinkingNext.includes(s)) c.style.outline = '3px dashed #c3412d';
    const p = st.pieces.find((x) => x.square === s);
    const t = st.treasures.find((x) => x.square === s);
    if (p) c.innerHTML = `<span style="width:80%;height:80%;display:block">${animalIcon(p.side, p.kind, { disc: true })}</span>`;
    else if (t) c.innerHTML = `<span style="font-size:min(5vmin,32px)">${TREASURE[t.owner].icon}</span>`;
  });
}

// ---------- Drawer ----------

export function addArenaControls(ui: MenagerieUi, section: Section, btn: Btn, note: (n: string, p: unknown) => void, stop: () => void): { start(o: GameOptions): void } {
  let fa: FakeArena | null = null;
  let gen = 0;
  const BOT: GameOptions = { mode: 'sumo', opponent: { type: 'bot', level: 2, botSide: 'sea' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };
  const LOCAL: GameOptions = { ...BOT, opponent: { type: 'local' } };
  let endTurnWaiter: (() => void) | null = null;

  /** A quiet game screen with a party state. */
  function stage(mode: ArenaMode, local = false): FakeArena {
    stop();
    gen++;
    ui.setGameInfo({ ...(local ? LOCAL : BOT), mode });
    ui.show('game');
    ui.setSelection(null);
    ui.setPrompt(null);
    fa = new FakeArena(ui, mode);
    ui.setTurn('land');
    return fa;
  }

  // The setup screen's Start for Sumo/Raid: a playable-ish fake (End turn passes; the demo bot steps at random).
  async function start(o: GameOptions): Promise<void> {
    const mode = o.mode as ArenaMode;
    stop();
    const my = ++gen;
    fa = new FakeArena(ui, mode);
    ui.setTurn('land');
    fa.push();
    await wait(500);
    await turn(fa, 'land', my);
  }

  /** One turn of the free-play fake: humans press End turn, the bot takes random steps. */
  async function turn(f: FakeArena, side: Side, my: number): Promise<void> {
    if (my !== gen) return;
    const o = ui.gameInfo!;
    const bot = o.opponent.type === 'bot' && o.opponent.botSide === side;
    await f.roll(side, (1 + Math.floor(Math.random() * 6)) as DieValue);
    if (bot) {
      ui.setBotThinking(true);
      while (f.st.ap > 0 && my === gen) {
        await wait(700);
        const s = f.randomStep(side);
        if (!s) break;
        f.piece(s.id).square = s.to;
        f.spend(1);
        ui.audio.play('step');
        ui.addLog({ side, kind: 'move', label: `${s.from}→${s.to}` });
        f.push();
      }
      ui.setBotThinking(false);
    } else {
      await new Promise<void>((res) => (endTurnWaiter = res));
    }
    if (my !== gen) return;
    await endOfTurn(f, side);
    if (f.st.phase !== 'over') await turn(f, other(side), my);
  }

  /** End of a turn: Sumo sinks a ring after Sea's turn in rounds 3, 6 and 9; Raid's wheel spins every 5 rounds. */
  async function endOfTurn(f: FakeArena, side: Side): Promise<void> {
    const st = f.st;
    st.ap = 0;
    if (side === 'sea') {
      if (st.mode === 'sumo' && st.sinkingNext.length) {
        const doomed = st.pieces.filter((p) => st.sinkingNext.includes(p.square));
        st.sunk = [...st.sunk, ...st.sinkingNext];
        st.sinkingNext = [];
        doomed.forEach((p) => f.fall(p.id));
        f.push();
        ui.audio.play('sink');
        await ui.announce('The island sinks!', 'bad');
        if (doomed.length) ui.audio.play('splash');
        ui.addLog({ side: null, kind: 'wheel', label: doomed.length ? `The edge sank: ${doomed.length} fell in` : 'The edge sank' });
      }
      st.round++;
      if (st.round > st.maxRounds) {
        st.phase = 'over';
        f.push();
        const n = (s: Side) => (st.mode === 'sumo' ? st.pieces.filter((p) => p.side === s).length : st.score[s]);
        ui.showResult({ winner: n('land') === n('sea') ? null : n('land') > n('sea') ? 'land' : 'sea', reason: 'rounds' });
        return;
      }
      f.derive();
      if (st.mode === 'raid' && st.nextWheelIn === 5 && st.round > 1) {
        const w = pick<WheelOutcome>(['tide', 'earthquake', 'disco']);
        await ui.spinWheel(w);
        ui.addLog({ side: null, kind: 'wheel', label: `Wheel: ${w[0].toUpperCase()}${w.slice(1)}` });
      }
    }
    f.push();
  }

  ui.on('endTurn', () => {
    note('endTurn', {});
    const w = endTurnWaiter;
    endTurnWaiter = null;
    w?.();
  });
  ui.on('screenChanged', ({ screen }) => {
    if (screen === 'title' || screen === 'setup') {
      gen++;
      drawBoard(null);
    }
  });

  // ----- HUD states -----
  const hud = section('Party HUD (Sumo, Raid)', 'Fake states that follow the party rules. The stand-in board shows animals, water and treasures.');
  btn(hud, 'Sumo start', () => {
    const f = stage('sumo');
    f.st.die = 4;
    f.st.ap = 3;
    f.push();
  });
  btn(hud, 'Sumo: sinks this round', () => {
    const f = stage('sumo');
    f.st.round = 3;
    f.derive();
    f.st.die = 6;
    f.st.ap = 2;
    f.place({ 'land-k-e2': 'd3', 'land-r-f2': 'e4', 'sea-n-b7': 'b8', 'sea-p-g7': 'h5' });
    f.st.powersUsed = ['land-n-b2'];
    f.push();
  });
  btn(hud, 'Sumo: round 8, late', () => {
    const f = stage('sumo');
    f.st.round = 8;
    f.place({ 'land-k-e2': 'd4', 'land-r-f2': 'e5', 'land-q-d2': 'c3', 'land-b-c2': 'f3', 'sea-k-e7': 'e4', 'sea-r-f7': 'd5', 'sea-q-d7': 'c6', 'sea-p-g7': 'f6' });
    f.fall('land-n-b2');
    f.fall('land-p-g2');
    f.fall('sea-n-b7');
    f.fall('sea-b-c7');
    f.st.powersUsed = ['land-k-e2', 'land-q-d2', 'sea-r-f7'];
    f.st.statuses = [{ pieceId: 'sea-p-g7', status: 'anchored', turnsLeft: 1 }];
    f.st.duelTokens = { land: 1, sea: 0 };
    f.st.turn = 'sea';
    f.derive();
    f.st.die = 2;
    f.st.ap = 2;
    ui.setTurn('sea');
    f.push();
  });
  btn(hud, 'Raid start', () => {
    const f = stage('raid');
    f.st.die = 3;
    f.st.ap = 3;
    f.push();
  });
  btn(hud, 'Raid: pearl carried', () => {
    const f = stage('raid');
    f.st.round = 9;
    f.derive();
    f.st.score = { land: 1, sea: 2 };
    // The Seahorse carried the bone into the meadow, was tagged on f4 and sent home to b8.
    f.place({ 'land-n-b2': 'c6', 'land-q-d2': 'd4', 'sea-n-b7': 'b8', 'sea-p-g7': 'f5' });
    f.st.treasures[1] = { owner: 'sea', home: 'd8', square: null, carrier: 'land-n-b2' };
    f.st.treasures[0] = { owner: 'land', home: 'e1', square: 'f4', carrier: null };
    f.st.die = 5;
    f.st.ap = 4;
    f.push();
  });
  btn(hud, 'Raid, 2 players', () => {
    const f = stage('raid', true);
    f.st.round = 5;
    f.derive();
    f.st.turn = 'sea';
    f.st.die = 1;
    f.st.ap = 2;
    ui.setTurn('sea');
    f.push();
  });
  btn(hud, 'Out of AP', () => {
    const f = fa ?? stage('sumo');
    f.st.ap = 0;
    f.st.die ??= 2;
    f.push();
  });
  let thinking = false;
  btn(hud, 'Bot thinking', () => {
    const f = fa ?? stage('sumo');
    f.st.turn = 'sea';
    ui.setTurn('sea');
    f.push();
    ui.setBotThinking((thinking = !thinking));
  });
  // Core sends the party name and line in PowerInfo; `note` is a plain reason when it can't be used.
  btn(hud, 'Select: Pup (Dig in)', () => {
    if (!fa) stage('sumo');
    ui.setSelection({ pieceId: 'land-p-g2', side: 'land', kind: 'p', power: { power: 'sidestep', available: true, name: 'Dig in', line: "Can't be pushed until the start of your next turn." } });
  });
  btn(hud, 'Select: not enough AP', () => {
    if (!fa) stage('sumo');
    ui.setSelection({ pieceId: 'land-r-f2', side: 'land', kind: 'r', power: { power: 'stomp', available: false, reason: 'wrongPhase', note: 'Not enough AP' } });
  });
  btn(hud, 'Hide', () => {
    ui.setArenaState(null);
    drawBoard(null);
  });

  // ----- Single events -----
  const ev = section('Party: banners, die, duels', 'Banners skip on a tap or Space and never block the board.');
  btn(ev, 'Announce: info', () => void ui.announce('The island sinks!', 'info'));
  btn(ev, 'Announce: good', () => void ui.announce('Pearl stolen!', 'good'));
  btn(ev, 'Announce: bad', () => void ui.announce('Pug overboard!', 'bad'));
  btn(ev, 'Announce: +1 Sea', () => {
    ui.audio.play('score');
    void ui.announce('+1 Sea!', 'good');
  });
  btn(ev, 'Roll 5 → 4 AP', () => {
    const f = fa ?? stage('raid');
    void f.roll('land', 5);
  });
  const SHOVE: DuelInfo = { attackerId: 'sea-r-f7', victimId: 'land-k-e2', via: 'shove', from: 'f5', to: 'e4', attacker: 'sea', defender: 'land', tokensLeft: 2 };
  btn(ev, 'Duel ask: shove', async () => {
    if (!fa) stage('sumo');
    note('askDuel →', await ui.askDuel(SHOVE));
  });
  btn(ev, 'Duel ask: tag', async () => {
    if (!fa) stage('raid');
    note('askDuel →', await ui.askDuel({ attackerId: 'sea-p-g7', victimId: 'land-n-b2', via: 'tag', from: 'b6', to: 'c7', attacker: 'sea', defender: 'land', tokensLeft: 1 }));
  });
  btn(ev, 'Raid wheel: Pigeon', () => {
    if (fa?.st.mode !== 'raid') stage('raid');
    void ui.spinWheel('pigeon');
  });

  const res = section('Party results');
  const sumoResult = (winner: Side | null) => {
    if (fa?.st.mode !== 'sumo') stage('sumo');
    ui.showResult({ winner, reason: 'kingOverboard' });
  };
  btn(res, 'Sumo: you win', () => sumoResult('land'));
  btn(res, 'Sumo: bot wins', () => sumoResult('sea'));
  btn(res, 'Sumo: both kings', () => sumoResult(null));
  btn(res, 'Raid: 3 points', () => {
    const f = fa?.st.mode === 'raid' ? fa : stage('raid');
    f.st.score = { land: 3, sea: 1 };
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: 'land', reason: 'treasure' });
  });
  btn(res, 'Round cap', () => {
    const f = fa ?? stage('sumo');
    f.st.round = f.st.maxRounds;
    f.st.phase = 'over';
    f.push();
    ui.showResult({ winner: 'land', reason: 'rounds' });
  });

  // ----- Scripts -----
  const script = section('Scripted party turns', 'Answer the questions yourself. Sumo waits for you to press End turn (or E).');
  btn(script, '▶ Sumo turn', () => void sumoTurn());
  btn(script, '▶ Raid turn', () => void raidTurn());

  /** Throws for a duel the human attacks or defends in a bot game (the bot's hand is random). Returns the winner. */
  async function duel(info: DuelInfo, human: Side): Promise<'attacker' | 'defender'> {
    const beats: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    for (let n = 1; n <= 3; n++) {
      const mine = await ui.askThrow(human, { hotSeat: false });
      const theirs = pick<Hand>(['rock', 'paper', 'scissors']);
      const atk = info.attacker === human ? mine : theirs;
      const def = info.defender === human ? mine : theirs;
      const tie = atk === def;
      const result = tie ? (n === 3 ? 'attacker' : 'tie') : beats[def] === atk ? 'defender' : 'attacker';
      await ui.showDuelRound({ info, round: n, attackerHand: atk, defenderHand: def, result: tie ? 'tie' : result });
      if (!tie) return result as 'attacker' | 'defender';
    }
    return 'attacker'; // 3 ties: the attacker wins
  }

  async function sumoTurn(): Promise<void> {
    const f = stage('sumo');
    const my = gen;
    const st = f.st;
    st.round = 3;
    f.derive();
    f.place({
      'land-n-b2': 'c3', 'land-b-c2': 'g5', 'land-k-e2': 'd3', 'land-r-f2': 'e4',
      'sea-n-b7': 'b8', 'sea-b-c7': 'c6', 'sea-q-d7': 'd6', 'sea-k-e7': 'e6', 'sea-r-f7': 'f6', 'sea-p-g7': 'h5',
    });
    note('script', 'Sumo, round 3: the edge sinks after this round');
    await f.roll('land', 5);

    await wait(600);
    note('script', 'step: Pug d3→d4 (1 AP)');
    f.place({ 'land-k-e2': 'd4' });
    f.spend(1);
    ui.audio.play('step');
    ui.addLog({ side: 'land', kind: 'move', label: 'Pug d3→d4' });
    f.push();

    await wait(700);
    note('script', 'shove: Goat g5 shoves the Crab off the board (2 AP); Sea calls a duel');
    ui.setSelection({ pieceId: 'land-b-c2', side: 'land', kind: 'b', power: { power: 'headbutt', available: true } });
    await wait(500);
    ui.setSelection(null);
    const info: DuelInfo = { attackerId: 'land-b-c2', victimId: 'sea-p-g7', via: 'shove', from: 'g5', to: 'g5', attacker: 'land', defender: 'sea', tokensLeft: st.duelTokens.sea };
    st.phase = 'duel';
    st.duelTokens.sea--;
    f.push();
    ui.audio.play('duelCall');
    const won = await duel(info, 'land');
    if (my !== gen) return;
    st.phase = 'action';
    f.spend(2);
    if (won === 'attacker') {
      ui.audio.play('shove');
      await wait(250);
      f.fall('sea-p-g7');
      ui.audio.play('splash');
      ui.addLog({ side: 'land', kind: 'move', label: 'Goat shoves Crab off h5: overboard!' });
      f.push();
      await ui.announce('Crab overboard!', 'good');
    } else {
      ui.audio.play('bonk');
      ui.addLog({ side: 'land', kind: 'bonk', label: 'Bonked! The shove failed' });
      f.push();
      await ui.announce('Shove blocked!', 'bad');
    }

    note('script', 'waiting for End turn (1 AP left is lost)');
    await new Promise<void>((res) => (endTurnWaiter = res));
    if (my !== gen) return;

    // The bot's turn: two steps.
    await f.roll('sea', 2);
    ui.setBotThinking(true);
    for (const [id, to, label] of [['sea-r-f7', 'f5', 'Turtle f6→f5'], ['sea-q-d7', 'd5', 'Octopus d6→d5']] as const) {
      await wait(700);
      f.place({ [id]: to });
      f.spend(1);
      ui.audio.play('step');
      ui.addLog({ side: 'sea', kind: 'move', label });
      f.push();
    }
    ui.setBotThinking(false);
    await endOfTurn(f, 'sea');
    if (my !== gen) return;
    await f.roll('land', 3);
    note('script', 'done');
  }

  async function raidTurn(): Promise<void> {
    const f = stage('raid');
    const my = gen;
    const st = f.st;
    st.round = 5;
    f.derive();
    st.powersUsed = ['land-q-d2', 'sea-k-e7'];
    f.place({
      'land-n-b2': 'c7', 'land-b-c2': 'c4', 'land-q-d2': 'd4', 'land-k-e2': 'e3', 'land-r-f2': 'f3', 'land-p-g2': 'g3',
      'sea-p-g7': 'b6', 'sea-b-c7': 'c8', 'sea-q-d7': 'd6', 'sea-k-e7': 'e6', 'sea-r-f7': 'f6', 'sea-n-b7': 'g5',
    });
    note('script', 'Raid, round 5: the Horse is next to the pearl');
    await f.roll('land', 4);

    await wait(700);
    note('script', 'step onto d8 (1 AP): pick up the pearl (free)');
    f.place({ 'land-n-b2': 'd8' });
    f.spend(1);
    st.treasures[1] = { ...st.treasures[1], square: null, carrier: 'land-n-b2' };
    ui.audio.play('step');
    ui.audio.play('pickup');
    ui.addLog({ side: 'land', kind: 'move', label: 'Horse c7→d8, grabs the pearl' });
    f.push();
    await ui.announce('Pearl stolen!', 'good');

    await wait(400);
    note('script', 'carrier step d8→c7 (2 AP): AP runs out, the turn ends');
    ui.setSelection({ pieceId: 'land-n-b2', side: 'land', kind: 'n', power: { power: 'doubleJump', available: false, reason: 'wrongPhase' } });
    f.place({ 'land-n-b2': 'c7' });
    f.spend(2);
    ui.audio.play('step', { rate: 0.8 });
    ui.addLog({ side: 'land', kind: 'move', label: 'Horse d8→c7 (carrying: 2 AP)' });
    f.push();
    await wait(700);
    ui.setSelection(null);

    // Sea: the Crab tags the carrier. Land may duel.
    await f.roll('sea', 6);
    ui.setBotThinking(true);
    await wait(700);
    ui.setBotThinking(false);
    const info: DuelInfo = { attackerId: 'sea-p-g7', victimId: 'land-n-b2', via: 'tag', from: 'b6', to: 'c7', attacker: 'sea', defender: 'land', tokensLeft: st.duelTokens.land };
    st.phase = 'duel';
    f.push();
    const call = await ui.askDuel(info);
    if (my !== gen) return;
    let dodged = false;
    if (call) {
      st.duelTokens.land--;
      f.push();
      dodged = (await duel(info, 'land')) === 'defender';
    }
    st.phase = 'action';
    f.spend(1);
    if (dodged) {
      ui.audio.play('bonk');
      ui.addLog({ side: 'sea', kind: 'bonk', label: 'Bonked! The tag failed' });
      f.push();
      await ui.announce('Tag dodged!', 'good');
    } else {
      ui.audio.play('tag');
      f.place({ 'land-n-b2': 'c1' });
      st.treasures[1] = { ...st.treasures[1], square: 'c7', carrier: null };
      ui.audio.play('drop');
      ui.addLog({ side: 'sea', kind: 'move', label: 'Crab tags Horse: sent home, pearl dropped on c7' });
      f.push();
      await ui.announce('Pearl dropped!', 'bad');
      await wait(500);
      // Its owner steps on it: the pearl flies home.
      f.place({ 'sea-b-c7': 'c7' });
      f.spend(1);
      st.treasures[1] = { ...st.treasures[1], square: 'd8' };
      ui.audio.play('treasureHome');
      ui.addLog({ side: 'sea', kind: 'move', label: 'Pufferfish c8→c7, the pearl flies home' });
      f.push();
      await ui.announce('Pearl back home!', 'info');
    }
    ui.setBotThinking(true);
    while (st.ap > 0 && my === gen) {
      await wait(600);
      const s = f.randomStep('sea');
      if (!s) break;
      f.place({ [s.id]: s.to });
      f.spend(1);
      ui.audio.play('step');
      f.push();
    }
    ui.setBotThinking(false);
    if (my !== gen) return;
    // End of round 5: the wheel spins at the start of round 6.
    st.round++;
    f.derive();
    f.push();
    await ui.spinWheel('disco');
    st.powersUsed = [];
    ui.addLog({ side: null, kind: 'wheel', label: 'Wheel: Disco (every power recharges)' });
    f.push();
    await f.roll('land', 1);
    note('script', 'done');
  }

  Object.assign(window, { __arena: { stage, sumoTurn, raidTurn, get fa() { return fa; } } });
  return { start: (o) => (isArenaMode(o.mode) ? void start(o) : undefined) };
}
