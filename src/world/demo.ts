/**
 * World demo: the diorama with labelled stand-in tokens (not the real animals).
 * Uses chess.js only here, so every highlight shown is a real legal position.
 */
import * as THREE from 'three';
import { Chess, type Square as CSquare } from 'chess.js';
import type { PieceKind, Side, Square, SquareEffect, WeirdEventKind, WheelOutcome } from '../contracts/types';
import { ALL_SQUARES, squareIndex } from './coords';
import { createWorld, TIDE_TIMING, type ShorelineWorld } from './index';

const SAMPLE_FEN = 'r1bqkb1r/pppp1Bpp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4'; // Black king in check, captures available
const $ = (id: string) => document.getElementById(id)!;
const container = $('stage');
const logEl = $('log');
const log = (msg: string) => {
  const line = document.createElement('div');
  line.textContent = msg;
  logEl.prepend(line);
  while (logEl.children.length > 4) logEl.lastChild!.remove();
  console.info('[world-demo]', msg);
};

// ---------- stand-in tokens ----------
const TEAM = {
  land: { body: '#fbf3df', rim: '#d9a43a', text: '#7a5414' },
  sea: { body: '#1f5f6b', rim: '#6fe0d6', text: '#e8fffb' },
} as const;
const HEIGHT: Record<PieceKind, number> = { p: 0.42, n: 0.58, b: 0.62, r: 0.58, q: 0.78, k: 0.88 };
const NAME: Record<PieceKind, string> = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
const geo = {
  pedestal: new THREE.CylinderGeometry(0.36, 0.38, 0.08, 32),
  body: new THREE.CylinderGeometry(0.22, 0.27, 1, 24),
  cap: new THREE.SphereGeometry(0.22, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
};
const matCache = new Map<string, THREE.Material>();
const mat = (c: string) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, clearcoat: 0.6 }));
  return matCache.get(c)!;
};

function labelTexture(side: Side, kind: PieceKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = TEAM[side].body;
  g.beginPath();
  g.roundRect(4, 4, 120, 56, 18);
  g.fill();
  g.strokeStyle = TEAM[side].rim;
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = TEAM[side].text;
  g.font = '700 30px ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`${side === 'land' ? 'L' : 'S'}·${NAME[kind]}`, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeToken(side: Side, kind: PieceKind): THREE.Group {
  const g = new THREE.Group();
  g.name = `stand-in ${side} ${kind}`;
  const h = HEIGHT[kind];
  const ped = new THREE.Mesh(geo.pedestal, mat(TEAM[side].rim));
  ped.position.y = 0.04;
  const body = new THREE.Mesh(geo.body, mat(TEAM[side].body));
  body.scale.y = h;
  body.position.y = 0.08 + h / 2;
  const cap = new THREE.Mesh(geo.cap, mat(TEAM[side].body));
  cap.position.y = 0.08 + h;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(side, kind), depthTest: false }));
  label.scale.set(0.5, 0.25, 1);
  label.position.y = 0.08 + h + 0.4;
  label.renderOrder = 10;
  g.add(ped, body, cap, label);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

// ---------- state ----------
let world!: ShorelineWorld;
let chess = new Chess();
const tokens = new Map<Square, THREE.Group>();
let selected: Square | null = null;
let busy = false;
let lastMove: [Square, Square] | null = null;
const unsubs: (() => void)[] = [];

function kingSquare(color: 'w' | 'b'): Square | null {
  for (const row of chess.board()) for (const c of row) if (c && c.type === 'k' && c.color === color) return c.square as Square;
  return null;
}

function placeAll() {
  for (const t of tokens.values()) t.removeFromParent();
  tokens.clear();
  for (const row of chess.board()) {
    for (const c of row) {
      if (!c) continue;
      const t = makeToken(c.color === 'w' ? 'land' : 'sea', c.type as PieceKind);
      t.position.copy(world.squareToWorld(c.square as Square));
      world.pieceLayer.add(t);
      tokens.set(c.square as Square, t);
    }
  }
}

function refreshHighlights(extra: Partial<Parameters<ShorelineWorld['setHighlights']>[0]> = {}) {
  const moves = selected ? chess.moves({ square: selected as CSquare, verbose: true }) : [];
  world.setHighlights({
    selected,
    legal: moves.filter((m) => !m.captured).map((m) => m.to as Square),
    captures: moves.filter((m) => m.captured).map((m) => m.to as Square),
    lastMove,
    check: chess.inCheck() ? kingSquare(chess.turn()) : null,
    ...extra,
  });
}

/** Simple hop tween for the stand-ins (the cast stream does the real travel styles). */
function hop(obj: THREE.Object3D, to: THREE.Vector3, duration = 0.5): Promise<void> {
  const from = obj.position.clone();
  let t = 0;
  return new Promise((resolve) => {
    const off = world.onFrame((dt) => {
      t = Math.min(1, t + dt / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      obj.position.lerpVectors(from, to, e);
      obj.position.y = from.y + Math.sin(Math.PI * t) * 0.6;
      if (t >= 1) {
        off();
        resolve();
      }
    });
  });
}

function poof(obj: THREE.Object3D): Promise<void> {
  let t = 0;
  return new Promise((resolve) => {
    const off = world.onFrame((dt) => {
      t = Math.min(1, t + dt / 0.35);
      obj.scale.setScalar(1 - t);
      obj.position.y += dt * 3;
      if (t >= 1) {
        off();
        obj.removeFromParent();
        resolve();
      }
    });
  });
}

async function doMove(from: Square, to: Square) {
  const m = chess.move({ from, to, promotion: 'q' });
  if (!m) return;
  busy = true;
  selected = null;
  world.setHighlights({ selected: null, legal: [], captures: [] });
  const mover = tokens.get(from)!;
  tokens.delete(from);
  let victimSq: Square | null = m.captured ? (to as Square) : null;
  if (m.flags.includes('e')) victimSq = `${to[0]}${from[1]}` as Square;
  const victim = victimSq ? tokens.get(victimSq) : undefined;
  if (victimSq) tokens.delete(victimSq);
  const target = world.squareToWorld(to);
  const moves: Promise<void>[] = [hop(mover, target)];
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rank = from[1];
    const [rf, rt] = m.flags.includes('k') ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
    const rook = tokens.get(rf as Square)!;
    tokens.delete(rf as Square);
    tokens.set(rt as Square, rook);
    moves.push(hop(rook, world.squareToWorld(rt as Square), 0.6));
  }
  if (victim) {
    void world.focusOn(target, 1);
    await new Promise((r) => setTimeout(r, 300));
    world.shake(0.35);
    moves.push(poof(victim));
  }
  await Promise.all(moves);
  if (m.promotion) {
    mover.removeFromParent();
    const q = makeToken(m.color === 'w' ? 'land' : 'sea', 'q');
    q.position.copy(target);
    world.pieceLayer.add(q);
    tokens.set(to, q);
  } else tokens.set(to, mover);
  lastMove = [from, to];
  refreshHighlights();
  log(`${m.san}${chess.isGameOver() ? ' — game over' : ''}`);
  busy = false;
}

function onSquareClicked(sq: Square) {
  log(`clicked ${sq}`);
  if (busy) return;
  const piece = chess.get(sq as CSquare);
  if (selected) {
    const legal = chess.moves({ square: selected as CSquare, verbose: true }).some((m) => m.to === sq);
    if (legal) return void doMove(selected, sq);
  }
  selected = piece && piece.color === chess.turn() ? (selected === sq ? null : sq) : null;
  refreshHighlights();
}

// ---------- controls ----------
function button(parent: string, label: string, fn: (b: HTMLButtonElement) => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => fn(b));
  $(parent).appendChild(b);
  return b;
}

function firstMovable(): Square | null {
  const m = chess.moves({ verbose: true });
  return m.length ? (m[0].from as Square) : null;
}

button('hl', 'Selected', () => {
  selected = firstMovable();
  world.setHighlights({ selected, legal: [], captures: [] });
});
button('hl', 'Legal dots', () => {
  selected ??= firstMovable();
  refreshHighlights({ captures: [] });
});
button('hl', 'Captures', () => {
  const caps = chess.moves({ verbose: true }).filter((m) => m.captured);
  if (!caps.length) return log('No captures in this position. Try "Sample position".');
  selected = caps[0].from as Square;
  refreshHighlights();
});
button('hl', 'Last move', () => {
  const h = chess.history({ verbose: true }).at(-1);
  lastMove = h ? [h.from as Square, h.to as Square] : ['e2', 'e4'];
  if (!h) log('No move played yet: showing e2→e4 as an example.');
  world.setHighlights({ lastMove });
});
button('hl', 'Check', () => {
  if (!chess.inCheck()) return log('Not in check. Try "Sample position".');
  world.setHighlights({ check: kingSquare(chess.turn()) });
});
button('hl', 'Clear', () => {
  selected = null;
  lastMove = null;
  world.setHighlights({ selected: null, legal: [], captures: [], lastMove: null, check: null });
});
button('hl', 'Sample position', () => {
  chess = new Chess(SAMPLE_FEN);
  selected = 'e8';
  lastMove = ['c4', 'f7'];
  placeAll();
  refreshHighlights();
  log('Loaded: Bxf7+ (Sea king in check, can capture)');
});
button('hl', 'Reset game', () => {
  chess = new Chess();
  selected = null;
  lastMove = null;
  placeAll();
  refreshHighlights();
});

button('cam', 'Face Land', () => void world.faceSide('land'));
button('cam', 'Face Sea', () => void world.faceSide('sea'));
button('cam', 'Focus', () => void world.focusOn(world.squareToWorld(selected ?? 'e4'), 1));
button('cam', 'Shake small', () => world.shake(0.25));
button('cam', 'Shake big', () => world.shake(0.8));
button('cam', 'Replay intro', () => void world.playIntro());

const WEIRD: [WeirdEventKind, string][] = [
  ['tilt', 'Tilt'], ['fog', 'Fog'], ['gravityHop', 'Gravity hop'], ['pigeonPeek', 'Pigeon'], ['tideSwap', 'Tide'], ['disco', 'Disco'],
];
for (const [kind, label] of WEIRD) {
  button('weird', label, async () => {
    log(`weird: ${kind} started`);
    await world.playWeirdEvent({ kind, durationTurns: 1, squares: kind === 'pigeonPeek' ? [selected ?? 'e1'] : undefined });
    log(`weird: ${kind} finished`);
  });
}

// ---------- Phase 3: blocked squares, chaos, aiming ----------
const blocks = new Map<Square, SquareEffect>();
const emptySquares = () => ALL_SQUARES.filter((sq) => !chess.get(sq as CSquare) && !blocks.has(sq));
const showBlocks = () => world.setSquareEffects([...blocks.values()]);
function placeBlock(by: Side) {
  // Land likes the middle of the board, Sea the beach side, just so the demo spreads them out.
  const pool = emptySquares().filter((sq) => (by === 'land' ? +sq[1] <= 4 : +sq[1] >= 5));
  const list = pool.length ? pool : emptySquares();
  if (!list.length) return log('No empty square left.');
  const sq = list[Math.floor(Math.random() * list.length)];
  blocks.set(sq, { square: sq, effect: 'blocked', by, turnsLeft: 4 });
  showBlocks();
  log(`${by === 'land' ? 'Vase' : 'Ink cloud'} on ${sq} (4 turns)`);
}
button('blocks', 'Land vase', () => placeBlock('land'));
button('blocks', 'Sea ink', () => placeBlock('sea'));
button('blocks', 'Next turn (−1)', () => {
  for (const [sq, b] of blocks) {
    if (b.turnsLeft <= 1) blocks.delete(sq);
    else blocks.set(sq, { ...b, turnsLeft: b.turnsLeft - 1 });
  }
  showBlocks();
  log(`Blocks: ${[...blocks.values()].map((b) => `${b.square} ${b.turnsLeft}`).join(', ') || 'none'}`);
});
button('blocks', 'Clear blocks', () => {
  blocks.clear();
  showBlocks();
});

/** Demo of what integration does: Land tokens on the beach slide back one rank at the wave crest. */
async function tideDemo() {
  const swept: [Square, Square][] = [];
  // Closest to the meadow first, only onto an empty, unblocked square.
  for (let r = 5; r <= 8; r++) for (const f of 'abcdefgh') {
    const from = `${f}${r}` as Square, to = `${f}${r - 1}` as Square;
    const p = chess.get(from as CSquare);
    if (!p || p.color !== 'w' || chess.get(to as CSquare) || blocks.has(to)) continue;
    chess.remove(from as CSquare);
    chess.put(p, to as CSquare);
    swept.push([from, to]);
  }
  const reduced = world.reducedMotion;
  const crest = (reduced ? TIDE_TIMING.reduced : TIDE_TIMING.normal).crest;
  const done = world.playChaos('tide', { squares: swept.map(([from]) => from) });
  // A real game would use world time; the demo uses onFrame so it pauses with the world.
  let t = 0;
  const off = world.onFrame((dt) => {
    t += dt;
    if (t < crest) return;
    off();
    for (const [from, to] of swept) {
      const tok = tokens.get(from)!;
      tokens.delete(from);
      tokens.set(to, tok);
      void hop(tok, world.squareToWorld(to), 0.5);
    }
  });
  await done;
  off();
  log(swept.length ? `Tide swept ${swept.map(([a, b]) => `${a}→${b}`).join(', ')}` : 'Tide: no Land piece on the beach to sweep');
}

async function pigeonDemo() {
  const pawns = [...tokens.entries()].filter(([sq]) => chess.get(sq as CSquare)?.type === 'p');
  if (!pawns.length) {
    log('Pigeon: no pawns, it flies past');
    return world.playChaos('pigeon', {});
  }
  const [sq, tok] = pawns[Math.floor(Math.random() * pawns.length)];
  tokens.delete(sq);
  chess.remove(sq as CSquare);
  if (selected === sq) selected = null;
  log(`Pigeon steals the pawn on ${sq}`);
  await world.playChaos('pigeon', { squares: [sq], carry: tok });
  // The world detached it; disposing is the caller's job (integration disposes the actor).
  log(`Pigeon gone. Token still attached: ${tok.parent ? 'yes (bug)' : 'no'}`);
}

const CHAOS: [WheelOutcome | 'earthquakeRight', string][] = [
  ['tide', 'Tide'], ['pigeon', 'Pigeon steals'], ['earthquake', 'Quake ←'], ['earthquakeRight', 'Quake →'], ['disco', 'Disco'],
];
async function playChaosDemo(kind: WheelOutcome | 'earthquakeRight') {
  const t0 = performance.now();
  log(`chaos: ${kind} started`);
  if (kind === 'tide') await tideDemo();
  else if (kind === 'pigeon') await pigeonDemo();
  else if (kind === 'earthquake' || kind === 'earthquakeRight') await world.playChaos('earthquake', { direction: kind === 'earthquake' ? 'left' : 'right' });
  else await world.playChaos(kind);
  log(`chaos: ${kind} finished in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
}
for (const [kind, label] of CHAOS) button('chaos', label, () => void playChaosDemo(kind));

const near = (a: Square, b: Square, n: number) => {
  const p = squareIndex(a), q = squareIndex(b);
  return Math.max(Math.abs(p.file - q.file), Math.abs(p.rank - q.rank)) <= n && a !== b;
};
function kingOfTurn(): Square {
  return kingSquare(chess.turn()) ?? 'e1';
}
button('aim', 'Targets: escape', () => {
  const k = kingOfTurn();
  selected = k;
  world.setHighlights({ selected: k, legal: [], captures: [], targets: emptySquares().filter((sq) => near(k, sq, 2)), area: [] });
  log(`Escape targets around ${k}`);
});
button('aim', 'Targets: block', () => {
  selected = null;
  world.setHighlights({ selected: null, legal: [], captures: [], targets: emptySquares(), area: [] });
  log('Block targets: every empty square');
});
button('aim', 'Area: stomp', () => {
  const rook = (['a1', 'h1', 'a8', 'h8'] as Square[]).find((sq) => chess.get(sq as CSquare)?.type === 'r') ?? 'd4';
  selected = rook;
  world.setHighlights({ selected: rook, legal: [], captures: [], targets: [], area: ALL_SQUARES.filter((sq) => near(rook, sq, 1)) });
  log(`Stomp area around ${rook}`);
});
button('aim', 'Targets + area', () => {
  const sq: Square = 'd4';
  world.setHighlights({ selected: sq, legal: [], captures: [], targets: ['c5', 'e5', 'd6'], area: ['d5'] });
  log('Aiming a headbutt: violet = pick, wash = will be affected');
});
button('aim', 'Clear aim', () => {
  selected = null;
  world.setHighlights({ selected: null, targets: [], area: [] });
});

const qBtn = button('settings', 'Quality: …', () => {
  world.setQuality(world.quality === 'high' ? 'low' : 'high');
  qBtn.textContent = `Quality: ${world.quality}`;
});
let coords = true;
button('settings', 'Coordinates', (b) => {
  coords = !coords;
  world.setCoordinatesVisible(coords);
  b.classList.toggle('on', coords);
}).classList.add('on');
let reduced = false;
button('settings', 'Reduced motion', (b) => {
  reduced = !reduced;
  world.setReducedMotion(reduced ? true : null);
  b.classList.toggle('on', reduced);
});
let paused = false;
button('settings', 'Pause', (b) => {
  paused = !paused;
  world.setPaused(paused);
  b.classList.toggle('on', paused);
});
button('settings', 'Dispose + recreate', async () => {
  const q = world.quality;
  unsubs.splice(0).forEach((u) => u());
  world.dispose();
  log('world disposed');
  await boot(q);
  log('world recreated');
});

$('toggle').addEventListener('click', () => $('panel').classList.toggle('closed'));
if (innerWidth <= 700) $('panel').classList.add('closed');

// ---------- boot ----------
async function boot(quality?: ShorelineWorld['quality']) {
  const t0 = performance.now();
  world = await createWorld({ container, quality });
  (window as unknown as { world: ShorelineWorld }).world = world; // for poking in the console
  log(`createWorld ready in ${Math.round(performance.now() - t0)} ms (${world.quality})`);
  qBtn.textContent = `Quality: ${world.quality}`;
  world.setCoordinatesVisible(coords);
  if (reduced) world.setReducedMotion(true);
  placeAll();
  refreshHighlights();
  unsubs.push(world.on('squareClicked', ({ square }) => onSquareClicked(square)));
  unsubs.push(world.on('squareHovered', ({ square }) => {
    container.style.cursor = square ? 'pointer' : '';
  }));
}

// URL options for quick checks: ?quality=low|high &skipIntro &sample &weird=<kind> &face=sea &select=e2
const params = new URLSearchParams(location.search);
await boot((params.get('quality') as ShorelineWorld['quality'] | null) ?? undefined);
if (params.has('skipIntro')) world.skipIntro();
if (params.has('sample')) [...document.querySelectorAll('button')].find((b) => b.textContent === 'Sample position')!.click();
if (params.get('select')) onSquareClicked(params.get('select') as Square);
if (params.get('face') === 'sea') void world.faceSide('sea', false);
if (params.has('blocks')) {
  for (const [sq, by, n] of [['d5', 'sea', 4], ['f5', 'sea', 1], ['c4', 'land', 4], ['e4', 'land', 1]] as const) blocks.set(sq, { square: sq, effect: 'blocked', by, turnsLeft: n });
  showBlocks();
}
if (params.get('aim') === 'targets') [...document.querySelectorAll('button')].find((b) => b.textContent === 'Targets: escape')!.click();
if (params.get('aim') === 'area') [...document.querySelectorAll('button')].find((b) => b.textContent === 'Targets + area')!.click();
const autoChaos = params.get('chaos') as WheelOutcome | 'earthquakeRight' | null;
if (autoChaos) setTimeout(() => void playChaosDemo(autoChaos), 300);
const autoWeird = params.get('weird') as WeirdEventKind | null;
if (autoWeird) setTimeout(() => void world.playWeirdEvent({ kind: autoWeird, durationTurns: 1, squares: ['e1'] }), 300);
setInterval(() => {
  const s = world.stats;
  $('stats').textContent = `${s.fps} fps · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · pr ${s.pixelRatio} · ${s.quality}`;
}, 500);
