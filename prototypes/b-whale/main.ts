import * as THREE from 'three';
import gsap from 'gsap';
import { createStage, gradientSky, sun } from '../shared/stage';
import { createBoard } from '../shared/board';
import { runDemo } from '../shared/demo';
import { mat } from '../shared/animals';
import { overlay } from '../shared/overlay';

overlay('b', 'The board is strapped to the back of a gentle giant whale, swimming through a sea of clouds at dusk. Everything sways a little. Lanterns glow; the whale spouts now and then.');

const stage = createStage({
  cameraPos: [7, 7.5, 17.5], target: [-1.5, -0.6, 0], exposure: 1.0, envIntensity: 0.3,
  bloom: { strength: 0.6, radius: 0.55, threshold: 0.82 }, vignette: 1.15, maxDistance: 40, autoRotateSpeed: 0.3,
});
const { scene } = stage;
scene.add(gradientSky('#1b1a47', '#c2668f', '#ffb27a', 190, 0.02));
scene.fog = new THREE.Fog('#d98a9a', 30, 130);
scene.add(sun('#ffb59a', 2.1, [11, 7, -9], 8, stage.isPhone ? 1024 : 2048));
scene.add(new THREE.HemisphereLight('#7a78c8', '#ff9a8a', 1.05));

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const m4 = new THREE.Matrix4();

// ---------- stars & moon ----------
{
  const pts: number[] = [];
  while (pts.length < 900 * 3) {
    const v = new THREE.Vector3(rnd(-1, 1), rnd(0.18, 1), rnd(-1, 1)).normalize().multiplyScalar(170);
    pts.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.PointsMaterial({ color: '#fff4e0', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false });
  scene.add(new THREE.Points(g, m));
  stage.onFrame((_dt, t) => (m.opacity = 0.65 + Math.sin(t * 1.7) * 0.15));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 16), new THREE.MeshBasicMaterial({ color: '#fff1d6', fog: false }));
  moon.position.set(-55, 60, -140);
  scene.add(moon);
}

// ---------- the whale ----------
const whaleRoot = new THREE.Group();
scene.add(whaleRoot);

// The whale swims toward -X, side-on to the default camera, so its face is visible.
const whale = new THREE.Group();
whale.position.y = -3.75;
whale.rotation.y = Math.PI / 2;
whaleRoot.add(whale);
{
  const prof = [[0, -15], [0.6, -14], [1.4, -11], [2.6, -7], [3.8, -3], [4.6, 1], [4.9, 4], [4.7, 7], [4.0, 9.5], [2.8, 11.3], [1.2, 12.3], [0, 12.6]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  geo.scale(1.05, 0.78, 1);
  const top = new THREE.Color('#34508f'), belly = new THREE.Color('#e3eaf3');
  const pos = geo.attributes.position;
  const cols: number[] = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    tmp.copy(belly).lerp(top, THREE.MathUtils.smoothstep(y, -1.6, 0.8));
    cols.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.4 }));
  body.castShadow = body.receiveShadow = true;
  whale.add(body);

  // Belly grooves.
  for (let i = -3; i <= 3; i++) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.05, 6, 40, Math.PI * 0.5), mat('#c7d3e3'));
    groove.rotation.set(0, Math.PI / 2, Math.PI * 1.25);
    groove.position.set(i * 0.55, -0.4, -6);
    groove.scale.set(1, 0.75, 1.6);
    whale.add(groove);
  }
  // Eyes with a sleepy lid.
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 4.15, -0.7, -8.2);
    eye.rotation.y = s * 1.25;
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), mat('#fbfaf7', 'eye')));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), mat('#141018', 'pupil'));
    pupil.position.z = 0.25;
    pupil.scale.z = 0.5;
    eye.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#ffffff', 'glow'));
    glint.position.set(-0.1, 0.12, 0.42);
    eye.add(glint);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#34508f'));
    lid.rotation.x = 0.45;
    eye.add(lid);
    whale.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#f29aa6', transparent: true, opacity: 0.45, roughness: 0.8 }));
    cheek.position.set(s * 4.0, -1.5, -9.2);
    cheek.scale.set(0.3, 0.6, 1);
    whale.add(cheek);
  }
  // Barnacles.
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.08, 0.2), 10, 8), mat('#cfd8e6'));
    const z = rnd(-11, -5);
    b.position.set(rnd(-2.2, 2.2), 3.5 - Math.abs(z + 8) * 0.1, z);
    b.scale.y = 0.5;
    whale.add(b);
  }
}
// Pectoral fins.
const fins: THREE.Group[] = [];
for (const s of [-1, 1]) {
  const p = new THREE.Group();
  p.position.set(s * 4.4, -2.0, -3.5);
  const f = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat('#34508f'));
  f.scale.set(2.6, 0.2, 1.1);
  f.position.x = s * 2.2;
  f.rotation.y = s * 0.5;
  f.castShadow = true;
  p.add(f);
  p.userData.s = s;
  whale.add(p);
  fins.push(p);
}
// Tail flukes.
const tail = new THREE.Group();
tail.position.set(0, 0.2, 13.5);
for (const s of [-1, 1]) {
  const f = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat('#34508f'));
  f.scale.set(3.2, 0.22, 1.3);
  f.position.set(s * 2.4, 0, 1.4);
  f.rotation.y = -s * 0.45;
  f.castShadow = true;
  tail.add(f);
}
whale.add(tail);

// ---------- raft, ropes, lanterns, flag ----------
const deck = new THREE.Group();
whaleRoot.add(deck);
for (let i = 0; i < 11; i++) {
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.16, 10.8), mat(i % 2 ? '#9a6a43' : '#8a5c38'));
  plank.position.set(-5 + i, -0.02, 0);
  plank.rotation.z = rnd(-0.01, 0.01);
  plank.castShadow = plank.receiveShadow = true;
  deck.add(plank);
}
for (const z of [-4.8, 4.8]) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.22, 0.4), mat('#6e4a2c'));
  beam.position.set(0, -0.14, z);
  deck.add(beam);
}
const ropeMat = mat('#d8c7a0');
for (const s of [-1, 1]) for (const x of [-4.4, 0, 4.4]) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, 0.05, s * 5.3), new THREE.Vector3(x, -0.6, s * 5.75),
    new THREE.Vector3(x, -2.4, s * 5.35), new THREE.Vector3(x, -4.4, s * 4.2),
  ]);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06, 6), ropeMat);
  rope.castShadow = true;
  deck.add(rope);
}
const lanterns: THREE.PointLight[] = [];
for (const [x, z] of [[-5.2, -5.2], [5.2, -5.2], [-5.2, 5.2], [5.2, 5.2]]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 8), mat('#6e4a2c'));
  post.position.set(x, 0.75, z);
  post.castShadow = true;
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.36, 6, 1, true), new THREE.MeshPhysicalMaterial({ color: '#33373d', wireframe: true }));
  cage.position.set(x, 1.72, z);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat('#ffb766', 'glow'));
  glow.position.set(x, 1.72, z);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 6), mat('#33373d'));
  cap.position.set(x, 1.98, z);
  const light = new THREE.PointLight('#ffb766', 6, 7, 1.6);
  light.position.set(x, 1.72, z);
  lanterns.push(light);
  deck.add(post, cage, glow, cap, light);
}
// Pennant on a mast at the back.
const flagGeo = new THREE.PlaneGeometry(1.8, 0.6, 24, 4);
const flagBase = flagGeo.attributes.position.array.slice();
{
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8), mat('#6e4a2c'));
  mast.position.set(-5.6, 1.8, -5.6);
  mast.castShadow = true;
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshPhysicalMaterial({ color: '#7fe0d8', side: THREE.DoubleSide, roughness: 0.7 }));
  flag.position.set(-4.65, 3.25, -5.6);
  flag.castShadow = true;
  deck.add(mast, flag);
}

// ---------- spout ----------
const dropGeo = new THREE.SphereGeometry(0.12, 10, 8);
const dropMat = new THREE.MeshPhysicalMaterial({ color: '#dff4ff', transparent: true, opacity: 0.85, roughness: 0.1, emissive: '#7fb8ff', emissiveIntensity: 0.3 });
function spout() {
  const origin = new THREE.Vector3(-8.6, 0.0, 0);
  for (let i = 0; i < 46; i++) {
    const d = new THREE.Mesh(dropGeo, dropMat);
    d.position.copy(origin);
    whaleRoot.add(d);
    const a = rnd(0, Math.PI * 2), spread = rnd(0.2, 1.8);
    const peak = rnd(3.2, 5.2);
    const delay = rnd(0, 0.35);
    const tl = gsap.timeline({ delay, onComplete: () => d.removeFromParent() });
    tl.to(d.position, { y: peak, duration: 0.7, ease: 'power2.out' }, 0)
      .to(d.position, { x: origin.x + Math.cos(a) * spread * 1.6, z: origin.z + Math.sin(a) * spread * 1.6, duration: 1.5, ease: 'none' }, 0)
      .to(d.position, { y: -0.5, duration: 0.8, ease: 'power2.in' }, 0.7)
      .to(d.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.4 }, 1.1);
  }
}
setTimeout(spout, 2500);
setInterval(spout, 9000);

// ---------- cloud sea ----------
const CLUSTERS = stage.isPhone ? 46 : 80;
const PER = 11;
const cloudMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: '#fbe3ea', roughness: 1, emissive: '#6a3a64', emissiveIntensity: 0.25 }), CLUSTERS * PER);
const clusterPos: THREE.Vector3[] = [];
const puff: { off: THREE.Vector3; s: number }[] = [];
for (let c = 0; c < CLUSTERS; c++) {
  let z = rnd(-90, 60);
  if (Math.abs(z) < 7) z += Math.sign(z || 1) * 7;
  clusterPos.push(new THREE.Vector3(rnd(-150, 55), rnd(-9, -3.5), z));
  for (let k = 0; k < PER; k++) puff.push({ off: new THREE.Vector3(rnd(-4, 4), rnd(-0.6, 1.2), rnd(-2.5, 2.5)), s: rnd(1.2, 2.8) });
}
// A ring of puffs hugging the whale's waterline so it sits *in* the clouds.
cloudMesh.receiveShadow = true;
scene.add(cloudMesh);
const hug = new THREE.InstancedMesh(cloudMesh.geometry, cloudMesh.material, 70);
for (let i = 0; i < 70; i++) {
  const z = rnd(-14, 16);
  const s = i % 2 ? 1 : -1;
  m4.compose(new THREE.Vector3(s * rnd(3.8, 6.5), rnd(-2.6, -1.0), z), new THREE.Quaternion(), new THREE.Vector3().setScalar(rnd(1.4, 2.6)));
  hug.setMatrixAt(i, m4);
}
whale.add(hug);
const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function updateClouds(dt: number) {
  for (let c = 0; c < CLUSTERS; c++) {
    const p = clusterPos[c];
    p.x += dt * 3.2;
    if (p.x > 60) p.x -= 210;
    for (let k = 0; k < PER; k++) {
      const pf = puff[c * PER + k];
      tmpV.copy(p).add(pf.off);
      tmpS.setScalar(pf.s);
      m4.compose(tmpV, tmpQ, tmpS);
      cloudMesh.setMatrixAt(c * PER + k, m4);
    }
  }
  cloudMesh.instanceMatrix.needsUpdate = true;
}

// ---------- board & game ----------
const board = createBoard({
  color: (_f, _r, light) => (light ? '#f4ead8' : '#5b7fc2'),
  frame: { color: '#7a4b2f', width: 0.3, height: 0.3 },
});
board.group.position.y = 0.14;
deck.add(board.group);
runDemo({ board, stage, onMove: (side, kind) => { if (side === 'land' && kind === 'r') stage.shake(0.04); } });

stage.onFrame((dt, t) => {
  whaleRoot.position.y = Math.sin(t * 0.5) * 0.25;
  whaleRoot.rotation.z = Math.sin(t * 0.4) * 0.025;
  whaleRoot.rotation.x = Math.sin(t * 0.33) * 0.018;
  tail.rotation.x = Math.sin(t * 1.1) * 0.28;
  fins.forEach((f) => (f.rotation.z = f.userData.s * Math.sin(t * 1.1 + 0.6) * 0.18));
  lanterns.forEach((l, i) => (l.intensity = 5.5 + Math.sin(t * 7 + i * 2) * 0.4 + Math.sin(t * 13 + i) * 0.3));
  const arr = flagGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const x = flagBase[i] + 0.9;
    arr[i + 2] = Math.sin(x * 3.2 - t * 6) * 0.08 * x;
  }
  flagGeo.attributes.position.needsUpdate = true;
  flagGeo.computeVertexNormals();
  updateClouds(dt);
});
stage.start();
