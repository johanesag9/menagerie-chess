/** Sea: floaty, wobbly, smug. Crab, Seahorse, Pufferfish, Sea turtle, Octopus queen, Blobfish king. */
import * as THREE from 'three';
import type { PieceKind } from '../../contracts/types';
import { Box, C, Co, Cy, HS, S, T, Taper, brows, cheeks, crown, eyes, mouths, type V3 } from '../kit';
import { F, chain, start, type AnimalDef } from './common';

const PI = Math.PI;

const crab: AnimalDef = {
  side: 'sea', kind: 'p', name: 'Crab', targetHeight: 0.55,
  colors: { main: '#e8553f', second: '#ffd9bf', accent: '#9e2a1e', light: '#ff9a7a', dark: '#4a1a14', pink: '#ff8fa0', iris: '#2a2a3a' },
  anchors: {
    top: { bone: 'head', p: [0, 0.02, -0.03], s: 0.8 },
    face: { bone: 'head', p: [0, 0.14, 0.045], s: 0.95 },
    neck: { bone: 'body', p: [0, 0.1, 0.165], r: [0.2, 0, 0], s: 0.8 },
  },
  build(rig) {
    start(rig);
    rig.add('body', S(0.16, 24, 14), 'main', [0, 0.17, 0], [0, 0, 0], [1.35, 0.6, 1.0]);
    rig.add('body', S(0.15, 20, 10), 'second', [0, 0.135, 0.01], [0, 0, 0], [1.26, 0.4, 0.96]);
    for (const [x, z] of [[-0.09, -0.05], [0.1, -0.02], [0.0, -0.1], [-0.03, 0.04], [0.06, 0.07]] as const) {
      rig.add('body', S(0.018, 8, 6), 'light', [x, 0.257 - Math.abs(x) * 0.25, z], [0, 0, 0], [1, 0.4, 1]);
    }
    rig.both((s) => {
      [0.07, -0.01, -0.09].forEach((z, i) => {
        const n = (s < 0 ? 'legL' : 'legR') + (i + 1);
        rig.bone(n, 'body', [s * 0.17, 0.14, z], [0, s * (i - 1) * -0.35, 0]);
        rig.add(n, Taper([[0, 0, 0], [s * 0.09, 0.05, 0], [s * 0.15, -0.13, 0]], 0.02, 0.011, 10, 7), 'main');
      });
      const c = s < 0 ? 'clawL' : 'clawR';
      rig.bone(c, 'body', [s * 0.16, 0.17, 0.1], [0, -s * 0.45, 0]);
      rig.add(c, Taper([[0, 0, 0], [s * 0.05, 0.025, 0.05], [s * 0.075, 0.03, 0.09]], 0.026, 0.02, 8, 8), 'main');
      rig.add(c, S(0.068, 16, 12), 'main', [s * 0.08, 0.035, 0.13], [0, 0, 0], [0.95, 0.78, 1.2]);
      rig.add(c, Co(0.032, 0.11, 10), 'accent', [s * 0.08, 0.055, 0.22], [PI / 2, 0, 0], [1, 1, 0.8]);
      const j = s < 0 ? 'jawL' : 'jawR';
      rig.bone(j, c, [s * 0.08, 0.02, 0.17]);
      rig.add(j, Co(0.027, 0.095, 10), 'accent', [0, -0.012, 0.045], [PI / 2 + 0.3, 0, 0], [1, 1, 0.75]);
    });
    rig.bone('head', 'body', [0, 0.24, 0.07]);
    rig.both((s) => rig.add('head', Cy(0.014, 0.017, 0.13, 8), 'main', [s * 0.05, 0.06, 0]));
    eyes(rig, 'head', { x: 0.05, y: 0.14, z: 0.0, r: 0.046, yaw: 0.15, iris: true, pupilSize: 0.55, lid: { slot: 'main', droop: 0.35 } });
    mouths(rig, 'head', { p: [0, -0.07, 0.09], r: [0.15, 0, 0], w: 0.034, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.205, 0.025], 0.05, 0.03);
    cheeks(rig, 'head', 0.085, -0.045, 0.07, 0.022, 0.6);
  },
};

const seahorse: AnimalDef = {
  side: 'sea', kind: 'n', name: 'Seahorse', targetHeight: 0.86,
  colors: { main: '#f2a93b', second: '#ffd98a', light: '#fff0c4', accent: '#e2663a', dark: '#5a2a10', pink: '#ff8fa0', iris: '#33b5c8' },
  finishes: { light: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.14, -0.01], s: 0.75 },
    face: { bone: 'head', p: [0, 0.08, 0.075], s: 0.85 },
    neck: { bone: 'body', p: [0, 0.56, 0.06], r: [0.3, 0, 0], s: 0.7 },
  },
  build(rig) {
    start(rig);
    const spine: V3[] = [[0, 0.64, -0.03], [0, 0.53, 0.03], [0, 0.42, 0.06], [0, 0.31, 0.03], [0, 0.23, -0.03]];
    rig.add('body', Taper(spine, 0.075, 0.056, 20, 12), 'main');
    rig.add('body', S(0.09, 16, 12), 'second', [0, 0.42, 0.07], [0.15, 0, 0], [0.8, 1.45, 0.7]);
    const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p)));
    for (let i = 1; i < 8; i++) {
      const p = curve.getPoint(i / 8);
      const t = curve.getTangent(i / 8);
      const ring = rig.add('body', T(0.07 - i * 0.002, 0.009, PI * 2, 4, 16), 'second', [p.x, p.y, p.z]);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      rig.add('body', S(0.016, 6, 5), 'light', [p.x, p.y, p.z - 0.068]);
    }
    chain(rig, 'tail', 'body', [0, 0.23, -0.03], [[0, -0.08, -0.05], [0, -0.075, 0.035], [0, 0.0, 0.065]], 0.054, 0.018, 'main');
    rig.add('tail3', S(0.02, 8, 6), 'main', [0, 0.0, 0.065]);
    rig.bone('fin', 'body', [0, 0.44, -0.04]);
    rig.add('fin', S(0.075, 14, 10), 'light', [0, 0, -0.05], [0.3, 0, 0], [0.15, 1, 0.7]);

    rig.bone('head', 'body', [0, 0.62, -0.02]);
    rig.add('head', S(0.088, 22, 16), 'main', [0, 0.065, 0], [0, 0, 0], [1, 0.95, 1.1]);
    rig.add('head', Cy(0.024, 0.036, 0.14, 12), 'main', [0, 0.04, 0.12], [PI / 2, 0, 0]);
    rig.add('head', Cy(0.032, 0.027, 0.022, 12), 'second', [0, 0.04, 0.195], [PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) rig.add('head', Co(0.02, 0.065, 6), 'accent', [(i - 1) * 0.032, 0.16, -0.01], [0, 0, (1 - i) * 0.35]);
    rig.both((s) => {
      const n = s < 0 ? 'finL' : 'finR';
      rig.bone(n, 'head', [s * 0.07, -0.03, -0.03]);
      rig.add(n, S(0.035, 10, 6), 'light', [s * 0.02, 0, -0.01], [0, 0, 0], [0.25, 0.9, 0.7]);
    });
    eyes(rig, 'head', { x: 0.058, y: 0.08, z: 0.04, r: 0.044, yaw: 0.65, iris: true, pupilSize: 0.55, lid: { slot: 'main', droop: 0.3 } });
    mouths(rig, 'head', { p: [0, 0.035, 0.207], w: 0.017, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.135, 0.06], 0.045, 0.026);
    cheeks(rig, 'head', 0.07, 0.03, 0.06, 0.02, 0.9);
  },
};

const puffer: AnimalDef = {
  side: 'sea', kind: 'b', name: 'Pufferfish', targetHeight: 0.86,
  colors: { main: '#f5d66e', second: '#b0793a', light: '#fff6dc', accent: '#8a4fd0', extra: '#bfefff', dark: '#4a2a10', pink: '#ff8fa0', iris: '#3a9ad9' },
  finishes: { extra: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.36, -0.03], s: 0.8 },
    face: { bone: 'head', p: [0, 0.07, 0.19], s: 1.15 },
    neck: { bone: 'head', p: [0, -0.1, 0.17], r: [0.6, 0, 0], s: 0.85 },
  },
  build(rig) {
    start(rig);
    for (const [y, r, x] of [[0.04, 0.04, 0], [0.11, 0.032, 0.02], [0.17, 0.025, -0.015]] as const) rig.add('body', S(r, 12, 9), 'extra', [x, y, 0]);
    rig.bone('head', 'body', [0, 0.4, 0]);
    rig.add('head', S(0.2, 28, 20), 'main');
    rig.add('head', S(0.19, 24, 16), 'light', [0, -0.045, 0.02], [0, 0, 0], [0.96, 0.75, 0.96]);
    const up = new THREE.Vector3(0, 1, 0);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const pos = ico.attributes.position;
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      const key = v.toArray().map((n) => n.toFixed(2)).join();
      if (seen.has(key) || v.z > 0.55 || v.y < -0.7) continue;
      seen.add(key);
      const m = rig.add('head', Co(0.019, 0.065, 6), 'light', [v.x * 0.205, v.y * 0.205, v.z * 0.205]);
      m.quaternion.setFromUnitVectors(up, v);
    }
    ico.dispose();
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, y = 0.3 + (i % 3) * 0.22;
      const v = new THREE.Vector3(Math.sin(a), y, Math.cos(a) * 0.7 - 0.35).normalize();
      if (v.z > 0.4) continue;
      const m = rig.add('head', S(0.024, 10, 8), 'second', [v.x * 0.198, v.y * 0.198, v.z * 0.198], [0, 0, 0], [1, 1, 0.4]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
    }
    rig.both((s) => {
      const n = s < 0 ? 'finL' : 'finR';
      rig.bone(n, 'head', [s * 0.19, -0.02, 0.03]);
      rig.add(n, S(0.065, 12, 8), 'extra', [s * 0.03, 0, -0.02], [0, s * 0.5, 0], [0.25, 0.7, 1]);
    });
    rig.bone('tailFin', 'head', [0, 0, -0.19]);
    rig.add('tailFin', Co(0.075, 0.12, 12), 'extra', [0, 0, -0.06], [PI / 2, 0, 0], [0.25, 1, 1]);
    // Bishop's mitre.
    rig.add('head', Co(0.078, 0.18, 18), 'accent', [0, 0.27, -0.02], [-0.1, 0, 0], [1, 1, 0.72]);
    rig.add('head', T(0.07, 0.012, PI * 2, 5, 20), 'gold', [0, 0.195, -0.012], [PI / 2 - 0.1, 0, 0], [1, 0.72, 1]);
    rig.add('head', Box(0.012, 0.09, 0.012, 0.004), 'gold', [0, 0.26, 0.035], [-0.42, 0, 0]);
    rig.add('head', S(0.022, 10, 8), 'gold', [0, 0.365, -0.035]);
    eyes(rig, 'head', { x: 0.1, y: 0.07, z: 0.14, r: 0.062, yaw: 0.55, iris: true, pupilSize: 0.55, lid: { slot: 'main', droop: 0.32 } });
    mouths(rig, 'head', { p: [0, -0.045, 0.193], r: [0.25, 0, 0], w: 0.032, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.155, 0.135], 0.07, 0.04, 'dark', [-0.6, 0, 0]);
    cheeks(rig, 'head', 0.12, -0.0, 0.14, 0.028, 0.7);
  },
};

const turtle: AnimalDef = {
  side: 'sea', kind: 'r', name: 'Sea turtle', targetHeight: 0.97,
  colors: { main: '#2f8f6f', second: '#8fd0a8', extra: '#a9dcc6', light: '#f7f4ec', accent: '#e0473f', dark: '#33373d', extra2: '#ffe08a', pink: '#ff8fa0', iris: '#6a3a1a' },
  finishes: { extra2: F.glow, main: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.13, 0.08], s: 0.75 },
    face: { bone: 'head', p: [0, 0.085, 0.145], s: 0.85 },
    neck: { bone: 'head', p: [0, -0.04, 0.06], r: [0.6, 0, 0], s: 0.8 },
  },
  build(rig) {
    start(rig);
    rig.add('body', HS(0.27, 28, 10), 'main', [0, 0.1, 0], [0, 0, 0], [1, 0.62, 1.1]);
    rig.add('body', T(0.27, 0.034, PI * 2, 8, 36), 'second', [0, 0.1, 0], [PI / 2, 0, 0], [1, 1.1, 1]);
    rig.add('body', Cy(0.26, 0.22, 0.07, 28), 'second', [0, 0.075, 0], [0, 0, 0], [1, 1, 1.1]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      const v = new THREE.Vector3(Math.sin(a) * 0.62, 0.62, Math.cos(a) * 0.62 * 1.1).normalize();
      const m = rig.add('body', Cy(0.058, 0.058, 0.02, 6), 'second', [v.x * 0.235, 0.1 + v.y * 0.155, v.z * 0.26]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    }
    rig.both((s) => {
      const f = s < 0 ? 'flipFL' : 'flipFR';
      rig.bone(f, 'body', [s * 0.21, 0.09, 0.13]);
      rig.add(f, S(0.1, 14, 8), 'extra', [s * 0.1, 0, 0.03], [0, -s * 0.45, 0], [1.5, 0.22, 0.6]);
      const b = s < 0 ? 'flipBL' : 'flipBR';
      rig.bone(b, 'body', [s * 0.18, 0.08, -0.2]);
      rig.add(b, S(0.06, 12, 8), 'extra', [s * 0.05, 0, -0.03], [0, s * 0.5, 0], [1.4, 0.25, 0.7]);
    });
    chain(rig, 'tail', 'body', [0, 0.09, -0.29], [[0, -0.01, -0.06]], 0.028, 0.012, 'extra');
    // The lighthouse on its shell (the rook).
    const ly = 0.26;
    rig.add('body', Cy(0.1, 0.12, 0.08, 18), 'light', [0, ly + 0.04, 0]);
    for (let i = 0; i < 4; i++) rig.add('body', Cy(0.094 - (i + 1) * 0.006, 0.1 - i * 0.006, 0.075, 18), i % 2 ? 'light' : 'accent', [0, ly + 0.115 + i * 0.075, 0]);
    rig.add('body', Box(0.035, 0.05, 0.02, 0.01), 'dark', [0, ly + 0.2, 0.085]);
    rig.add('body', Cy(0.1, 0.1, 0.02, 18), 'dark', [0, ly + 0.43, 0]);
    rig.add('body', T(0.095, 0.007, PI * 2, 4, 20), 'dark', [0, ly + 0.47, 0], [PI / 2, 0, 0]);
    rig.bone('lamp', 'body', [0, ly + 0.48, 0]);
    rig.add('lamp', Cy(0.058, 0.058, 0.08, 14), 'extra2');
    rig.add('body', Co(0.078, 0.085, 16), 'accent', [0, ly + 0.565, 0]);
    rig.add('body', S(0.017, 8, 6), 'gold', [0, ly + 0.615, 0]);

    rig.bone('head', 'body', [0, 0.12, 0.25]);
    rig.add('head', C(0.052, 0.07, 5, 12), 'extra', [0, 0.0, 0.0], [1.15, 0, 0]);
    rig.add('head', S(0.09, 20, 14), 'extra', [0, 0.06, 0.08], [0, 0, 0], [1, 0.92, 1.12]);
    for (const [x, y, z] of [[0.04, 0.12, 0.08], [-0.03, 0.13, 0.05], [0.0, 0.1, 0.14]] as const) rig.add('head', S(0.014, 6, 5), 'main', [x, y, z], [0, 0, 0], [1, 0.5, 1]);
    eyes(rig, 'head', { x: 0.052, y: 0.085, z: 0.12, r: 0.04, yaw: 0.5, iris: true, pupilSize: 0.6, lid: { slot: 'extra', droop: 0.45 } });
    mouths(rig, 'head', { p: [0, 0.02, 0.172], r: [0.2, 0, 0], w: 0.034, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.13, 0.13], 0.045, 0.028);
    cheeks(rig, 'head', 0.07, 0.035, 0.12, 0.018, 0.7);
  },
};

const octopus: AnimalDef = {
  side: 'sea', kind: 'q', name: 'Octopus', targetHeight: 1.15,
  colors: { main: '#9a62c8', light: '#dcbcf4', second: '#7a46a8', extra: '#f7efe6', extra2: '#59d1c9', dark: '#3a1a4a', pink: '#ff8fa0', iris: '#f5d76e' },
  finishes: { extra: F.pearl, extra2: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.5, -0.12], r: [-0.35, 0, 0.1], s: 1.0 },
    face: { bone: 'head', p: [0, 0.135, 0.18], s: 1.2 },
    neck: { bone: 'head', p: [0, -0.02, 0.15], r: [0.3, 0, 0], s: 1.0 },
  },
  build(rig) {
    start(rig);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2 + PI / 8;
      const dx = Math.sin(a), dz = Math.cos(a);
      chain(rig, `t${i}`, 'body', [dx * 0.07, 0.3, dz * 0.07],
        [[dx * 0.1, -0.13, dz * 0.1], [dx * 0.12, -0.12, dz * 0.12], [dx * 0.08, 0.06, dz * 0.08]],
        0.058, 0.016, (k) => (k === 2 ? 'light' : 'main'), [`t${i}a`, `t${i}b`, `t${i}c`]);
    }
    rig.bone('head', 'body', [0, 0.36, 0]);
    rig.add('head', S(0.18, 26, 20), 'main', [0, 0.25, -0.06], [-0.3, 0, 0], [1, 1.35, 1.05]);
    rig.add('head', S(0.15, 24, 16), 'main', [0, 0.08, 0.03], [0, 0, 0], [1.15, 0.78, 1.05]);
    for (let i = 0; i < 6; i++) rig.add('head', S(0.022, 8, 6), 'light', [Math.sin(i * 1.7) * 0.11, 0.3 + (i % 2) * 0.09, -0.16 + Math.cos(i) * 0.04], [0, 0, 0], [1, 1, 0.5]);
    for (let i = 0; i < 11; i++) {
      const a = PI * 0.2 + (i / 10) * PI * 0.6;
      rig.add('head', S(0.019, 8, 6), 'extra', [Math.cos(a) * 0.15, -0.035 + Math.sin(a * 2) * 0.0, 0.03 + Math.sin(a) * 0.13]);
    }
    eyes(rig, 'head', { x: 0.085, y: 0.135, z: 0.125, r: 0.06, yaw: 0.5, pupil: 'bar', iris: true, pupilSize: 0.55, lid: { slot: 'main', droop: 0.35 } });
    mouths(rig, 'head', { p: [0, 0.035, 0.17], r: [0.15, 0, 0], w: 0.03, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.215, 0.15], 0.07, 0.04);
    cheeks(rig, 'head', 0.12, 0.06, 0.13, 0.026, 0.6);
    crown(rig, 'head', [0, 0.47, -0.13], 0.07, [-0.35, 0, 0.1]);
  },
};

const blobfish: AnimalDef = {
  side: 'sea', kind: 'k', name: 'Blobfish', targetHeight: 1.25,
  colors: { main: '#efa9ae', second: '#d98089', accent: '#c8323c', extra: '#f6d7c4', extra2: '#1f8a8a', dark: '#6a2a34', pink: '#ff7f95', iris: '#3a2026' },
  finishes: { main: F.gloss, second: F.gloss, extra: F.pearl, extra2: F.soft, accent: F.soft },
  anchors: {
    top: { bone: 'head', p: [0, 0.53, -0.02], s: 1.0 },
    face: { bone: 'head', p: [0, 0.26, 0.2], s: 1.15 },
    neck: { bone: 'head', p: [0, 0.03, 0.2], r: [0.3, 0, 0], s: 1.0 },
  },
  build(rig) {
    start(rig);
    // Scallop-shell throne and a velvet cushion.
    rig.add('body', S(0.3, 24, 14), 'extra', [0, 0.42, -0.25], [0, 0, 0], [1, 1.05, 0.12]);
    for (let i = 0; i < 9; i++) {
      const a = -1.25 + (i / 8) * 2.5;
      rig.add('body', C(0.026, 0.24, 4, 8), 'extra', [Math.sin(a) * 0.16, 0.42 + Math.cos(a) * 0.16, -0.22], [0, 0, -a], [1, 1, 0.8]);
    }
    rig.add('body', Box(0.46, 0.12, 0.42, 0.05), 'accent', [0, 0.06, 0]);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rig.add('body', S(0.024, 8, 6), 'gold', [x * 0.22, 0.03, z * 0.2]);

    rig.bone('head', 'body', [0, 0.12, 0]);
    rig.add('head', S(0.2, 28, 20), 'main', [0, 0.21, -0.01], [0, 0, 0], [1.12, 1.15, 1.02]);
    rig.add('head', S(0.16, 22, 14), 'main', [0, 0.08, 0.06], [0, 0, 0], [1.3, 0.7, 1.05]);
    rig.add('head', C(0.058, 0.07, 6, 12), 'second', [0, 0.17, 0.215], [0.4, 0, 0]);
    rig.both((s) => {
      const n = s < 0 ? 'finL' : 'finR';
      rig.bone(n, 'head', [s * 0.21, 0.09, 0.0]);
      rig.add(n, S(0.06, 12, 8), 'main', [s * 0.03, 0, 0], [0, 0, s * 0.5], [0.4, 0.9, 0.7]);
    });
    rig.add('head', Cy(0.18, 0.27, 0.28, 24, true, PI * 0.35, PI * 1.3), 'extra2', [0, 0.14, -0.04]);
    rig.add('head', T(0.18, 0.026, PI * 1.3, 6, 22), 'extra', [0, 0.28, -0.04], [PI / 2, 0, -PI * 1.15]);
    eyes(rig, 'head', { x: 0.088, y: 0.27, z: 0.165, r: 0.04, yaw: 0.35, iris: true, pupilSize: 0.66, lid: { slot: 'main', droop: 0.55 } });
    mouths(rig, 'head', { p: [0, 0.065, 0.205], r: [0.2, 0, 0], w: 0.055, neutral: 'smirk' });
    brows(rig, 'head', [0, 0.33, 0.16], 0.07, 0.04);
    cheeks(rig, 'head', 0.15, 0.15, 0.13, 0.03, 0.6);
    crown(rig, 'head', [0, 0.43, -0.01], 0.1, [0.06, 0, 0], 'accent');
  },
};

export const SEA: Record<PieceKind, AnimalDef> = { p: crab, n: seahorse, b: puffer, r: turtle, q: octopus, k: blobfish };
