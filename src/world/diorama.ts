/**
 * The shoreline diorama around the board: a toy set on a wooden display base at golden hour.
 * Land side (+z): meadow, swaying grass, flowers, lollipop trees, picket fence, dog house.
 * Sea side (-z): sand, an animated water pool with foam, rocks, starfish, umbrella, sand castle.
 * Overhead: gradient sky with a sun glow, drifting clouds, a few looping seagulls.
 * Static props are merged per material to keep draw calls low.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASE_D, BASE_W, PALETTE } from './constants';
import { addWind, type Bin, type Materials, StaticBatch, type WindUniforms, rand, seeded } from './kit';
import type { QualityProfile } from './quality';

const MEADOW_Y = 0.18;
const SAND_Y = 0.08;
/** Water rest height: high enough that wave troughs never dip below the sand. */
export const WATER_Y = 0.2;
const HALF_W = BASE_W / 2 - 0.3;
const HALF_D = BASE_D / 2 - 0.3;
/** Wiggly shoreline across the diorama (z of the meadow edge for a given x). */
export const shoreZ = (x: number) => 0.15 + 0.4 * Math.sin(x * 0.85) + 0.18 * Math.sin(x * 2.3 + 1);
/** Keep props off the board and its frame. */
const offBoard = (x: number, z: number, m = 0.5) => !(Math.abs(x) < 4.45 + m && Math.abs(z) < 4.45 + m);

export interface Diorama {
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  wind: WindUniforms;
  /** Base light intensities, so effects can dim and restore them. */
  base: { sun: number; hemi: number; fill: number; env: number };
  update(dt: number, t: number): void;
  setQuality(p: QualityProfile): void;
}

export function createDiorama(bin: Bin, mats: Materials, profile: QualityProfile): Diorama {
  const root = new THREE.Group();
  root.name = 'diorama';
  const rnd = seeded(20261025);
  const r = (a: number, b: number) => rand(a, b, rnd);
  const highOnly: THREE.Object3D[] = [];
  const animated: ((dt: number, t: number) => void)[] = [];
  const wind: WindUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

  // ---------- light ----------
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.7);
  sun.position.set(-9, 7.5, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  Object.assign(sun.shadow.camera, { left: -11.5, right: 11.5, top: 11.5, bottom: -11.5, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 4;
  sun.shadow.camera.updateProjectionMatrix();
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.9);
  // A soft front fill so faces turned to the camera don't go muddy against the low sun.
  const fill = new THREE.DirectionalLight('#ffe8d2', 0.45);
  fill.position.set(6, 9, 11);
  root.add(hemi, fill);

  // ---------- sky ----------
  const sunDir = sun.position.clone().normalize();
  const skyMat = bin.add(new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      mid: { value: new THREE.Color(PALETTE.skyMid) },
      bottom: { value: new THREE.Color(PALETTE.skyBottom) },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color('#ffd9a0') },
      fogColor: { value: new THREE.Color(PALETTE.fog) },
      fogMix: { value: 0 },
      tint: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform vec3 fogColor; uniform float fogMix; uniform vec3 tint;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.75, h)) : mix(bottom, mid, smoothstep(-0.35, 0.12, h));
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6);
        c = mix(c, fogColor, fogMix) * tint;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const sky = new THREE.Mesh(bin.add(new THREE.SphereGeometry(180, 32, 16)), skyMat);
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  // ---------- display base ----------
  const ground = new StaticBatch(bin);
  const wood = mats.get(PALETTE.base, 'wood');
  ground.put(bin.add(new RoundedBoxGeometry(BASE_W, 1.4, BASE_D, 4, 0.22)), wood, [0, -0.7, 0]);
  ground.put(bin.add(new RoundedBoxGeometry(BASE_W + 0.6, 0.35, BASE_D + 0.6, 3, 0.12)), mats.get(PALETTE.baseTrim, 'wood'), [0, -1.32, 0]);
  // A low lip around the top, like a display tray.
  const lipH = 0.3;
  const lipX = bin.add(new RoundedBoxGeometry(BASE_W, lipH, 0.24, 2, 0.08));
  const lipZ = bin.add(new RoundedBoxGeometry(0.24, lipH, BASE_D, 2, 0.08));
  ground.put(lipX, wood, [0, lipH / 2, -BASE_D / 2 + 0.12]);
  ground.put(lipX, wood, [0, lipH / 2, BASE_D / 2 - 0.12]);
  ground.put(lipZ, wood, [-BASE_W / 2 + 0.12, lipH / 2, 0]);
  ground.put(lipZ, wood, [BASE_W / 2 - 0.12, lipH / 2, 0]);
  ground.put(bin.add(new THREE.BoxGeometry(BASE_W - 0.4, SAND_Y, BASE_D - 0.4)), mats.get(PALETTE.sand, 'matte'), [0, SAND_Y / 2, 0]);

  // Meadow: an extruded sheet from the shoreline to the back of the Land side.
  const meadowShape = new THREE.Shape();
  meadowShape.moveTo(-HALF_W, -HALF_D);
  meadowShape.lineTo(HALF_W, -HALF_D);
  for (let i = 0; i <= 90; i++) {
    const x = HALF_W - (i / 90) * HALF_W * 2;
    meadowShape.lineTo(x, -shoreZ(x));
  }
  const meadowGeo = bin.add(new THREE.ExtrudeGeometry(meadowShape, { depth: MEADOW_Y - 0.06, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 4 }));
  meadowGeo.rotateX(-Math.PI / 2);
  ground.put(meadowGeo, mats.get(PALETTE.grass, 'matte'), [0, 0.02, 0]);

  // ---------- meadow props ----------
  const props = new StaticBatch(bin);
  const propsHigh = new StaticBatch(bin);
  const onMeadow = (x: number, z: number, m = 0.5) =>
    z > shoreZ(x) + 0.35 && z < HALF_D - 0.35 && Math.abs(x) < HALF_W - 0.3 && offBoard(x, z, m);

  // Grass: tufts of curved blades, instanced, swaying in a shader.
  const tuftGeo = bin.add(makeTuft(rnd));
  const grassMat = bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  addWind(grassMat, wind, MEADOW_Y, 3.2);
  const tuftTotal = 1100;
  const tufts = new THREE.InstancedMesh(tuftGeo, grassMat, tuftTotal);
  tufts.name = 'grass';
  tufts.receiveShadow = true;
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    let n = 0, guard = 0;
    while (n < tuftTotal && guard++ < 40000) {
      const x = r(-HALF_W + 0.3, HALF_W - 0.3), z = r(-1, HALF_D - 0.3);
      if (!onMeadow(x, z, 0.12)) continue;
      // Thin out near the board so the frame edge stays clean.
      if (!offBoard(x, z, 0.5) && rnd() < 0.6) continue;
      q.setFromEuler(e.set(0, r(0, Math.PI * 2), 0));
      const s = r(0.7, 1.35);
      m4.compose(new THREE.Vector3(x, MEADOW_Y - 0.02, z), q, new THREE.Vector3(s, s * r(0.8, 1.3), s));
      tufts.setMatrixAt(n, m4);
      tufts.setColorAt(n, c.set(PALETTE.grassBlade).offsetHSL(r(-0.03, 0.03), r(-0.05, 0.05), r(-0.06, 0.06)));
      n++;
    }
    tufts.count = n;
  }
  const tuftsFull = tufts.count;
  root.add(tufts);

  // Flowers: instanced stems, petal heads and centres, swaying with the grass.
  const flowerTotal = 120;
  const stemGeo = bin.add(new THREE.CylinderGeometry(0.012, 0.016, 1, 5).translate(0, 0.5, 0));
  const headGeo = bin.add(makeFlowerHead());
  const centreGeo = bin.add(new THREE.SphereGeometry(0.035, 8, 6).scale(1, 0.6, 1));
  const stemMat = bin.add(new THREE.MeshStandardMaterial({ color: '#5c9a3d', roughness: 0.8 }));
  const headMat = bin.add(new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, side: THREE.DoubleSide }));
  const centreMat = bin.add(new THREE.MeshStandardMaterial({ color: '#ffcf3f', roughness: 0.6 }));
  for (const m of [stemMat, headMat, centreMat]) addWind(m, wind, MEADOW_Y, 3.2);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, flowerTotal);
  const heads = new THREE.InstancedMesh(headGeo, headMat, flowerTotal);
  const centres = new THREE.InstancedMesh(centreGeo, centreMat, flowerTotal);
  heads.castShadow = true;
  {
    const petals = ['#ff8fb1', '#ffd166', '#ffffff', '#c39bff', '#ff9f6b'];
    const m4 = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0, guard = 0;
    while (n < flowerTotal && guard++ < 20000) {
      // Flowers grow in little clumps.
      const cx = r(-HALF_W + 0.6, HALF_W - 0.6), cz = r(0.5, HALF_D - 0.6);
      const clump = 1 + Math.floor(rnd() * 4);
      const color = petals[Math.floor(rnd() * petals.length)];
      for (let k = 0; k < clump && n < flowerTotal; k++) {
        const x = cx + r(-0.35, 0.35), z = cz + r(-0.35, 0.35);
        if (!onMeadow(x, z, 0.3)) continue;
        const h = r(0.22, 0.42);
        m4.compose(new THREE.Vector3(x, MEADOW_Y - 0.02, z), q.identity(), new THREE.Vector3(1, h, 1));
        stems.setMatrixAt(n, m4);
        q.setFromEuler(e.set(r(-0.4, 0.4), r(0, 6), r(-0.4, 0.4)));
        const s = r(0.8, 1.2);
        m4.compose(new THREE.Vector3(x, MEADOW_Y - 0.02 + h, z), q, new THREE.Vector3(s, s, s));
        heads.setMatrixAt(n, m4);
        centres.setMatrixAt(n, m4);
        heads.setColorAt(n, c.set(color).offsetHSL(0, 0, r(-0.05, 0.05)));
        n++;
      }
    }
    stems.count = heads.count = centres.count = n;
  }
  const flowersFull = stems.count;
  root.add(stems, heads, centres);

  // Lollipop trees, each swaying gently on its own.
  const trunkGeo = bin.add(new THREE.CylinderGeometry(0.11, 0.17, 1.5, 10).translate(0, 0.75, 0));
  const canopyGeo = bin.add(new THREE.SphereGeometry(1, 28, 20));
  const greens = ['#78b955', '#8cc865', '#6aa94a'];
  const trees: { g: THREE.Group; phase: number }[] = [];
  const tree = (x: number, z: number, s: number, i: number, high: boolean) => {
    const g = new THREE.Group();
    const batch = new StaticBatch(bin);
    batch.put(trunkGeo, mats.get('#8a5a3a', 'wood'), [0, 0, 0]);
    const leaf = mats.get(greens[i % greens.length], 'gloss');
    batch.put(canopyGeo, leaf, [0, 2.05, 0], [0, 0, 0], [0.95, 0.88, 0.95]);
    batch.put(canopyGeo, mats.get('#9fd472', 'gloss'), [0.18, 2.42, 0.22], [0, 0, 0], 0.42);
    g.add(batch.build('tree'));
    g.position.set(x, MEADOW_Y - 0.02, z);
    g.scale.setScalar(s);
    root.add(g);
    trees.push({ g, phase: i * 1.7 });
    if (high) highOnly.push(g);
  };
  tree(-6.9, 5.5, 1.1, 0, false);
  tree(6.9, 6.4, 1.25, 1, false);
  tree(-7.7, 2.3, 0.82, 2, false);
  tree(7.6, 3.1, 0.78, 3, true);
  tree(-3.6, 7.4, 0.7, 4, true);
  animated.push((_dt, t) => {
    for (const { g, phase } of trees) {
      g.rotation.z = Math.sin(t * 0.9 + phase) * 0.025 * wind.uWind.value;
      g.rotation.x = Math.sin(t * 0.7 + phase * 1.3) * 0.015 * wind.uWind.value;
    }
  });

  // Bushes along the fence.
  const bushGeo = bin.add(new THREE.IcosahedronGeometry(0.4, 2));
  for (const [bx, bz, bs] of [[-5.2, 7.6, 1], [4.6, 7.5, 1.15], [-8.2, 4.2, 0.9], [8.1, 5.0, 0.85], [2.3, 7.6, 0.7]] as const) {
    for (let k = 0; k < 4; k++) {
      propsHigh.put(bushGeo, mats.get(greens[k % 3], 'toy'), [bx + r(-0.35, 0.35) * bs, MEADOW_Y + 0.15 * bs + r(0, 0.12), bz + r(-0.15, 0.15)], [r(0, 3), r(0, 3), 0], bs * r(0.65, 1));
    }
  }

  // Picket fence along the back, with a gate gap in the middle.
  const picketGeo = bin.add(makePicket());
  const white = mats.get('#fbf6ec', 'toy');
  const fenceZ = HALF_D - 0.25;
  for (let x = -HALF_W + 0.2; x <= HALF_W - 0.2; x += 0.42) {
    if (Math.abs(x) < 0.55) continue;
    props.put(picketGeo, white, [x, MEADOW_Y - 0.02, fenceZ], [0, 0, r(-0.04, 0.04)]);
  }
  const railGeo = bin.add(new THREE.BoxGeometry(1, 0.07, 0.05));
  for (const y of [0.36, 0.62]) {
    for (const side of [-1, 1]) {
      const len = HALF_W - 0.75;
      props.put(railGeo, white, [side * (0.75 + len / 2), MEADOW_Y + y, fenceZ - 0.05], [0, 0, 0], [len, 1, 1]);
    }
  }

  // Dog house (Land's home) with a bowl and a bone.
  {
    const g = new THREE.Group();
    const box = new THREE.Mesh(bin.add(new RoundedBoxGeometry(1.4, 1.0, 1.2, 2, 0.06)), mats.get('#e7c48a', 'wood'));
    box.position.y = 0.5;
    const roofShape = new THREE.Shape([new THREE.Vector2(-0.88, 0), new THREE.Vector2(0.88, 0), new THREE.Vector2(0, 0.78)]);
    const roof = new THREE.Mesh(bin.add(new THREE.ExtrudeGeometry(roofShape, { depth: 1.38, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 })), mats.get('#d0423a', 'gloss'));
    roof.position.set(0, 0.98, -0.69);
    const door = new THREE.Mesh(bin.add(new THREE.CircleGeometry(0.3, 20, 0, Math.PI)), mats.get('#3a2418', 'matte'));
    door.position.set(0, 0.2, 0.605);
    const doorB = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(0.6, 0.2)), mats.get('#3a2418', 'matte'));
    doorB.position.set(0, 0.1, 0.605);
    const plate = new THREE.Mesh(bin.add(new RoundedBoxGeometry(0.5, 0.16, 0.04, 2, 0.02)), mats.get('#ffd166', 'gloss'));
    plate.position.set(0, 0.72, 0.61);
    g.add(box, roof, door, doorB, plate);
    g.position.set(6.3, MEADOW_Y - 0.02, 1.75);
    g.rotation.y = -0.6;
    props.addObject(g);

    const bowl = new THREE.Group();
    const b = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.22, 0.17, 0.12, 20)), mats.get('#4f8fd8', 'gloss'));
    b.position.y = 0.06;
    const food = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 20)), mats.get('#9a5b33', 'matte'));
    food.position.y = 0.11;
    bowl.add(b, food);
    bowl.position.set(5.2, MEADOW_Y - 0.02, 2.55);
    propsHigh.addObject(bowl);

    const bone = new THREE.Group();
    const shaft = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8)), mats.get('#fff6e0', 'toy'));
    shaft.rotation.z = Math.PI / 2;
    bone.add(shaft);
    const knob = bin.add(new THREE.SphereGeometry(0.05, 10, 8));
    for (const sx of [-0.17, 0.17]) for (const sz of [-0.035, 0.035]) {
      const k = new THREE.Mesh(knob, mats.get('#fff6e0', 'toy'));
      k.position.set(sx, 0, sz);
      bone.add(k);
    }
    bone.position.set(5.6, MEADOW_Y + 0.04, 3.1);
    bone.rotation.y = 0.7;
    propsHigh.addObject(bone);
  }

  // Stepping-stone path from the gate to the board.
  const stoneGeo = bin.add(new THREE.CylinderGeometry(0.26, 0.28, 0.06, 14));
  for (let i = 0; i < 5; i++) {
    const z = 5.25 + i * 0.6;
    propsHigh.put(stoneGeo, mats.get(i % 2 ? '#d8cfc4' : '#cbbfb1', 'matte'), [Math.sin(i * 1.2) * 0.25, MEADOW_Y + 0.01, z], [0, r(0, 3), 0], [r(0.85, 1.1), 1, r(0.85, 1.1)]);
  }

  // A pinwheel that spins with the wind.
  {
    const stick = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6).translate(0, 0.5, 0)), mats.get('#fbf6ec', 'toy'));
    stick.position.set(-5.4, MEADOW_Y - 0.02, 6.6);
    propsHigh.addObject(stick);
    const wheel = new THREE.Group();
    const bladeGeo = bin.add(new THREE.ConeGeometry(0.16, 0.34, 3, 1).rotateZ(Math.PI / 2).translate(0.17, 0, 0).scale(1, 1, 0.25));
    ['#ff6b8a', '#ffd166', '#5ec8e5', '#8ad46a'].forEach((col, i) => {
      const bl = new THREE.Mesh(bladeGeo, mats.get(col, 'gloss'));
      bl.rotation.z = (i * Math.PI) / 2;
      wheel.add(bl);
    });
    const pin = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.04, 8, 6)), mats.get('#ffffff', 'gloss'));
    wheel.add(pin);
    const merged = new StaticBatch(bin);
    merged.addObject(wheel);
    const spinner = merged.build('pinwheel');
    spinner.position.set(-5.4, MEADOW_Y + 1.0, 6.65);
    spinner.rotation.y = 0.5;
    root.add(spinner);
    highOnly.push(spinner);
    let spin = 0;
    animated.push((dt, t) => {
      spin += dt * (2.5 + Math.sin(t * 0.8) * 1.5) * wind.uWind.value;
      spinner.children.forEach((c) => (c.rotation.z = -spin));
    });
  }

  // ---------- beach props ----------
  const rockGeo = bin.add(new THREE.DodecahedronGeometry(1, 1));
  const rockCols = ['#a39b92', '#b6ab9d', '#8f877f'];
  const rockSpots: [number, number, number][] = [
    [-7.7, -1.4, 0.55], [-6.9, -0.9, 0.3], [7.4, -1.9, 0.6], [8.0, -2.6, 0.35], [-5.4, -4.3, 0.42],
    [5.3, -4.5, 0.5], [-8.0, -5.0, 0.62], [7.8, -5.6, 0.48], [-2.5, -7.4, 0.36], [3.6, -7.6, 0.4],
  ];
  rockSpots.forEach(([x, z, s], i) => {
    const batch = i < 6 ? props : propsHigh;
    batch.put(rockGeo, mats.get(rockCols[i % 3], 'toy'), [x, SAND_Y + s * 0.2, z], [r(0, 3), r(0, 3), r(0, 3)], [s, s * 0.6, s * r(0.8, 1.1)]);
  });

  const starGeo = bin.add(makeStar());
  for (const [x, z, col, high] of [[-5.7, -2.1, '#ff8a5b', false], [5.2, -3.0, '#f26b8a', false], [-7.6, -3.2, '#ffb347', true], [7.0, -0.9, '#ff8a5b', true], [-2.2, -5.2, '#f26b8a', true]] as const) {
    (high ? propsHigh : props).put(starGeo, mats.get(col, 'gloss'), [x, SAND_Y + 0.01, z], [-Math.PI / 2, 0, r(0, 6)]);
  }

  // Shells.
  const shellGeo = bin.add(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1.2));
  for (let i = 0; i < 9; i++) {
    let x = 0, z = 0;
    do { x = r(-8, 8); z = r(-4.2, -0.4); } while (!offBoard(x, z, 0.4) || z > shoreZ(x) - 0.3);
    propsHigh.put(shellGeo, mats.get(['#ffd6e0', '#fff1d6', '#ffc8a8'][i % 3], 'gloss'), [x, SAND_Y, z], [0, r(0, 6), 0], r(0.7, 1.2));
  }

  // Beach umbrella with a striped towel underneath.
  const umbrella = new THREE.Group();
  {
    const pole = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8)), mats.get('#fbf6ec', 'toy'));
    pole.position.y = 1.2;
    const wedge = (i: number) => {
      const w = new THREE.Mesh(bin.add(new THREE.ConeGeometry(1.3, 0.45, 3, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4)), i % 2 ? clothMat('#fbf6ec') : clothMat('#f26b5a'));
      w.position.y = 2.35;
      return w;
    };
    const canopy = new StaticBatch(bin);
    const tmp = new THREE.Group();
    for (let i = 0; i < 8; i++) tmp.add(wedge(i));
    tmp.add(pole);
    const knob = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.07, 10, 8)), mats.get('#f26b5a', 'gloss'));
    knob.position.y = 2.6;
    tmp.add(knob);
    canopy.addObject(tmp);
    umbrella.add(canopy.build('umbrella'));
    umbrella.position.set(-6.4, SAND_Y, -2.7);
    umbrella.rotation.z = 0.12;
    root.add(umbrella);
    animated.push((_dt, t) => (umbrella.rotation.x = Math.sin(t * 1.1) * 0.012 * wind.uWind.value));

    const stripe = bin.add(new THREE.BoxGeometry(0.3, 0.02, 1.6));
    ['#5ec8e5', '#fbf6ec', '#5ec8e5', '#fbf6ec', '#5ec8e5'].forEach((col, i) => {
      propsHigh.put(stripe, mats.get(col, 'matte'), [-6.0 + (i - 2) * 0.3, SAND_Y + 0.01, -2.4], [0, 0.35, 0]);
    });
  }
  function clothMat(color: string) {
    return mats.get(color, 'toy');
  }

  // Sand castle (Sea's home) with a waving flag.
  const castle = new THREE.Group();
  {
    const s = mats.get('#e5c58b', 'matte');
    const tmp = new THREE.Group();
    const keep = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.42, 0.52, 0.72, 18)), s);
    keep.position.y = 0.36;
    tmp.add(keep);
    const towerGeo = bin.add(new THREE.CylinderGeometry(0.18, 0.23, 0.6, 14));
    const capGeo = bin.add(new THREE.ConeGeometry(0.23, 0.32, 14));
    for (const [x, z] of [[-0.62, -0.42], [0.62, -0.42], [-0.62, 0.46], [0.62, 0.46]]) {
      const tw = new THREE.Mesh(towerGeo, s);
      tw.position.set(x, 0.3, z);
      const cap = new THREE.Mesh(capGeo, s);
      cap.position.set(x, 0.76, z);
      tmp.add(tw, cap);
    }
    const crenel = bin.add(new THREE.BoxGeometry(0.12, 0.12, 0.12));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = new THREE.Mesh(crenel, s);
      c.position.set(Math.cos(a) * 0.38, 0.78, Math.sin(a) * 0.38);
      c.rotation.y = -a;
      tmp.add(c);
    }
    const stick = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.012, 0.012, 0.55)), mats.get('#6b4a2f', 'wood'));
    stick.position.y = 0.98;
    tmp.add(stick);
    const shellDeco = new THREE.Mesh(shellGeo, mats.get('#ffd6e0', 'gloss'));
    shellDeco.position.set(0, 0.35, 0.5);
    shellDeco.rotation.x = Math.PI / 2;
    tmp.add(shellDeco);
    const batch = new StaticBatch(bin);
    batch.addObject(tmp);
    castle.add(batch.build('castle'));
    const flagGeo = bin.add(new THREE.PlaneGeometry(0.32, 0.2, 6, 1).translate(0.16, 0, 0));
    const flag = new THREE.Mesh(flagGeo, bin.add(new THREE.MeshStandardMaterial({ color: '#7fe0d8', side: THREE.DoubleSide, roughness: 0.6 })));
    flag.position.set(0.012, 1.15, 0);
    castle.add(flag);
    const pos = flagGeo.attributes.position as THREE.BufferAttribute;
    const baseX = Float32Array.from({ length: pos.count }, (_, i) => pos.getX(i));
    animated.push((_dt, t) => {
      for (let i = 0; i < pos.count; i++) {
        const x = baseX[i];
        pos.setZ(i, Math.sin(x * 18 - t * 7) * 0.035 * (x / 0.32) * wind.uWind.value);
      }
      pos.needsUpdate = true;
    });
    castle.position.set(6.2, SAND_Y, -3.2);
    castle.rotation.y = -0.4;
    root.add(castle);
  }

  // Bucket and spade.
  {
    const tmp = new THREE.Group();
    const bucket = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.22, 0.16, 0.36, 18, 1, true)), mats.get('#ffcf3f', 'gloss'));
    bucket.position.y = 0.18;
    const bottom = new THREE.Mesh(bin.add(new THREE.CircleGeometry(0.16, 18).rotateX(-Math.PI / 2)), mats.get('#ffcf3f', 'gloss'));
    bottom.position.y = 0.01;
    const handle = new THREE.Mesh(bin.add(new THREE.TorusGeometry(0.21, 0.012, 6, 20, Math.PI)), mats.get('#3a6ea5', 'toy'));
    handle.position.y = 0.34;
    handle.rotation.y = 0.4;
    const spadeHandle = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8)), mats.get('#3a6ea5', 'toy'));
    spadeHandle.position.set(0.45, 0.06, 0.1);
    spadeHandle.rotation.set(0, 0.6, Math.PI / 2 - 0.12);
    const blade = new THREE.Mesh(bin.add(new RoundedBoxGeometry(0.2, 0.03, 0.24, 2, 0.012)), mats.get('#ff6b5a', 'gloss'));
    blade.position.set(0.72, 0.03, 0.26);
    blade.rotation.y = 0.6;
    tmp.add(bucket, bottom, handle, spadeHandle, blade);
    tmp.position.set(4.9, SAND_Y, -1.6);
    tmp.rotation.y = -0.5;
    propsHigh.addObject(tmp);
  }

  // A palm tree on the far beach.
  const palm = new THREE.Group();
  {
    const tmp = new THREE.Group();
    const segGeo = bin.add(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 9));
    let y = 0, x = 0;
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Mesh(segGeo, mats.get(i % 2 ? '#a77748' : '#946640', 'wood'));
      seg.position.set(x, y + 0.21, 0);
      seg.rotation.z = -0.06 * i;
      seg.scale.setScalar(1 - i * 0.05);
      tmp.add(seg);
      y += 0.39;
      x += 0.025 * i;
    }
    const frondGeo = bin.add(new THREE.SphereGeometry(1, 14, 8).scale(0.75, 0.06, 0.2).translate(0.7, 0, 0));
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(frondGeo, mats.get(i % 2 ? '#5fa845' : '#6fbb52', 'toy'));
      f.position.set(x, y + 0.05, 0);
      f.rotation.set(0, (i / 7) * Math.PI * 2, -0.35);
      tmp.add(f);
    }
    const coco = bin.add(new THREE.SphereGeometry(0.1, 10, 8));
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(coco, mats.get('#6b4a2f', 'toy'));
      c.position.set(x + Math.cos(i * 2.1) * 0.12, y - 0.08, Math.sin(i * 2.1) * 0.12);
      tmp.add(c);
    }
    const batch = new StaticBatch(bin);
    batch.addObject(tmp);
    palm.add(batch.build('palm'));
    palm.position.set(-7.4, SAND_Y, -6.7);
    palm.rotation.y = 0.8;
    root.add(palm);
    highOnly.push(palm);
    animated.push((_dt, t) => (palm.rotation.z = Math.sin(t * 0.8) * 0.02 * wind.uWind.value));
  }

  // ---------- water ----------
  const waterDepth = 4.6;
  const waterMat = bin.add(new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        t: { value: 0 },
        deep: { value: new THREE.Color(PALETTE.waterDeep) },
        shallow: { value: new THREE.Color(PALETTE.waterShallow) },
        surge: { value: 0 },
        tint: { value: new THREE.Color(1, 1, 1) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float t; varying vec2 vUv; varying float vH;
      void main() {
        vUv = uv; vec3 p = position;
        float h = sin(p.x * 1.3 + t * 1.4) * 0.05 + sin(p.y * 2.1 - t * 1.9) * 0.04 + sin((p.x + p.y) * 3.7 + t * 2.6) * 0.015;
        p.z += h; vH = h;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float t; uniform vec3 deep; uniform vec3 shallow; uniform float surge; uniform vec3 tint;
      varying vec2 vUv; varying float vH;
      void main() {
        float y = 1.0 - vUv.y; // 1 = shore edge, nearest the board
        float edge = 0.86 + 0.05 * sin(vUv.x * 30.0 + t * 1.6) + 0.04 * sin(t * 0.9) + surge;
        if (y > edge + 0.06) discard;
        vec3 c = mix(deep, shallow, smoothstep(0.1, edge, y));
        float foam = smoothstep(edge - 0.035, edge, y);
        float lines = smoothstep(0.92, 1.0, sin(y * 60.0 - t * 2.5 + sin(vUv.x * 12.0) * 2.0)) * 0.25 * (1.0 - y);
        float sparkle = pow(max(0.0, sin(vUv.x * 210.0 + t * 3.0) * sin(vUv.y * 150.0 - t * 2.2)), 24.0) * 0.8;
        c = mix(c, vec3(1.0), max(foam, lines));
        c += vH * 1.5 + sparkle;
        gl_FragColor = vec4(c * tint, mix(0.9, 0.97, foam));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  }));
  const water = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(BASE_W - 0.5, waterDepth, 140, 40)), waterMat);
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, WATER_Y, -HALF_D + waterDepth / 2);
  water.receiveShadow = false;
  root.add(water);

  // Buoy bobbing in the water.
  const buoy = new THREE.Group();
  {
    const tmp = new THREE.Group();
    const top = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mats.get('#ff5a4f', 'gloss'));
    const bottom = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), mats.get('#ffffff', 'gloss'));
    const band = new THREE.Mesh(bin.add(new THREE.TorusGeometry(0.22, 0.03, 8, 20).rotateX(Math.PI / 2)), mats.get('#ffffff', 'gloss'));
    tmp.add(top, bottom, band);
    const batch = new StaticBatch(bin);
    batch.addObject(tmp);
    buoy.add(batch.build('buoy'));
    buoy.position.set(2.8, WATER_Y, -6.9);
    root.add(buoy);
    highOnly.push(buoy);
    animated.push((_dt, t) => {
      buoy.position.y = WATER_Y + Math.sin(t * 1.6) * 0.05;
      buoy.rotation.z = Math.sin(t * 1.3) * 0.12;
      buoy.rotation.x = Math.sin(t * 1.1 + 1) * 0.1;
    });
  }

  // ---------- clouds ----------
  const cloudMat = bin.add(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe6d0', emissiveIntensity: 0.35, roughness: 1 }));
  const puffGeo = bin.add(new THREE.SphereGeometry(1, 16, 12));
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const geos: THREE.BufferGeometry[] = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const s = r(0.8, 1.5) * (k === Math.floor(n / 2) ? 1.3 : 1);
      geos.push(puffGeo.clone().scale(s, s, s).translate(k * 1.0 - n / 2, r(-0.2, 0.5), r(-0.5, 0.5)));
    }
    const merged = bin.add(mergeGeometries(geos)!);
    geos.forEach((g) => g.dispose());
    const c = new THREE.Mesh(merged, cloudMat);
    c.position.set(r(-38, 38), r(9, 15), r(-38, -12) * (i % 3 === 2 ? -0.9 : 1));
    c.scale.set(1, 0.7, 0.8);
    root.add(c);
    clouds.push(c);
    if (i >= 3) highOnly.push(c);
  }
  animated.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * 0.55;
      if (c.position.x > 42) c.position.x = -42;
    }
  });

  // ---------- birds (seagulls looping over the sea) ----------
  const birdCount = 4;
  const bodyGeo = bin.add(new THREE.SphereGeometry(1, 10, 8).scale(0.09, 0.08, 0.24));
  const wingGeoL = bin.add(new THREE.BoxGeometry(0.42, 0.015, 0.14).translate(-0.21, 0, 0));
  const wingGeoR = bin.add(new THREE.BoxGeometry(0.42, 0.015, 0.14).translate(0.21, 0, 0));
  const birdMat = mats.get('#ffffff', 'toy');
  const wingMat = mats.get('#e8eaee', 'toy');
  const bodies = new THREE.InstancedMesh(bodyGeo, birdMat, birdCount);
  const wingsL = new THREE.InstancedMesh(wingGeoL, wingMat, birdCount);
  const wingsR = new THREE.InstancedMesh(wingGeoR, wingMat, birdCount);
  const birds = new THREE.Group();
  birds.name = 'birds';
  birds.add(bodies, wingsL, wingsR);
  for (const m of [bodies, wingsL, wingsR]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  root.add(birds);
  highOnly.push(birds);
  const birdPaths = Array.from({ length: birdCount }, (_, i) => ({
    cx: r(-4, 4), cz: r(-9, -5), radius: r(3, 6), h: r(5, 7.5), speed: r(0.25, 0.4) * (i % 2 ? 1 : -1), phase: r(0, 6),
  }));
  {
    const mBody = new THREE.Matrix4(), mWing = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    animated.push((_dt, t) => {
      if (!birds.visible) return;
      birdPaths.forEach((b, i) => {
        const a = b.phase + t * b.speed;
        p.set(b.cx + Math.cos(a) * b.radius, b.h + Math.sin(t * 0.7 + i) * 0.4, b.cz + Math.sin(a) * b.radius);
        const dir = Math.sign(b.speed);
        const vx = -Math.sin(a) * dir, vz = Math.cos(a) * dir;
        q.setFromEuler(e.set(0, Math.atan2(vx, vz), -0.3 * dir, 'YXZ'));
        mBody.compose(p, q, one);
        bodies.setMatrixAt(i, mBody);
        const glide = Math.sin(t * 0.5 + i * 2) > 0.35;
        const flap = Math.sin(t * 9 + i) * (glide ? 0.08 : 0.6) + 0.1;
        mWing.makeRotationZ(flap);
        wingsL.setMatrixAt(i, mWing.clone().premultiply(mBody));
        mWing.makeRotationZ(-flap);
        wingsR.setMatrixAt(i, mWing.clone().premultiply(mBody));
      });
      bodies.instanceMatrix.needsUpdate = wingsL.instanceMatrix.needsUpdate = wingsR.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------- assemble ----------
  root.add(ground.build('ground', { castShadow: false }));
  root.add(props.build('props'));
  const high = propsHigh.build('props-high');
  root.add(high);
  highOnly.push(high);
  // Merged props already cast shadows; everything solid receives them. Grass, birds and clouds don't cast.
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material instanceof THREE.ShaderMaterial)) o.receiveShadow = true;
  });
  clouds.forEach((c) => (c.receiveShadow = false));

  const setQuality = (p: QualityProfile) => {
    for (const o of highOnly) o.visible = p.extraProps;
    tufts.count = Math.max(1, Math.floor(tuftsFull * p.propDensity));
    stems.count = heads.count = centres.count = Math.max(1, Math.floor(flowersFull * Math.max(p.propDensity, 0.4)));
    if (sun.shadow.mapSize.x !== p.shadowMapSize) {
      sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.radius = p.extraProps ? 4 : 2;
  };
  setQuality(profile);

  return {
    root, sun, hemi, fill, sky, water, wind,
    base: { sun: sun.intensity, hemi: hemi.intensity, fill: fill.intensity, env: 0.45 },
    update(dt, t) {
      wind.uTime.value = t;
      waterMat.uniforms.t.value = t;
      for (const fn of animated) fn(dt, t);
    },
    setQuality,
  };
}

/** A clump of five curved grass blades, darker at the root. */
function makeTuft(rnd: () => number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const dark = new THREE.Color('#4d8a34'), light = new THREE.Color('#b9e08a');
  const segs = 3;
  for (let b = 0; b < 5; b++) {
    const yaw = (b / 5) * Math.PI * 2 + rnd() * 0.8;
    const lean = 0.25 + rnd() * 0.35;
    const h = 0.22 + rnd() * 0.16;
    const w = 0.035 + rnd() * 0.015;
    const base = pos.length / 3;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const out = lean * t * t * h; // curls outward
      const y = h * t;
      const half = w * (1 - t * 0.92);
      // Blade faces sideways to its lean direction.
      const ox = cy * out, oz = sy * out;
      pos.push(ox - sy * half, y, oz + cy * half, ox + sy * half, y, oz - cy * half);
      const c = dark.clone().lerp(light, t);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Five petals in a ring. */
function makeFlowerHead(): THREE.BufferGeometry {
  const petal = new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.35, 0.6);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    geos.push(petal.clone().translate(0.05, 0, 0).rotateY(a));
  }
  petal.dispose();
  const g = mergeGeometries(geos)!;
  geos.forEach((x) => x.dispose());
  return g;
}

/** A fence picket with a pointed top, base at y = 0. */
function makePicket(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = 0.08;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, 0.66);
  s.lineTo(0, 0.78);
  s.lineTo(-w, 0.66);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
  g.translate(0, 0, -0.025);
  return g;
}

function makeStar(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? 0.12 : 0.3;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3 });
}
