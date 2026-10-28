/**
 * Cast demo: all 12 animals on a turntable, a button for every animation, a fight picker,
 * a skin picker, reduced motion and an FPS readout. Uses a plain lit floor (no world stream).
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { POWER_OF, type EmoteKind, type MoveStyle, type PieceKind, type PowerKind, type Side, type SkinChoice } from '../contracts/types';
import { createCast, type Actor } from './index';
import { splash as fxSplash } from './fx';
import { TREASURE_COLORS } from './party';

const SQ = 1;
const SIDES: Side[] = ['land', 'sea'];
const KINDS: PieceKind[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- stage ----------

const app = $('app');
const isPhone = Math.min(innerWidth, innerHeight) < 600 || matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isPhone ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f4e9d8');
scene.fog = new THREE.Fog('#f4e9d8', 18, 40);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 100);
const camTarget = new THREE.Vector3(0, 0.45, 0.3);
const camBase = new THREE.Vector3(0, 5.6, 10.5);
function fitCamera() {
  const aspect = innerWidth / innerHeight;
  const k = aspect < 1 ? 1 + (1 - aspect) * 1.6 : 1;
  camera.position.copy(camTarget).add(camBase.clone().sub(camTarget).multiplyScalar(k));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
fitCamera();
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(camTarget);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.47;

const sun = new THREE.DirectionalLight('#fff0d8', 2.4);
sun.position.set(5, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(isPhone ? 1024 : 2048, isPhone ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun, new THREE.HemisphereLight('#d6ecff', '#e6cfa6', 0.9));

const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#ead9bd', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// The turntable: a wooden disc with a checker inlay. Pieces live on it.
const table = new THREE.Group();
table.position.y = 0.2;
scene.add(table);
const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.45, 0.2, 64), new THREE.MeshStandardMaterial({ color: '#c08a55', roughness: 0.7 }));
disc.position.y = -0.1;
disc.receiveShadow = disc.castShadow = true;
table.add(disc);
{
  const geo = new THREE.PlaneGeometry(SQ, SQ);
  const light = new THREE.MeshStandardMaterial({ color: '#f3e7cf', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#9cc98a', roughness: 0.85 });
  for (let x = -4; x < 4; x++) for (let z = -3; z < 4; z++) {
    if (Math.hypot(x + 0.5, z + 0.5) > 4.9) continue;
    const m = new THREE.Mesh(geo, (x + z) & 1 ? dark : light);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x + 0.5, 0.002, z + 0.5);
    m.receiveShadow = true;
    table.add(m);
  }
}

// ---------- cast ----------

// Quality: 'low' on phones; force with ?q=low or ?q=high.
const qParam = new URLSearchParams(location.search).get('q');
const quality = qParam === 'low' || qParam === 'high' ? qParam : isPhone ? 'low' : 'high';
const cast = createCast({ squareSize: SQ, quality });
const skins: Record<Side, SkinChoice> = { land: {}, sea: {} };
const lineup = new Map<string, Actor>();
const homes = new Map<string, THREE.Vector3>();
const keyOf = (side: Side, kind: PieceKind) => `${side}-${kind}`;
const homeOf = (side: Side, i: number) => new THREE.Vector3(i - 2.5, 0, side === 'land' ? 2.5 : -1.5);
let uid = 0;

function spawn(side: Side, kind: PieceKind, local: THREE.Vector3, yaw: number, pop = true): Actor {
  const a = cast.createPiece({ id: `${side}-${kind}-demo${uid++}`, side, kind, square: 'a1' }, skins[side]);
  a.object.position.copy(local);
  a.object.rotation.y = yaw;
  table.add(a.object);
  if (pop) {
    a.object.scale.setScalar(0.001);
    gsap.to(a.object.scale, { x: SQ, y: SQ, z: SQ, duration: 0.6, ease: 'elastic.out(1, 0.6)', delay: Math.random() * 0.25 });
  }
  return a;
}

function buildLineup() {
  for (const a of lineup.values()) a.dispose();
  lineup.clear();
  SIDES.forEach((side) => KINDS.forEach((kind, i) => {
    const home = homeOf(side, i);
    homes.set(keyOf(side, kind), home);
    lineup.set(keyOf(side, kind), spawn(side, kind, home, 0));
  }));
}

// ---------- UI ----------

const pieceSel = $<HTMLSelectElement>('piece');
const atkSel = $<HTMLSelectElement>('attacker');
const vicSel = $<HTMLSelectElement>('victim');
const log = $('log');
for (const sel of [pieceSel, atkSel, vicSel]) {
  for (const side of SIDES) {
    const g = document.createElement('optgroup');
    g.label = side === 'land' ? 'Land' : 'Sea';
    for (const kind of KINDS) {
      const o = document.createElement('option');
      o.value = keyOf(side, kind);
      o.textContent = cast.displayName(side, kind);
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
}
atkSel.value = 'land-n';
vicSel.value = 'sea-p';

for (const side of SIDES) {
  const s = cast.listSkins(side);
  const pal = $<HTMLSelectElement>(side + 'Pal');
  const acc = $<HTMLSelectElement>(side + 'Acc');
  s.palettes.forEach((p) => pal.add(new Option(p.name, p.id)));
  s.accessories.forEach((p) => acc.add(new Option(p.name, p.id)));
  const apply = () => {
    skins[side] = { palette: pal.value, accessory: acc.value === 'none' ? undefined : acc.value };
    for (const a of cast.actors) if (a.side === side) a.setSkin(skins[side]);
  };
  pal.onchange = apply;
  acc.onchange = apply;
}

let current: Actor | null = null;
const pick = (key: string) => {
  pieceSel.value = key;
  current = lineup.get(key) ?? null;
  if (stageActor && stageKey !== key) unstage();
};
pieceSel.onchange = () => pick(pieceSel.value);

let spinning = true;
let busy = 0;
const spinBtn = $('spin');
spinBtn.onclick = () => { spinning = !spinning; spinBtn.setAttribute('aria-pressed', String(spinning)); };
const rmBtn = $('rm');
rmBtn.onclick = () => { cast.setReducedMotion(!cast.reducedMotion); rmBtn.setAttribute('aria-pressed', String(cast.reducedMotion)); };
$('skip').onclick = () => cast.skipAll();
$('reset').onclick = () => { stopShowcase = true; unstage(); table.rotation.y = 0; buildLineup(); pick(pieceSel.value); };
const panel = $('panel');
/** On phones the panel is a bottom sheet: shift the view up so the pieces sit above it. */
function layout(refit = false) {
  const narrow = innerWidth <= 640;
  const cover = narrow ? panel.getBoundingClientRect().height : 0;
  renderer.setSize(innerWidth, innerHeight);
  if (refit) fitCamera();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (cover > 0) camera.setViewOffset(innerWidth, innerHeight, 0, cover * 0.5, innerWidth, innerHeight);
  else camera.clearViewOffset();
}
if (innerWidth <= 640) panel.classList.add('closed');
$('toggle').onclick = () => {
  panel.classList.toggle('closed');
  $('toggle').setAttribute('aria-expanded', String(!panel.classList.contains('closed')));
  layout();
};

/** Pause the turntable and ease it back to the front for actions. */
async function frontTable() {
  if (Math.abs(table.rotation.y) < 0.01) return;
  const y = Math.atan2(Math.sin(table.rotation.y), Math.cos(table.rotation.y));
  table.rotation.y = y;
  await gsap.to(table.rotation, { y: 0, duration: 0.4, ease: 'power2.inOut' });
}
async function action(fn: () => Promise<unknown> | void) {
  busy++;
  try {
    await frontTable();
    await fn();
  } finally {
    busy--;
  }
}
const world = (local: THREE.Vector3) => table.localToWorld(local.clone());

document.querySelectorAll<HTMLButtonElement>('#actions button').forEach((b) => {
  b.onclick = () => action(async () => {
    const a = current;
    if (!a) return;
    const p = a.object.position.clone();
    const home = homes.get(pieceSel.value)!;
    const t0 = performance.now();
    switch (b.dataset.a) {
      case 'select': a.setSelected(!a.selected); return;
      case 'move1': await a.moveTo(world(p.add(new THREE.Vector3(0, 0, 1)))); break;
      case 'move2': await a.moveTo(world(p.add(new THREE.Vector3(0, 0, 2)))); break;
      case 'moveL': await a.moveTo(world(p.add(new THREE.Vector3(1, 0, 2)))); break;
      case 'diag': await a.moveTo(world(p.add(new THREE.Vector3(1, 0, 1)))); break;
      case 'home': await a.moveTo(world(home)); break;
      case 'look': a.lookAt(camera.position); return;
      case 'celebrate': await a.celebrate(); break;
    }
    log.textContent = `${cast.displayName(a.side, a.kind)}: ${b.textContent} took ${((performance.now() - t0) / 1000).toFixed(2)}s`;
  });
});
document.querySelectorAll<HTMLButtonElement>('#emotes button').forEach((b) => {
  b.onclick = () => current?.emote(b.dataset.e as EmoteKind);
});

const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
async function fight(atkKey: string, vicKey: string) {
  const [as, ak] = atkKey.split('-') as [Side, PieceKind];
  const [vs, vk] = vicKey.split('-') as [Side, PieceKind];
  const from = new THREE.Vector3(-1.5, 0, 0.5);
  const to = new THREE.Vector3(1.5, 0, 0.5);
  const a = spawn(as, ak, from, Math.PI / 2);
  const v = spawn(vs, vk, to, -Math.PI / 2);
  await wait(0.7);
  v.emote('shock');
  a.lookAt(v.worldPos());
  await wait(0.5);
  const t0 = performance.now();
  await a.attack(v);
  const tImpact = performance.now() - t0;
  const gone = v.defeat(a).then(() => v.dispose());
  await a.moveTo(world(to));
  await gone;
  log.textContent = `${cast.displayName(as, ak)} vs ${cast.displayName(vs, vk)}: impact at ${(tImpact / 1000).toFixed(2)}s`;
  await wait(0.5);
  await gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, ease: 'back.in(2)' });
  a.dispose();
}
$('fight').onclick = () => action(() => fight(atkSel.value, vicSel.value));
$('fightAll').onclick = () => action(async () => {
  const [as] = atkSel.value.split('-') as [Side];
  const other: Side = as === 'land' ? 'sea' : 'land';
  for (const k of KINDS) await fight(atkSel.value, keyOf(other, k));
});

// ---------- Phase 3: powers, travel styles, statuses ----------

/** The middle row is empty: pieces play their powers there, at S. Table-local units (1 = a square). */
const S = new THREE.Vector3(0, 0, 0.5);
const off = (x: number, z: number) => S.clone().add(new THREE.Vector3(x, 0, z));
const POWER_NAME: Record<PowerKind, string> = { sidestep: 'Sidestep', doubleJump: 'Double jump', headbutt: 'Headbutt', stomp: 'Stomp', block: 'Block', escape: 'Escape' };
let stageActor: Actor | null = null;
let stageKey = '';
function unstage() {
  const a = stageActor;
  stageActor = null;
  stageKey = '';
  if (!a) return;
  gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)', onComplete: () => a.dispose() });
}
/** The copy of the picked animal in the middle row (made on first use). */
async function staged(): Promise<Actor> {
  const key = pieceSel.value;
  if (stageActor && stageKey === key) return stageActor;
  unstage();
  const [side, kind] = key.split('-') as [Side, PieceKind];
  stageActor = spawn(side, kind, S, 0);
  stageKey = key;
  await wait(0.6);
  return stageActor;
}
$('unstage').onclick = () => unstage();

/** A flat gold ring: the demo's stand-in for the world's vase / ink cloud on a blocked square. */
function marker(at: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffcc33', emissive: '#c08000', emissiveIntensity: 0.5 }));
  m.position.copy(at).setY(0.03);
  m.scale.setScalar(0.001);
  table.add(m);
  gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.3, ease: 'back.out(2)' });
  return () => gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, onComplete: () => { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
}

let powerT0 = 0;
let powerAt = -1;
cast.on('power', (p) => {
  powerAt = (performance.now() - powerT0) / 1000;
  if (p.power === 'stomp') shake = Math.max(shake, p.intensity * 0.1);
});

/** Play a piece's power the way integration will: flourish, then its travel or its effect on others. */
async function playPower(a: Actor) {
  const power = POWER_OF[a.kind];
  const enemy: Side = a.side === 'land' ? 'sea' : 'land';
  const name = `${cast.displayName(a.side, a.kind)} · ${POWER_NAME[power]}`;
  log.textContent = name;
  /** Start the flourish (and the "took effect" timer). */
  const fire = (t?: THREE.Vector3) => {
    powerAt = -1;
    powerT0 = performance.now();
    return a.powerUp(power, t);
  };
  const done = () => { log.textContent = `${name}: power took effect at ${powerAt.toFixed(2)}s`; };
  switch (power) {
    case 'sidestep': {
      const t = off(1, 0);
      await fire(world(t)); done();
      await a.moveTo(world(t), { style: 'sidestep' });
      await wait(0.5);
      await a.moveTo(world(S), { style: 'sidestep' });
      break;
    }
    case 'doubleJump': {
      const mid = off(2, 1), to = off(1, -1);
      await fire(world(mid)); done();
      await a.moveTo(world(mid), { style: 'jump' });
      await a.moveTo(world(to), { style: 'jump' });
      await wait(0.5);
      await a.moveTo(world(S));
      break;
    }
    case 'headbutt': {
      const vAt = off(1, 0);
      const v = spawn(enemy, 'p', vAt, -Math.PI / 2);
      await wait(0.7);
      await fire(world(vAt)); done();
      await a.attack(v);
      await Promise.all([a.moveTo(world(S)), v.hit(), v.moveTo(world(off(2, 0)), { style: 'pushed' })]);
      await wait(0.6);
      await gsap.to(v.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
      v.dispose();
      break;
    }
    case 'stomp': {
      const vs = [spawn(enemy, 'p', off(-1, 0), Math.PI / 2), spawn(enemy, 'p', off(1, 0), -Math.PI / 2)];
      await wait(0.7);
      await fire(); done();
      vs.forEach((v) => { void v.hit(); v.setStatus('stunned'); });
      await wait(1.8);
      vs.forEach((v) => v.setStatus(null));
      await wait(0.3);
      await Promise.all(vs.map((v) => gsap.to(v.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' })));
      vs.forEach((v) => v.dispose());
      break;
    }
    case 'block': {
      const t = off(-2, 0);
      const clear = marker(t);
      await fire(world(t)); done();
      await wait(1.0);
      clear();
      break;
    }
    case 'escape': {
      const t = off(2, -1);
      await fire(world(t)); done();
      await a.moveTo(world(t), { style: 'teleport' });
      await wait(0.5);
      await a.moveTo(world(S), { style: 'teleport' });
      break;
    }
  }
}

/** Where each travel style goes from the middle (then the piece walks back). Pieces face +z. */
const STYLE_TO: Record<Exclude<MoveStyle, 'normal'>, [number, number]> = {
  sidestep: [1, 0], jump: [2, 1], slip: [0, 1], pushed: [0, -1], teleport: [2, -1], dig: [0, -1], swept: [0, -1], quake: [1, 0], bonked: [0, -1], step: [0, 1],
};
document.querySelectorAll<HTMLButtonElement>('#styles button').forEach((b) => {
  b.onclick = () => action(async () => {
    const a = await staged();
    const style = b.dataset.s as Exclude<MoveStyle, 'normal'>;
    const [x, z] = STYLE_TO[style];
    const t0 = performance.now();
    await a.moveTo(world(off(x, z)), { style });
    log.textContent = `${cast.displayName(a.side, a.kind)}: ${b.textContent} took ${((performance.now() - t0) / 1000).toFixed(2)}s`;
    await wait(0.4);
    if (stageActor === a) await a.moveTo(world(S));
  });
});
document.querySelectorAll<HTMLButtonElement>('#p3 button').forEach((b) => {
  b.onclick = () => action(async () => {
    const a = await staged();
    const t0 = performance.now();
    switch (b.dataset.p) {
      case 'power': await playPower(a); return;
      case 'hit': await a.hit(); break;
      case 'appear': await a.appear(); break;
      case 'stunned': a.setStatus('stunned'); return;
      case 'frozen': a.setStatus('frozen'); return;
      case 'clear': a.setStatus(null); return;
    }
    log.textContent = `${cast.displayName(a.side, a.kind)}: ${b.textContent} took ${((performance.now() - t0) / 1000).toFixed(2)}s`;
  });
});

// ---------- Phase 4: party modes ----------

/** A flat blue square: the demo's stand-in for a sunk (water) square. */
function waterPatch(at: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4fb7d8', roughness: 0.15, transparent: true, opacity: 0.85 }));
  m.position.copy(at).setY(0.006);
  m.userData.noPick = true;
  table.add(m);
  return () => gsap.to(m.material, { opacity: 0, duration: 0.3, onComplete: () => { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); } });
}
/** Stand-in for `world.splash`: an expanding ripple ring plus droplets (integration uses the world's real splash). */
cast.on('splash', (p) => {
  const at = table.worldToLocal(p.at.clone());
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e8fbff', transparent: true, opacity: 0.9 }));
  ring.position.copy(at).setY(0.02);
  table.add(ring);
  const big = p.intensity >= 0.9 ? 1.6 : 1.1;
  gsap.to(ring.scale, { x: big * 1.6, z: big * 1.6, duration: 0.6, ease: 'power2.out' });
  gsap.to(ring.material, { opacity: 0, duration: 0.6, ease: 'power1.in', onComplete: () => { ring.removeFromParent(); ring.geometry.dispose(); ring.material.dispose(); } });
  fxSplash(table, at.setY(0.05), SQ, cast.reducedMotion ? 6 : 12);
  shake = Math.max(shake, p.intensity * 0.05);
});

/** Fall from the middle square toward `[x, z]` (table space), onto a stand-in water square. */
async function fallOnce(a: Actor, x: number, z: number) {
  const clear = waterPatch(S.clone().add(new THREE.Vector3(x, 0, z)));
  await wait(0.25);
  const t0 = performance.now();
  await a.fall(new THREE.Vector3(x, 0, z).normalize());
  log.textContent = `${cast.displayName(a.side, a.kind)}: fall took ${((performance.now() - t0) / 1000).toFixed(2)}s`;
  a.dispose();
  if (stageActor === a) { stageActor = null; stageKey = ''; }
  await wait(0.5);
  clear();
}
document.querySelectorAll<HTMLButtonElement>('#falls button').forEach((b) => {
  b.onclick = () => action(async () => {
    const f = b.dataset.f!;
    if (f === 'dig') {
      const a = await staged();
      a.setStatus(a.statusKind === 'anchored' ? null : 'anchored');
      log.textContent = `${cast.displayName(a.side, a.kind)}: ${a.statusKind === 'anchored' ? 'dug in (press again to climb out)' : 'climbed out'}`;
      return;
    }
    if (f === 'all') {
      unstage();
      const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      let i = 0;
      for (const side of SIDES) for (const kind of KINDS) {
        const a = spawn(side, kind, S, 0);
        await wait(0.6);
        const [x, z] = dirs[i++ % 4];
        await fallOnce(a, x, z);
      }
      return;
    }
    const [x, z] = f.split(',').map(Number);
    await fallOnce(await staged(), x, z);
  });
});
/**
 * Stand-in for `world.flyTreasure`: a plain ball (bone or pearl colour) arcs from one square to another.
 * The game's world flies the real treasure.
 */
function flyStandIn(owner: Side, from: THREE.Vector3, to: THREE.Vector3): Promise<void> {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: owner === 'land' ? TREASURE_COLORS.bone : TREASURE_COLORS.pearl, roughness: 0.4 }));
  m.castShadow = true;
  m.userData.noPick = true;
  table.add(m);
  const p = { t: 0 };
  const dist = from.distanceTo(to);
  const place = () => {
    m.position.lerpVectors(from, to, p.t);
    m.position.y = 0.55 + Math.sin(p.t * Math.PI) * (0.35 + dist * 0.25);
  };
  place();
  return new Promise((resolve) => {
    gsap.to(p, { t: 1, duration: 0.3 + dist * 0.12, ease: 'none', onUpdate: place, onComplete: () => {
      m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); resolve();
    } });
  });
}

/** Raid "pass and run", as integration plays it: toss, clear the thrower, fly the treasure, hand it to the catcher (the catch). */
async function tossOnce(a: Actor, catcher: Actor) {
  const owner: Side = a.side === 'land' ? 'sea' : 'land';
  if (a.carrying !== owner) { a.setCarrying(owner); await wait(0.6); }
  const t0 = performance.now();
  await a.toss(world(catcher.object.position));
  const t1 = performance.now();
  a.setCarrying(null);
  await flyStandIn(owner, a.object.position.clone(), catcher.object.position.clone());
  catcher.setCarrying(owner);
  log.textContent = `${cast.displayName(a.side, a.kind)}: toss released at ${((t1 - t0) / 1000).toFixed(2)}s`;
}

/** A teammate standing at `[x, z]` from the middle square, facing forward. */
function teammate(a: Actor, x: number, z: number): Actor {
  return spawn(a.side, a.kind === 'p' ? 'n' : 'p', off(x, z), 0);
}

document.querySelectorAll<HTMLButtonElement>('#carry button').forEach((b) => {
  b.onclick = () => action(async () => {
    const c = b.dataset.c!;
    if (c === 'toss' || c === 'tossall') {
      const one = c === 'toss';
      if (!one) unstage();
      const dirs: [number, number][] = [[2, 0], [0, -2], [-2, 0], [0, 2], [1, 0], [-1, 0]];
      const list = one ? [null] : SIDES.flatMap((side) => KINDS.map((kind) => [side, kind] as const));
      let i = 0;
      for (const sk of list) {
        const a = sk ? spawn(sk[0], sk[1], S, 0) : await staged();
        const [x, z] = dirs[i++ % dirs.length];
        const mate = teammate(a, x, z);
        if (!one) await wait(0.6);
        await tossOnce(a, mate);
        await wait(1.1);
        mate.setCarrying(null);
        await gsap.to(mate.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
        mate.dispose();
        if (!one) {
          await gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
          a.dispose();
        }
      }
      return;
    }
    if (c === 'all') {
      unstage();
      const row = SIDES.flatMap((side) => KINDS.map((kind) => [side, kind] as const));
      const extra = row.map(([side, kind], i) => {
        const a = spawn(side, kind, new THREE.Vector3((i % 6) - 2.5, 0, side === 'land' ? 1.5 : -0.5), 0);
        return a;
      });
      await wait(0.7);
      // Each side holds the other side's treasure (Land carries the pearl, Sea the bone).
      extra.forEach((a) => a.setCarrying(a.side === 'land' ? 'sea' : 'land'));
      log.textContent = 'Everyone holds the other side\'s treasure';
      await wait(3);
      await Promise.all(extra.map((a) => gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' })));
      extra.forEach((a) => a.dispose());
      return;
    }
    const a = await staged();
    if (c === 'walk') {
      const t0 = performance.now();
      await a.moveTo(world(off(0, 1)));
      const t1 = performance.now();
      await wait(0.3);
      await a.moveTo(world(S));
      log.textContent = `${cast.displayName(a.side, a.kind)}: one step took ${((t1 - t0) / 1000).toFixed(2)}s${a.carrying ? ' (carrying)' : ''}`;
      return;
    }
    a.setCarrying(c === 'none' ? null : (c as Side));
  });
});

let stopShowcase = false;
let showcasing = false;
const showBtn = $('showcase');
showBtn.onclick = () => {
  if (showcasing) { stopShowcase = true; showBtn.textContent = 'Stopping…'; return; }
  void action(async () => {
    showcasing = true;
    stopShowcase = false;
    showBtn.textContent = 'Stop showcase';
    unstage();
    try {
      for (const side of SIDES) for (const kind of KINDS) {
        if (stopShowcase) return;
        const a = spawn(side, kind, S, 0);
        await wait(0.6);
        await playPower(a);
        await wait(0.4);
        await gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
        a.dispose();
      }
    } finally {
      showcasing = false;
      showBtn.textContent = 'Power showcase';
    }
  });
};

// Picking and hover.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered: Actor | null = null;
function actorAt(e: PointerEvent): Actor | null {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const meshes = [...lineup.values()].map((a) => a.mesh);
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  return [...lineup.values()].find((a) => a.mesh === hit.object) ?? null;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const a = actorAt(e);
  if (a !== hovered) { hovered?.setHovered(false); a?.setHovered(true); hovered = a; }
});
let downAt = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  const a = actorAt(e);
  if (!a) return;
  for (const o of lineup.values()) if (o !== a) o.setSelected(false);
  a.setSelected(true);
  pick(keyOf(a.side, a.kind));
});

// Camera shake from stomps and impacts.
let shake = 0;
cast.on('stomp', (p) => (shake = Math.max(shake, p.intensity * 0.06)));
cast.on('impact', (p) => (shake = Math.max(shake, p.intensity * 0.12)));

// ---------- loop ----------

const fpsEl = $('fps');
let frames = 0, fpsT = 0;
const timer = new THREE.Timer();
const shakeOff = new THREE.Vector3();
addEventListener('resize', () => layout(true));
layout();

async function start() {
  await cast.preload(renderer, scene, camera);
  if (solo) {
    void soloLoop(solo);
  } else {
    buildLineup();
    pick('land-n');
  }
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    frame(Math.min(timer.getDelta(), 1 / 20), timer.getElapsed());
  });
}

// ---------- Solo mode (for the before/after compare page) ----------

/**
 * `?solo=land-r` plays one animal's power on a loop, close up, with no panel.
 * `&act=` plays something else instead: attack, hit, pushed, jump, bonked, fall, digin, toss, any travel style, or none.
 * `&look=clean|cartoon` (impact look), `&view=front|back`, `&rm=1` (reduced motion), `&label=` (caption), `&once=1` (no loop).
 */
const qs = new URLSearchParams(location.search);
const solo = qs.get('solo');
if (solo) {
  document.body.classList.add('solo');
  spinning = false;
  const look = qs.get('look');
  // Older builds of the cast have no setLook (the "before" copy): skip it there.
  if (look === 'clean' || look === 'cartoon') (cast as { setLook?: (l: string) => void }).setLook?.(look);
  if (qs.get('rm') === '1') cast.setReducedMotion(true);
  const back = qs.get('view') === 'back';
  camTarget.set(0, 0.55, 0.5);
  camBase.set(0, 3.3, back ? 0.5 - 5.9 : 0.5 + 5.9);
  fitCamera();
  controls.target.copy(camTarget);
  controls.update();
  const cap = document.createElement('div');
  cap.id = 'soloCap';
  cap.innerHTML = `<b></b><span></span>`;
  cap.querySelector('b')!.textContent = qs.get('label') ?? '';
  cap.querySelector('span')!.appendChild(log);
  document.body.appendChild(cap);
}

async function soloAct(a: Actor, act: string) {
  const enemy: Side = a.side === 'land' ? 'sea' : 'land';
  const t0 = performance.now();
  const took = (what: string) => { log.textContent = `${what} ${((performance.now() - t0) / 1000).toFixed(2)}s`; };
  switch (act) {
    case 'power': await playPower(a); return;
    case 'attack': {
      const vAt = off(1, 0);
      const v = spawn(enemy, 'p', vAt, -Math.PI / 2);
      await wait(0.6);
      await a.attack(v);
      took('impact at');
      const gone = v.defeat(a).then(() => v.dispose());
      await a.moveTo(world(vAt));
      await gone;
      await wait(0.3);
      await a.moveTo(world(S));
      return;
    }
    case 'hit': await a.hit(); took('hit'); return;
    case 'pushed': {
      void a.hit();
      await a.moveTo(world(off(1, 0)), { style: 'pushed' });
      took('pushed');
      await wait(0.5);
      await a.moveTo(world(S));
      return;
    }
    case 'jump': {
      await a.moveTo(world(off(2, 1)), { style: 'jump' });
      await a.moveTo(world(off(1, -1)), { style: 'jump' });
      took('two hops');
      await wait(0.4);
      await a.moveTo(world(S));
      return;
    }
    case 'bonked': {
      await a.hit();
      await a.moveTo(world(off(0, -1)), { style: 'bonked' });
      took('bonk + walk');
      await wait(0.3);
      await a.moveTo(world(S));
      return;
    }
    case 'fall': await fallOnce(a, 1, 0); return;
    case 'toss': {
      const mate = teammate(a, 1, 0);
      await wait(0.6);
      await tossOnce(a, mate);
      await wait(1);
      mate.setCarrying(null);
      await gsap.to(mate.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
      mate.dispose();
      return;
    }
    case 'digin': {
      await a.powerUp('sidestep');
      a.setStatus('anchored');
      took('dig in');
      await wait(1.4);
      a.setStatus(null);
      await wait(0.4);
      return;
    }
    default: {
      const style = act as Exclude<MoveStyle, 'normal'>;
      const [x, z] = STYLE_TO[style] ?? [1, 0];
      await a.moveTo(world(off(x, z)), { style });
      took(act);
      await wait(0.4);
      await a.moveTo(world(S));
    }
  }
}

async function soloLoop(key: string) {
  const [side, kind] = key.split('-') as [Side, PieceKind];
  const act = qs.get('act') ?? 'power';
  const once = qs.get('once') === '1';
  // `act=none`: an empty stage (for scripted checks from the console).
  if (act === 'none') return;
  for (;;) {
    const a = spawn(side, kind, S, 0);
    await wait(0.8);
    await soloAct(a, act);
    await wait(0.7);
    if (a.object.parent) await gsap.to(a.object.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(2)' });
    a.dispose();
    if (once) return;
    await wait(0.3);
  }
}

let simT = 0;
function frame(dt: number, t: number, draw = true) {
  simT = t;
  if (spinning && busy === 0 && ![...cast.actors].some((a) => a.isBusy)) table.rotation.y += dt * 0.18;
  for (const a of cast.actors) a.update(dt, t);
  camera.position.sub(shakeOff);
  controls.update();
  shake *= Math.pow(0.01, dt);
  shakeOff.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  camera.position.add(shakeOff);
  if (draw && renderer.domElement.width > 0 && renderer.domElement.height > 0) renderer.render(scene, camera);
  frames++;
  fpsT += dt;
  if (fpsT >= 0.5) {
    fpsEl.textContent = `${Math.round(frames / fpsT)} fps · ${renderer.info.render.calls} calls`;
    frames = 0;
    fpsT = 0;
  }
}

/**
 * Test hook: drive time by hand (for headless checks where requestAnimationFrame does not run).
 * `__manual()` stops the real loop; `__advance(seconds)` steps GSAP and the frame loop at 60fps
 * (drawing only the last frame unless `drawAll`) and returns the average CPU ms per frame.
 */
let gsapT = 0;
Object.assign(window as object, {
  __manual() {
    renderer.setAnimationLoop(null);
    gsap.ticker.remove(gsap.updateRoot);
    gsapT = gsap.ticker.time;
  },
  __advance(sec: number, fps = 60, drawAll = false) {
    const dt = 1 / fps;
    const t0 = performance.now();
    const n = Math.max(1, Math.round(sec * fps));
    for (let i = 0; i < n; i++) {
      gsapT += dt;
      gsap.updateRoot(gsapT);
      frame(dt, simT + dt, drawAll || i === n - 1);
    }
    return (performance.now() - t0) / n;
  },
});
start();

// Handy for poking at things from the console.
Object.assign(window as object, { cast, lineup, table, camera, controls, renderer });
