/**
 * Fuzz for the board-game modes (castle, stones): seeded games through the controller, each action from the bot's
 * brain (a cheap level) or a random legal one. After every action: no exceptions; everything `pieceOptions`,
 * `shapeOptions`, `targets()` and the draft offer is legal and every legal action is offered; a made-up illegal action
 * is refused without events; animals, levels, water and the crown rebuilt from events alone match `state`; the event
 * order holds; the state's own rules hold. Each game is then replayed from its seed and inputs: the same events.
 */
import { describe, it } from 'vitest';
import type { ArenaAction, ArenaState, BoardChange, BoardMode, PieceKind, PieceState, Square } from '../../contracts/types';
import { seeded } from '../testUtils';
import { decideArena } from './bot';
import { ArenaGame } from './game';
import { actionKey, cloneArena, legalActions } from './rules';
import type { BoardBotLevel } from './tuning';

/** 200 games per mode; `ARENA_FUZZ_GAMES=10` runs a quick sample. */
const GAMES = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ARENA_FUZZ_GAMES) || 200;
const CHUNK = Math.min(25, GAMES);
const MAX_ACTIONS = 400;
const SQUARES: Square[] = [];
for (const r of '12345678') for (const f of 'abcdefgh') SQUARES.push(`${f}${r}` as Square);
const FUZZ_BOT: BoardBotLevel = { depth: 1, width: 1, noise: 60, tolerance: 40, minThinkMs: 0 };
const KINDS: PieceKind[] = ['p', 'n', 'b', 'r', 'q', 'k'];

function need(ok: unknown, what: () => string): void {
  if (!ok) throw new Error(what());
}

const cheb = (a: Square, b: Square) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1])));
const NEAR = (sq: Square) => SQUARES.filter((x) => cheb(x, sq) === 1);

/**
 * Animals, levels, water and the crown, kept up to date from events only (the way integration would). Each change is
 * also checked against the rules on its own, so a rule bug shared by the options and the legal list still shows.
 */
function tracker(g: ArenaGame) {
  const map = new Map<string, PieceState>();
  const levels = new Map<Square, number>();
  const sunk = new Set<Square>();
  let fresh = new Set<Square>();
  let crowned: ArenaState['crowned'] = null;
  const lv = (sq: Square) => levels.get(sq) ?? 0;
  const animalOn = (sq: Square) => [...map.values()].find((p) => p.square === sq);
  const apply = (changes: BoardChange[], mover: string | null) => {
    for (const c of changes) {
      if (c.type === 'move') {
        const p = map.get(c.pieceId);
        need(p, () => `event moved unknown piece ${c.pieceId}`);
        need(p!.square === c.from, () => `move of ${c.pieceId} from ${c.from}, but it was on ${p!.square}`);
        need(!animalOn(c.to), () => `${c.pieceId} moved onto ${animalOn(c.to)?.id}`);
        if (g.raw.mode === 'castle') {
          const up = lv(c.to) - lv(c.from);
          const max = c.how === 'step' && p!.kind === 'b' ? 2 : 1;
          need(up <= max, () => `${c.pieceId} (${c.how}) climbed ${up} levels ${c.from}→${c.to}`);
          need(c.how !== 'jump' || p!.kind === 'n', () => `${c.pieceId} hopped without being the Leaper`);
          need(c.how === 'pushed' ? cheb(c.from, c.to) === 1 : c.how === 'jump' || cheb(c.from, c.to) === 1, () => `${c.how} ${c.from}→${c.to} too far`);
        } else {
          need(!sunk.has(c.to), () => `${c.pieceId} moved into the water at ${c.to}`);
        }
        p!.square = c.to;
      } else if (c.type === 'enter') {
        need(!map.has(c.piece.id), () => `${c.piece.id} entered twice`);
        map.set(c.piece.id, { ...c.piece });
      } else if (c.type === 'level') {
        need((levels.get(c.square) ?? 0) === c.from, () => `level change on ${c.square} from ${c.from}, but it was ${levels.get(c.square) ?? 0}`);
        const on = animalOn(c.square);
        if (c.cause === 'tide') {
          need(!on && Number(c.square[1]) >= 5 && c.to === c.from - 1, () => `tide on ${c.square}`);
        } else {
          const by = map.get(c.by ?? '');
          need(by && by.id === mover && cheb(by.square, c.square) === 1, () => `${c.cause} on ${c.square} by ${c.by}, not next to the mover ${mover}`);
          if (c.cause === 'build') need(!on && c.to === Math.min(3, c.from + (by!.kind === 'r' ? 2 : 1)), () => `bad build on ${c.square} (${on?.id ?? 'empty'}) ${c.from}→${c.to}`);
          else need(c.to === c.from - 1 && (!on || on.side !== by!.side), () => `bad dig on ${c.square} under ${on?.id}`);
        }
        need(Math.abs(c.to - c.from) <= 2 && c.to !== c.from, () => `odd level change ${c.from}→${c.to}`);
        if (c.to) levels.set(c.square, c.to);
        else levels.delete(c.square);
      } else if (c.type === 'water') {
        need(sunk.has(c.square) !== c.sunk, () => `water change on ${c.square} to ${c.sunk}, but it already was`);
        if (c.cause !== 'stomp') need(!fresh.has(c.square), () => `${c.cause} on fresh square ${c.square}`);
        if (c.sunk) need(!animalOn(c.square) && '3456'.includes(c.square[1]), () => `sank ${c.square} (${animalOn(c.square)?.id ?? 'empty'})`);
        else need(NEAR(c.square).some((x) => !sunk.has(x)), () => `raised ${c.square} away from dry land`);
        if (c.sunk) sunk.add(c.square);
        else sunk.delete(c.square);
      } else if (c.type !== 'block') {
        throw new Error(`a board-game mode sent a '${c.type}' change`);
      }
    }
  };
  g.on('started', (e) => {
    map.clear();
    levels.clear();
    sunk.clear();
    crowned = null;
    for (const p of e.state.pieces) map.set(p.id, { ...p });
    for (const sq of e.state.sunk) sunk.add(sq);
  });
  g.on('acted', (a) => apply(a.changes, g.state.mover ?? null));
  g.on('tide', (t) => apply(t.changes, null));
  g.on('crowned', (c) => (crowned = c.crowned));
  return {
    check(s: ArenaState) {
      fresh = new Set(s.fresh ?? []);
      need(map.size === s.pieces.length, () => `tracked ${map.size} animals, state has ${s.pieces.length}`);
      for (const p of s.pieces) {
        const t = map.get(p.id);
        need(t && t.square === p.square && t.kind === p.kind && t.side === p.side, () => `piece ${p.id} on ${p.square}, events say ${t?.square}`);
      }
      const lv = Object.entries(s.levels ?? {});
      need(lv.length === levels.size && lv.every(([sq, l]) => levels.get(sq as Square) === l), () => `levels: state ${JSON.stringify(s.levels)}, events ${JSON.stringify([...levels])}`);
      need(s.sunk.length === sunk.size && s.sunk.every((sq) => sunk.has(sq)), () => 'water squares differ from the events');
    },
    /** The crown from `crowned` events, checked once an action has fully resolved. */
    checkCrown(s: ArenaState) {
      if (s.mode !== 'castle' || s.phase === 'over') return;
      need(JSON.stringify(crowned) === JSON.stringify(s.crowned ?? null), () => `crowned: state ${JSON.stringify(s.crowned)}, events ${JSON.stringify(crowned)}`);
    },
  };
}

/** The state's own rules. */
function checkState(s: ArenaState): void {
  const on = new Map<Square, string>();
  const sunk = new Set(s.sunk);
  const blocked = new Set(s.squares.map((b) => b.square));
  for (const p of s.pieces) {
    need(!on.has(p.square), () => `two animals on ${p.square}`);
    on.set(p.square, p.id);
    need(!sunk.has(p.square), () => `${p.id} stands on water ${p.square}`);
    need(!blocked.has(p.square), () => `${p.id} stands on a block ${p.square}`);
  }
  need(s.die === null && s.ap === 0 && s.duelTokens.land === 0 && s.duelTokens.sea === 0, () => 'die, AP or duel tokens in a board-game mode');
  need(s.phase !== 'duel', () => 'a duel in a board-game mode');
  if (s.mode === 'castle') {
    for (const l of Object.values(s.levels ?? {})) need(l! >= 1 && l! <= 3, () => `level ${l}`);
    need(s.sunk.length === 0, () => 'water in castle');
    if (s.crowned) need((s.levels ?? {})[s.crowned.square] === 3 && on.get(s.crowned.square) === s.crowned.pieceId, () => `crowned ${JSON.stringify(s.crowned)} isn't on a castle`);
    need(s.phase === 'over' || (s.phase === 'draft') === (s.stage === 'pick'), () => `phase ${s.phase} with stage ${s.stage}`);
  } else {
    need(s.stage === undefined || s.stage === 'shape' || s.stage === 'move', () => `stones stage ${s.stage}`);
    if (s.phase !== 'over') {
      for (const side of ['land', 'sea'] as const) {
        const back = side === 'land' ? '8' : '1';
        need(!s.pieces.some((p) => p.side === side && p.square[1] === back), () => `${side} stands on the enemy back rank but the game goes on`);
      }
    }
  }
  need(s.round <= s.maxRounds, () => `round ${s.round} past the cap`);
}

/** Every option the controller offers must be in the legal list, and the other way round. */
function checkOptions(g: ArenaGame): void {
  const s = g.state;
  const legal = new Set(legalActions(g.raw).map(actionKey));
  const offered = new Set<string>();
  if (s.stage === 'more') offered.add('e');
  if (s.phase === 'draft') {
    for (const k of KINDS) if (!s.draft!.picks[s.turn].includes(k)) offered.add(actionKey({ type: 'pick', kind: k }));
  }
  for (const o of g.shapeOptions()) {
    need(o.up || o.down, () => `shape option ${o.square} with neither way`);
    if (o.up) offered.add(actionKey({ type: 'shape', pieceId: s.mover ?? null, square: o.square, dir: 'up' }));
    if (o.down) offered.add(actionKey({ type: 'shape', pieceId: s.mover ?? null, square: o.square, dir: 'down' }));
  }
  for (const p of s.pieces) {
    const o = g.pieceOptions(p.id);
    need(o.power.name && o.power.line, () => `no trait/power text for ${p.id}`);
    if (s.mode === 'castle') need(o.power.available, () => `castle trait of ${p.id} shows as unavailable`);
    if (p.side !== s.turn) {
      need(!o.steps.length && !o.hits.length && (s.mode === 'castle' || !o.power.available), () => `options for ${p.id} out of turn`);
      continue;
    }
    for (const to of o.steps) offered.add(actionKey({ type: 'step', pieceId: p.id, to }));
    for (const target of o.hits) {
      offered.add(actionKey({ type: 'hit', pieceId: p.id, target }));
      need(g.previewArea({ pieceId: p.id, hit: target }).area.length === 2, () => `push preview for ${p.id} → ${target}`);
    }
    if (s.mode !== 'stones') continue;
    let lists = 0;
    const walk = (picked: Square[]) => {
      const t = g.targets({ pieceId: p.id, targets: picked });
      g.previewArea({ pieceId: p.id, targets: picked });
      if (t.complete) {
        lists++;
        offered.add(actionKey({ type: 'power', pieceId: p.id, targets: picked }));
      }
      for (const sq of t.squares) walk([...picked, sq]);
    };
    walk([]);
    need(o.power.available === lists > 0, () => `power of ${p.id}: available ${o.power.available}, ${lists} target lists`);
  }
  for (const k of offered) need(legal.has(k), () => `offered but illegal: ${k}`);
  for (const k of legal) need(offered.has(k), () => `legal but not offered: ${k}`);
}

export function fuzzBoard(mode: BoardMode): void {
  describe(`fuzz ${mode}`, () => {
    for (let c = 0; c < GAMES / CHUNK; c++) {
      it(`games ${c * CHUNK + 1}-${(c + 1) * CHUNK}`, { timeout: 600000 }, () => {
        for (let k = 0; k < CHUNK; k++) playOne(mode, 2000 + c * CHUNK + k);
      });
    }
  });
}

/** Play one game with checks; returns the inputs and the full event log. */
function playOne(mode: BoardMode, seed: number): void {
  const rnd = seeded(seed);
  const g = new ArenaGame({ botMinThinkMs: 0 });
  const tr = tracker(g);
  const names: string[] = [];
  const log: string[] = [];
  let over = false;
  for (const n of ['acted', 'logged', 'state', 'tide', 'crowned', 'rolled', 'turnChanged', 'gameOver', 'duelOffered'] as const) {
    g.on(n, (p) => {
      names.push(n);
      log.push(`${n}:${JSON.stringify(p)}`);
    });
  }
  g.on('state', (s) => {
    tr.check(s);
    checkState(s);
  });
  g.on('gameOver', () => (over = true));
  const inputs: ArenaAction[] = [];
  const where = () => `(${mode} seed ${seed}, round ${g.state.round}, ${g.state.turn}, stage ${g.state.stage})`;
  try {
    g.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed });
    for (let n = 0; n < MAX_ACTIONS && !over; n++) {
      const s = g.state;
      need(s.phase === 'action' || s.phase === 'draft', () => `phase ${s.phase} between actions`);
      checkOptions(g);
      tr.checkCrown(s);
      // Made-up actions that aren't legal are refused without events.
      const piece = s.pieces[Math.floor(rnd() * s.pieces.length)];
      const bogus: ArenaAction[] = [
        { type: 'shape', pieceId: s.mover ?? null, square: SQUARES[Math.floor(rnd() * 64)], dir: rnd() < 0.5 ? 'up' : 'down' },
        { type: 'endTurn' },
        { type: 'pick', kind: KINDS[Math.floor(rnd() * 6)] },
        ...(piece ? [{ type: 'step', pieceId: piece.id, to: SQUARES[Math.floor(rnd() * 64)] } as ArenaAction] : []),
      ];
      for (const b of bogus) {
        if (legalActions(g.raw).some((a) => actionKey(a) === actionKey(b))) continue;
        const before = names.length;
        need(!g.act(b).ok && names.length === before, () => `illegal action accepted: ${JSON.stringify(b)}`);
      }
      let a: ArenaAction;
      if (rnd() < 0.5) {
        a = decideArena({ state: cloneArena(g.raw), level: g.raw.cfg.bot[1], board: FUZZ_BOT, seed: Math.floor(rnd() * 2 ** 31) });
      } else {
        const all = legalActions(g.raw);
        a = all[Math.floor(rnd() * all.length)];
      }
      const start = names.length;
      const r = g.act(a);
      need(r.ok && !(r.ok && r.pending), () => `legal action refused: ${JSON.stringify(a)} ${!r.ok ? r.reason : ''}`);
      inputs.push(a);
      checkOrder(names.slice(start));
    }
    need(over, () => `game didn't end in ${MAX_ACTIONS} actions`);
    need(!names.includes('rolled') && !names.includes('duelOffered'), () => 'rolled or a duel in a board-game mode');
    // Same seed, same inputs: the same game, event for event.
    const again: string[] = [];
    const g2 = new ArenaGame({ botMinThinkMs: 0 });
    for (const n of ['acted', 'logged', 'state', 'tide', 'crowned', 'rolled', 'turnChanged', 'gameOver', 'duelOffered'] as const) {
      g2.on(n, (p) => again.push(`${n}:${JSON.stringify(p)}`));
    }
    g2.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed });
    for (const a of inputs) need(g2.act(a).ok, () => `replay refused ${JSON.stringify(a)}`);
    need(again.length === log.length && again.every((e, k) => e === log[k]), () => {
      const k = again.findIndex((e, j) => e !== log[j]);
      return `replay differs at event ${k}: ${log[k]?.slice(0, 200)} vs ${again[k]?.slice(0, 200)}`;
    });
  } catch (err) {
    (err as Error).message += ` ${where()}`;
    throw err;
  }
}

/** acted → logged → state; tide → logged → state; crowned after a state; gameOver last, after a state; turnChanged after a state. */
function checkOrder(seq: string[]): void {
  const after: Record<string, string[]> = { acted: ['logged', 'state'], tide: ['logged', 'state'] };
  seq.forEach((n, k) => {
    const want = after[n];
    if (want) need(want.every((w, j) => seq[k + 1 + j] === w), () => `${n} followed by ${seq.slice(k + 1, k + 3).join(', ')} in ${seq.join(' ')}`);
    if (n === 'gameOver') need(seq[k - 1] === 'state' && k === seq.length - 1, () => `gameOver out of place: ${seq.join(' ')}`);
    if (n === 'turnChanged' || n === 'crowned') need(seq[k - 1] === 'state', () => `${n} not after state: ${seq.join(' ')}`);
  });
}
