import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, sun } from '../shared/stage';
import { createBoard } from '../shared/board';
import { runDemo } from '../shared/demo';
import { mat } from '../shared/animals';
import { overlay } from '../shared/overlay';

overlay('c', "The animals are tiny and the board is a chocolate bar, set on a giant's dinner table between a steaming teacup, cake and cutlery. Candlelight, moody and cozy.");

const stage = createStage({
  cameraPos: [7.5, 6.6, 11], target: [0, 0.2, 0], exposure: 0.95, envIntensity: 0.25, fov: 40,
  bloom: { strength: 0.6, radius: 0.5, threshold: 0.9 }, vignette: 1.35, maxDistance: 34,
});
const { scene } = stage;
scene.background = new THREE.Color('#24160f');
scene.fog = new THREE.Fog('#2c1b12', 30, 85);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const shadowed = (o: THREE.Object3D) => o.traverse((m) => { if (m instanceof THREE.Mesh) m.castShadow = m.receiveShadow = true; });

// ---------- light: cool window + warm candle ----------
scene.add(sun('#a9c4ff', 1.1, [-10, 14, -14], 16, stage.isPhone ? 1024 : 2048));
scene.add(new THREE.HemisphereLight('#6a5a7a', '#3a2214', 0.45));

// ---------- room ----------
{
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(160, 60), mat('#3b2619'));
  wall.position.set(0, 18, -46);
  scene.add(wall);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), new THREE.MeshBasicMaterial({ color: '#6f8fd8' }));
  win.position.set(-16, 20, -45.9);
  scene.add(win);
  for (const [w, h, x, y] of [[0.8, 20, -16, 20], [16, 0.8, -16, 20], [17, 1.2, -16, 9.6], [17, 1.2, -16, 30.4], [1.2, 21.6, -24.2, 20], [1.2, 21.6, -7.8, 20]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.6), mat('#2a1a10'));
    bar.position.set(x, y, -45.6);
    scene.add(bar);
  }
  // Moon in the window.
  const moon = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), new THREE.MeshBasicMaterial({ color: '#fff3d0' }));
  moon.position.set(-12, 25, -45.8);
  scene.add(moon);
}

// ---------- table ----------
function woodTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#6e3f22';
  g.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += 2) {
    const n = Math.sin(y * 0.021) * 0.5 + Math.sin(y * 0.073 + 2) * 0.3 + Math.sin(y * 0.0037) * 0.6;
    const l = 22 + n * 7;
    g.fillStyle = `hsl(24, 52%, ${l}%)`;
    g.globalAlpha = 0.55;
    g.fillRect(0, y, 1024, 2);
  }
  g.globalAlpha = 0.18;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * 1024;
    g.strokeStyle = '#2a140a';
    g.lineWidth = Math.random() * 2 + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 8;
  return t;
}
const table = new THREE.Mesh(new THREE.BoxGeometry(80, 1.5, 56), new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.35 }));
table.position.y = -0.75;
table.receiveShadow = true;
scene.add(table);

// ---------- gold foil & wrapper under the chocolate ----------
{
  const foil = new THREE.PlaneGeometry(11, 11, 70, 70);
  foil.rotateX(-Math.PI / 2);
  const p = foil.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = 0.02 + Math.sin(x * 2.3 + z * 1.7) * 0.025 + Math.sin(x * 5.1 - z * 3.3) * 0.012 + Math.sin(x * 11.0 + z * 7.0) * 0.004;
    if (z < -4.6) y += (z + 4.6) ** 2 * 0.6;
    p.setY(i, y);
  }
  foil.computeVertexNormals();
  const f = new THREE.Mesh(foil, new THREE.MeshPhysicalMaterial({ color: '#b98d35', metalness: 1, roughness: 0.42, side: THREE.DoubleSide }));
  f.rotation.y = 0.06;
  f.receiveShadow = true;
  scene.add(f);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.03, 5), mat('#6b2a5b'));
  paper.position.set(0.6, 0.015, 6.9);
  paper.rotation.y = -0.12;
  paper.receiveShadow = true;
  scene.add(paper);
  const band = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.035, 0.5), mat('#e6b84a', 'gold'));
  band.position.set(0.6, 0.02, 6.2);
  band.rotation.y = -0.12;
  scene.add(band);
}

// ---------- teacup with magic stirring spoon & steam ----------
const porcelain = mat('#f7f4ee', 'gloss');
const blue = mat('#3b6fb6', 'gloss');
const cupG = new THREE.Group();
cupG.position.set(-12.5, 0, -7);
{
  const S = 2.1;
  const cup = [[0, 0.3], [1.5, 0.3], [1.8, 0.6], [2.3, 1.6], [2.6, 3.0], [2.7, 3.6], [2.6, 3.62], [2.45, 3.0], [2.15, 1.7], [1.6, 0.7], [0, 0.65]];
  const cm = new THREE.Mesh(new THREE.LatheGeometry(cup.map(([r, y]) => new THREE.Vector2(r * S, y * S)), 64), porcelain);
  const saucer = [[0, 0], [2.6, 0], [3.8, 0.25], [4.0, 0.42], [3.85, 0.45], [3.6, 0.3], [2.6, 0.22], [0, 0.2]];
  const sm = new THREE.Mesh(new THREE.LatheGeometry(saucer.map(([r, y]) => new THREE.Vector2(r * S, y * S)), 64), porcelain);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6 * S, 0.06 * S, 8, 80), blue);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 3.25 * S;
  const sRim = new THREE.Mesh(new THREE.TorusGeometry(3.7 * S, 0.04 * S, 8, 80), blue);
  sRim.rotation.x = Math.PI / 2;
  sRim.position.y = 0.36 * S;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.75 * S, 0.17 * S, 12, 32, Math.PI * 1.25), porcelain);
  handle.position.set(2.75 * S, 2.1 * S, 0);
  handle.rotation.z = -Math.PI * 0.62;
  const tea = new THREE.Mesh(new THREE.CircleGeometry(2.42 * S, 64), new THREE.MeshPhysicalMaterial({ color: '#7a3f1a', roughness: 0.05, clearcoat: 1 }));
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 3.0 * S;
  cupG.add(cm, sm, rim, sRim, handle, tea);
  shadowed(cupG);
  tea.castShadow = false;
  scene.add(cupG);
}
const spoon = new THREE.Group();
{
  const silver = new THREE.MeshPhysicalMaterial({ color: '#e8e8ee', metalness: 1, roughness: 0.18 });
  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 9, 4, 10), silver);
  stem.position.y = 4.5;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), silver);
  bowl.scale.set(1, 0.3, 1.45);
  stem.castShadow = bowl.castShadow = true;
  spoon.add(stem, bowl);
  spoon.position.set(2.2, 5.0, 0);
  spoon.rotation.z = 0.32;
  const pivot = new THREE.Group();
  pivot.position.set(-12.5, 1.3, -7);
  pivot.add(spoon);
  scene.add(pivot);
  stage.onFrame((_dt, t) => (pivot.rotation.y = t * 0.6));
}
// Steam sprites.
function softDot() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
const steamTex = softDot();
const steam: { s: THREE.Sprite; t: number; a: number }[] = [];
for (let i = 0; i < 26; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
  scene.add(s);
  steam.push({ s, t: i / 26, a: rnd(0, 6) });
}
stage.onFrame((dt, t) => {
  for (const p of steam) {
    p.t = (p.t + dt * 0.12) % 1;
    const h = p.t * 9;
    p.s.position.set(-12.5 + Math.sin(t * 0.8 + p.a + h * 0.5) * (0.6 + p.t * 1.6), 7.4 + h, -7 + Math.cos(t * 0.6 + p.a) * 0.8);
    p.s.scale.setScalar(1.4 + p.t * 3.5);
    p.s.material.opacity = Math.sin(p.t * Math.PI) * 0.16;
  }
});

// ---------- cutlery ----------
{
  const silver = new THREE.MeshPhysicalMaterial({ color: '#dfe1e8', metalness: 1, roughness: 0.2, clearcoat: 0.3 });
  const fork = new THREE.Group();
  const fh = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.3, 9, 3, 0.14), silver);
  fh.position.z = 4.5;
  const neck = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.25, 2.4, 3, 0.12), silver);
  neck.position.z = -0.9;
  fork.add(fh, neck);
  for (let i = 0; i < 4; i++) {
    const tine = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.2, 3.4, 2, 0.09), silver);
    tine.position.set(-0.55 + i * 0.37, 0, -3.6);
    fork.add(tine);
  }
  fork.position.set(9.8, 0.16, -1);
  fork.rotation.y = 0.08;
  const knife = new THREE.Group();
  const kh = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.45, 7.5, 3, 0.2), silver);
  kh.position.z = 4;
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.5, 0);
  bladeShape.lineTo(0.55, 0);
  bladeShape.quadraticCurveTo(0.7, -5, 0.05, -7.2);
  bladeShape.lineTo(-0.5, -6.6);
  bladeShape.lineTo(-0.5, 0);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }), silver);
  blade.rotation.x = -Math.PI / 2;
  blade.position.set(0, -0.12, 0.2);
  knife.add(kh, blade);
  knife.position.set(12.2, 0.2, -0.5);
  knife.rotation.y = -0.05;
  shadowed(fork);
  shadowed(knife);
  scene.add(fork, knife);
}

// ---------- cake on a plate ----------
{
  const g = new THREE.Group();
  const plateProf = [[0, 0], [4.5, 0], [6.5, 0.45], [6.8, 0.6], [6.6, 0.62], [4.4, 0.18], [0, 0.18]];
  const plate = new THREE.Mesh(new THREE.LatheGeometry(plateProf.map(([r, y]) => new THREE.Vector2(r, y)), 64), porcelain);
  const prim = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.05, 8, 80), blue);
  prim.rotation.x = Math.PI / 2;
  prim.position.y = 0.6;
  g.add(plate, prim);
  const wedge = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(5, -1.6), new THREE.Vector2(5, 1.6)]);
  const layers: [string, number][] = [['#f0cf92', 1.0], ['#fff3e6', 0.3], ['#d6334a', 0.15], ['#f0cf92', 1.0], ['#f7b6c8', 0.4]];
  let y = 0.2;
  for (const [col, h] of layers) {
    const l = new THREE.Mesh(new THREE.ExtrudeGeometry(wedge, { depth: h, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 }), mat(col));
    l.rotation.x = -Math.PI / 2;
    l.position.set(-2.4, y, 0);
    g.add(l);
    y += h;
  }
  const berry = new THREE.Mesh(new THREE.SphereGeometry(0.8, 20, 16), mat('#e2263f', 'gloss'));
  berry.scale.set(1, 1.25, 1);
  berry.position.set(1.2, y + 0.75, 0);
  g.add(berry);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 6), mat('#4f9a3a'));
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(1.2 + Math.cos(a) * 0.3, y + 1.75, Math.sin(a) * 0.3);
    leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    g.add(leaf);
  }
  for (let i = 0; i < 30; i++) {
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), mat('#f6e27a'));
    const a = rnd(0, Math.PI * 2), b = rnd(-0.9, 0.7);
    seed.position.set(1.2 + Math.cos(a) * Math.cos(b) * 0.8, y + 0.75 + Math.sin(b) * 1.0, Math.sin(a) * Math.cos(b) * 0.8);
    g.add(seed);
  }
  shadowed(g);
  g.position.set(11, 0, -11);
  g.rotation.y = 0.7;
  scene.add(g);
}

// ---------- candle ----------
const flame = new THREE.Group();
const candleLight = new THREE.PointLight('#ffad55', 70, 45, 1.4);
{
  const g = new THREE.Group();
  const brass = new THREE.MeshPhysicalMaterial({ color: '#c9973f', metalness: 1, roughness: 0.3 });
  const holderProf = [[0, 0], [2.0, 0], [2.1, 0.25], [1.2, 0.5], [0.45, 0.9], [0.4, 2.6], [0.9, 2.9], [0.9, 3.15], [0, 3.15]];
  g.add(new THREE.Mesh(new THREE.LatheGeometry(holderProf.map(([r, y]) => new THREE.Vector2(r, y)), 48), brass));
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.65, 6.5, 32), mat('#f5ead2'));
  wax.position.y = 3.15 + 3.25;
  g.add(wax);
  const drip = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.4, 4, 8), mat('#f5ead2'));
  drip.position.set(0.6, 8.6, 0.1);
  g.add(drip);
  shadowed(g);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35), mat('#2a1a10'));
  wick.position.y = 9.8;
  g.add(wick);
  const outer = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat('#ff9a2e', 'glow'));
  outer.scale.set(1, 2.3, 1);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat('#fff3c4', 'glow'));
  inner.scale.set(1, 2, 1);
  inner.position.y = -0.1;
  flame.add(outer, inner);
  flame.position.y = 10.35;
  g.add(flame);
  candleLight.position.y = 10.6;
  candleLight.castShadow = true;
  candleLight.shadow.mapSize.set(stage.isPhone ? 512 : 1024, stage.isPhone ? 512 : 1024);
  candleLight.shadow.bias = -0.002;
  g.add(candleLight);
  g.position.set(-10, 0, 5);
  scene.add(g);
}
stage.onFrame((_dt, t) => {
  const f = Math.sin(t * 9) * 0.06 + Math.sin(t * 23) * 0.04 + Math.sin(t * 4.3) * 0.05;
  flame.scale.set(1 - f * 0.5, 1 + f, 1 - f * 0.5);
  flame.rotation.z = Math.sin(t * 3.1) * 0.06;
  candleLight.intensity = 70 + f * 110;
});

// ---------- sugar cubes, crumbs, salt ----------
const sugar = mat('#fbfbf7');
for (const [x, y, z, ry] of [[-6.2, 0, 2.2, 0.3], [-6.6, 0, 3.2, 1.1], [-6.4, 0.8, 2.6, 0.7], [6.0, 0, -4.4, 0.2], [5.4, 0, 5.7, 0.9]]) {
  const c = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.8, 0.8, 2, 0.08), sugar);
  c.position.set(x, y + 0.4, z);
  c.rotation.y = ry;
  c.castShadow = c.receiveShadow = true;
  scene.add(c);
}
for (let i = 0; i < 46; i++) {
  const a = rnd(0, Math.PI * 2), r = rnd(5.2, 9);
  const cr = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.05, 0.16), 0), mat(i % 3 ? '#5a3220' : '#e8cf9e'));
  cr.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
  cr.rotation.set(rnd(0, 3), rnd(0, 3), 0);
  cr.castShadow = true;
  scene.add(cr);
}
{
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 4.2, 32), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.3, clearcoat: 1 }));
  glass.position.y = 2.1;
  const salt = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 2.4, 32), mat('#f4f4f4'));
  salt.position.y = 1.3;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.22, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#d8dbe2', metalness: 1, roughness: 0.25 }));
  cap.position.y = 4.2;
  cap.scale.y = 0.6;
  g.add(glass, salt, cap);
  shadowed(g);
  g.position.set(10.5, 0, 6.5);
  scene.add(g);
}

// ---------- the chocolate-bar board ----------
const board = createBoard({
  color: (_f, _r, light) => (light ? '#efe0c4' : '#6b3e26'),
  thickness: 0.24, gap: 0.06, bevel: 0.1, roughness: 0.35, clearcoat: 0.55,
  frame: { color: '#5a321e', width: 0.18, height: 0.2 },
});
board.group.position.y = 0.06;
scene.add(board.group);
runDemo({ board, stage });
stage.start();
