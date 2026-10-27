/**
 * Cast demo: all 12 animals on a turntable, a button for every animation, a fight picker,
 * a skin picker, reduced motion and an FPS readout. Uses a plain lit floor (no world stream).
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EmoteKind, PieceKind, Side, SkinChoice } from '../contracts/types';
import { createCast, type Actor } from './index';

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

const cast = createCast({ squareSize: SQ, quality: isPhone ? 'low' : 'high' });
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
};
pieceSel.onchange = () => pick(pieceSel.value);

let spinning = true;
let busy = 0;
const spinBtn = $('spin');
spinBtn.onclick = () => { spinning = !spinning; spinBtn.setAttribute('aria-pressed', String(spinning)); };
const rmBtn = $('rm');
rmBtn.onclick = () => { cast.setReducedMotion(!cast.reducedMotion); rmBtn.setAttribute('aria-pressed', String(cast.reducedMotion)); };
$('skip').onclick = () => cast.skipAll();
$('reset').onclick = () => { table.rotation.y = 0; buildLineup(); pick(pieceSel.value); };
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
  buildLineup();
  pick('land-n');
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    frame(Math.min(timer.getDelta(), 1 / 20), timer.getElapsed());
  });
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
Object.assign(window as object, { cast, lineup, table, camera, controls });
