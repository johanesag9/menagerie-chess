import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, gradientSky, sun } from '../shared/stage';
import { createBoard } from '../shared/board';
import { runDemo } from '../shared/demo';
import { mat } from '../shared/animals';
import { overlay } from '../shared/overlay';

overlay('a', 'A toy diorama at golden hour. The board straddles the shoreline: Land squares are meadow, Sea squares are sand and water. Tilt-shift makes it feel like a miniature set.');

const stage = createStage({
  cameraPos: [7.5, 8.5, 10.5], target: [0, 0, 0.3], exposure: 1.05, envIntensity: 0.45,
  tiltShift: 2.4, vignette: 1.0, maxDistance: 26,
});
const { scene } = stage;
scene.add(gradientSky('#7fb2ec', '#ffdcb6', '#f4ad86'));
scene.fog = new THREE.Fog('#ffdcb6', 34, 110);
scene.add(sun('#ffd29e', 2.7, [-9, 7.5, -5], 11, stage.isPhone ? 1024 : 2048));
scene.add(new THREE.HemisphereLight('#cfe3ff', '#f2c79b', 0.9));

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const shoreZ = (x: number) => 0.15 + 0.4 * Math.sin(x * 0.85) + 0.18 * Math.sin(x * 2.3 + 1);
const W = 17, D = 16;

// ---------- diorama base ----------
const base = new THREE.Mesh(new RoundedBoxGeometry(W + 0.5, 1.5, D + 0.5, 4, 0.25), mat('#7a4b2f'));
base.position.y = -0.75;
base.receiveShadow = true;
scene.add(base);
const sand = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, D), mat('#f1d9a6'));
sand.position.y = 0.03;
sand.receiveShadow = true;
scene.add(sand);

const grassShape = new THREE.Shape();
grassShape.moveTo(-W / 2, -D / 2);
grassShape.lineTo(W / 2, -D / 2);
for (let i = 0; i <= 80; i++) {
  const x = W / 2 - (i / 80) * W;
  grassShape.lineTo(x, -shoreZ(x));
}
const grass = new THREE.Mesh(new THREE.ExtrudeGeometry(grassShape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 }), mat('#8cc265'));
grass.rotation.x = -Math.PI / 2;
grass.receiveShadow = true;
scene.add(grass);

// ---------- water ----------
const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { t: { value: 0 }, deep: { value: new THREE.Color('#2b86b0') }, shallow: { value: new THREE.Color('#79dcd6') } },
  vertexShader: /* glsl */ `
    uniform float t; varying vec2 vUv; varying float vH;
    void main() {
      vUv = uv; vec3 p = position;
      float h = sin(p.x * 1.3 + t * 1.4) * 0.05 + sin(p.y * 2.1 - t * 1.9) * 0.04;
      p.z += h; vH = h;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float t; uniform vec3 deep; uniform vec3 shallow; varying vec2 vUv; varying float vH;
    void main() {
      float y = 1.0 - vUv.y; // 1 = shore edge (nearest the board)
      float edge = 0.86 + 0.05 * sin(vUv.x * 30.0 + t * 1.6) + 0.04 * sin(t * 0.9);
      if (y > edge + 0.06) discard;
      vec3 c = mix(deep, shallow, smoothstep(0.1, edge, y));
      float foam = smoothstep(edge - 0.035, edge, y);
      float lines = smoothstep(0.92, 1.0, sin(y * 60.0 - t * 2.5 + sin(vUv.x * 12.0) * 2.0)) * 0.25 * (1.0 - y);
      c = mix(c, vec3(1.0), max(foam, lines));
      c += vH * 1.5;
      gl_FragColor = vec4(c, 0.93);
      #include <colorspace_fragment>
    }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(W, 4.4, 140, 40), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.set(0, 0.1, -D / 2 + 2.2);
scene.add(water);
stage.onFrame((_dt, t) => (waterMat.uniforms.t.value = t));

// ---------- land props ----------
const onGrass = (x: number, z: number) => z > shoreZ(x) + 0.3 && !(Math.abs(x) < 5 && Math.abs(z) < 5);
const tuftGeo = new THREE.ConeGeometry(0.07, 0.3, 5);
const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshPhysicalMaterial({ roughness: 0.7 }), 260);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
let n = 0;
while (n < 260) {
  const x = rnd(-8.2, 8.2), z = rnd(-1, 7.7);
  if (!onGrass(x, z)) continue;
  q.setFromEuler(new THREE.Euler(rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)));
  m4.compose(new THREE.Vector3(x, 0.24, z), q, new THREE.Vector3(1, rnd(0.6, 1.4), 1));
  tufts.setMatrixAt(n, m4);
  tufts.setColorAt(n, c.set('#6fae4a').offsetHSL(rnd(-0.03, 0.03), 0, rnd(-0.08, 0.08)));
  n++;
}
tufts.castShadow = true;
scene.add(tufts);

const petals = ['#ff8fb1', '#ffd166', '#ffffff', '#c39bff'];
for (let i = 0; i < 46; i++) {
  const x = rnd(-8, 8), z = rnd(0, 7.6);
  if (!onGrass(x, z)) continue;
  const h = rnd(0.25, 0.45);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 5), mat('#5c9a3d'));
  stem.position.set(x, 0.18 + h / 2, z);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(petals[i % 4], 'gloss'));
  head.position.set(x, 0.18 + h, z);
  head.castShadow = true;
  scene.add(stem, head);
}

function tree(x: number, z: number, s: number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 10), mat('#8a5a3a'));
  trunk.position.y = 0.8;
  g.add(trunk);
  for (const [px, py, pz, r] of [[0, 2.0, 0, 0.95], [0.5, 1.7, 0.2, 0.7], [-0.45, 1.75, -0.1, 0.72], [0.1, 2.55, 0.1, 0.6]]) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat('#78b955'));
    leaf.position.set(px, py, pz);
    g.add(leaf);
  }
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  g.position.set(x, 0.15, z);
  g.scale.setScalar(s);
  scene.add(g);
  return g;
}
const trees = [tree(-6.8, 5.6, 1.15), tree(6.6, 6.4, 1.3), tree(-7.4, 2.4, 0.85), tree(7.3, 3.4, 0.8)];
stage.onFrame((_dt, t) => trees.forEach((tr, i) => (tr.rotation.z = Math.sin(t * 0.9 + i) * 0.02)));

// Picket fence along the back of the meadow.
for (let x = -8.1; x <= 8.1; x += 0.42) {
  const p = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.7, 0.06, 2, 0.03), mat('#fbf6ec'));
  p.position.set(x, 0.5, 7.7);
  p.castShadow = true;
  scene.add(p);
}
for (const y of [0.35, 0.65]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.07, 0.05), mat('#fbf6ec'));
  rail.position.set(0, y, 7.66);
  scene.add(rail);
}

// Dog house for the Land team.
{
  const g = new THREE.Group();
  const box = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.0, 1.2, 2, 0.06), mat('#e7c48a'));
  box.position.y = 0.5;
  const roofShape = new THREE.Shape([new THREE.Vector2(-0.85, 0), new THREE.Vector2(0.85, 0), new THREE.Vector2(0, 0.75)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 1.35, bevelEnabled: false }), mat('#d0423a'));
  roof.position.set(0, 1.0, -0.675);
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20, 0, Math.PI), mat('#3a2418'));
  door.position.set(0, 0.2, 0.61);
  const doorB = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), mat('#3a2418'));
  doorB.position.set(0, 0.1, 0.61);
  g.add(box, roof, door, doorB);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  g.position.set(6.3, 0.15, 1.6);
  g.rotation.y = -0.6;
  scene.add(g);
}

// ---------- sea props ----------
for (let i = 0; i < 9; i++) {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.25, 0.6), 0), mat('#a39b92'));
  const x = (i % 2 ? 1 : -1) * rnd(5.2, 8), z = rnd(-7.6, -1.2);
  r.position.set(x, 0.1, z);
  r.rotation.set(rnd(0, 3), rnd(0, 3), 0);
  r.scale.y = 0.65;
  r.castShadow = r.receiveShadow = true;
  scene.add(r);
}
const starShape = new THREE.Shape();
for (let i = 0; i <= 10; i++) {
  const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
  const rr = i % 2 ? 0.12 : 0.3;
  if (i === 0) starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  else starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
}
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3 });
for (const [x, z, col] of [[-5.6, -2.0, '#ff8a5b'], [5.4, -3.3, '#f26b8a'], [-7.6, -0.6, '#ffb347'], [6.9, -1.4, '#ff8a5b']] as const) {
  const s = new THREE.Mesh(starGeo, mat(col));
  s.rotation.set(-Math.PI / 2, 0, rnd(0, 6));
  s.position.set(x, 0.08, z);
  s.castShadow = true;
  scene.add(s);
}
// Beach umbrella.
{
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), mat('#fbf6ec'));
  pole.position.y = 1.2;
  g.add(pole);
  for (let i = 0; i < 8; i++) {
    const w = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 2, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4), new THREE.MeshPhysicalMaterial({ color: i % 2 ? '#fbf6ec' : '#f26b5a', roughness: 0.6, side: THREE.DoubleSide }));
    w.position.y = 2.35;
    w.castShadow = true;
    g.add(w);
  }
  g.position.set(-6.4, 0, -2.6);
  g.rotation.z = 0.12;
  scene.add(g);
}
// Sand castle for the Sea team.
{
  const g = new THREE.Group();
  const s = mat('#e5c58b');
  const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.7, 16), s);
  keep.position.y = 0.35;
  g.add(keep);
  for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.45], [0.6, 0.45]]) {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 12), s);
    tw.position.set(x, 0.3, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 12), s);
    top.position.set(x, 0.75, z);
    g.add(tw, top);
  }
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshPhysicalMaterial({ color: '#7fe0d8', side: THREE.DoubleSide }));
  flag.position.set(0.15, 1.05, 0);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5), mat('#6b4a2f'));
  stick.position.y = 0.95;
  g.add(flag, stick);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  g.position.set(6.2, 0.06, -3.4);
  scene.add(g);
}

// ---------- clouds ----------
const clouds: THREE.Group[] = [];
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.8, 1.5), 16, 12), mat('#ffffff'));
    s.position.set(k * 1.0 - 2.5, rnd(-0.2, 0.5), rnd(-0.5, 0.5));
    g.add(s);
  }
  g.position.set(rnd(-30, 30), rnd(9, 15), rnd(-35, -12));
  g.scale.set(1, 0.7, 0.8);
  clouds.push(g);
  scene.add(g);
}
stage.onFrame((dt) => clouds.forEach((g) => { g.position.x += dt * 0.6; if (g.position.x > 40) g.position.x = -40; }));

// ---------- board & game ----------
const board = createBoard({
  color: (_f, r, light) => (r < 4 ? (light ? '#f7efd9' : '#93c56f') : light ? '#f6e2b3' : '#4fb7c2'),
  frame: { color: '#c99a63', width: 0.35, height: 0.32 },
});
board.group.position.y = 0.2;
scene.add(board.group);
runDemo({ board, stage });
stage.start();
