/** Land: warm, bouncy, loyal. Dachshund pup, Horse, Mountain goat, Elephant, Cat queen, Pug king. */
import * as THREE from 'three';
import type { PieceKind } from '../../contracts/types';
import { Box, C, Co, Cy, S, T, Taper, brows, cheeks, crown, eyes, mouths } from '../kit';
import { F, chain, leg, start, type AnimalDef } from './common';

const PI = Math.PI;

const dachshund: AnimalDef = {
  side: 'land', kind: 'p', name: 'Dachshund', targetHeight: 0.56,
  colors: { main: '#c0703c', second: '#f0cfa6', dark: '#6b3a20', accent: '#e2453c', pink: '#f27d8c', iris: '#5a3a24' },
  anchors: {
    top: { bone: 'head', p: [0, 0.24, 0.03], s: 0.9 },
    face: { bone: 'head', p: [0, 0.13, 0.155], s: 0.85 },
    neck: { bone: 'body', p: [0, 0.205, 0.215], r: [0.5, 0, 0], s: 0.8 },
  },
  build(rig) {
    start(rig);
    rig.add('body', C(0.1, 0.26, 6, 14), 'main', [0, 0.17, -0.03], [PI / 2, 0, 0]);
    rig.add('body', S(0.09), 'second', [0, 0.13, 0], [0, 0, 0], [0.95, 0.72, 2.2]);
    for (const [n, x, z] of [['legFL', -0.06, 0.13], ['legFR', 0.06, 0.13], ['legBL', -0.06, -0.17], ['legBR', 0.06, -0.17]] as const) {
      leg(rig, n, 'body', [x, 0.12, z], 0.1, 0.036, 'main', { slot: 'second', r: 0.04, h: 0.035 });
    }
    rig.add('body', T(0.078, 0.017, PI * 2, 6, 20), 'accent', [0, 0.235, 0.14], [PI / 2 - 0.6, 0, 0]);
    rig.add('body', S(0.022), 'gold', [0, 0.18, 0.2]);
    chain(rig, 'tail', 'body', [0, 0.22, -0.24], [[0, 0.08, -0.05], [0, 0.05, -0.01]], 0.026, 0.012, 'main');

    rig.bone('head', 'body', [0, 0.24, 0.16]);
    rig.add('head', S(0.135, 22, 16), 'main', [0, 0.11, 0.03], [0, 0, 0], [1.05, 0.98, 1]);
    rig.add('head', C(0.056, 0.07, 6, 14), 'second', [0, 0.06, 0.15], [PI / 2, 0, 0]);
    rig.add('head', S(0.03), 'pupil', [0, 0.078, 0.245], [0, 0, 0], [1.3, 0.9, 0.9]);
    rig.both((s) => {
      rig.bone(s < 0 ? 'earL' : 'earR', 'head', [s * 0.105, 0.18, 0.0], [0, 0, s * 0.35]);
      rig.add(s < 0 ? 'earL' : 'earR', S(0.075), 'dark', [s * 0.025, -0.075, 0.005], [0, 0, 0], [0.36, 1.25, 0.82]);
    });
    eyes(rig, 'head', { x: 0.058, y: 0.135, z: 0.128, r: 0.042, yaw: 0.32, iris: true, pupilSize: 0.6 });
    mouths(rig, 'head', { p: [0, 0.036, 0.236], r: [0.35, 0, 0], w: 0.028 });
    brows(rig, 'head', [0, 0.195, 0.14], 0.042, 0.03);
    cheeks(rig, 'head', 0.088, 0.075, 0.122, 0.022);
  },
};

const horse: AnimalDef = {
  side: 'land', kind: 'n', name: 'Horse', targetHeight: 0.86,
  colors: { main: '#9a5530', second: '#f2e2cc', dark: '#3a2216', accent: '#d0423a', light: '#fbf4ea', pink: '#f27d8c', extra: '#2b2420', iris: '#4a2a18' },
  finishes: { extra: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.13, 0.0], s: 0.85 },
    face: { bone: 'head', p: [0, 0.065, 0.11], s: 0.85 },
    neck: { bone: 'neck', p: [0, 0.03, 0.075], r: [0.2, 0, 0], s: 0.8 },
  },
  build(rig) {
    start(rig);
    rig.add('body', C(0.115, 0.18, 6, 14), 'main', [0, 0.4, -0.03], [PI / 2, 0, 0]);
    rig.add('body', S(0.1), 'second', [0, 0.36, 0.02], [0, 0, 0], [0.9, 0.6, 1.6]);
    for (const [n, x, z] of [['legFL', -0.072, 0.12], ['legFR', 0.072, 0.12], ['legBL', -0.072, -0.17], ['legBR', 0.072, -0.17]] as const) {
      const b = leg(rig, n, 'body', [x, 0.36, z], 0.3, 0.034, 'main', { slot: 'extra', r: 0.04, h: 0.045 });
      rig.add(b, Cy(0.036, 0.039, 0.05, 12), 'light', [0, -0.245, 0]);
    }
    rig.add('body', Box(0.2, 0.03, 0.17, 0.012), 'accent', [0, 0.51, -0.05]);
    rig.add('body', Box(0.07, 0.035, 0.12, 0.01), 'dark', [0, 0.53, -0.08]);
    chain(rig, 'tail', 'body', [0, 0.44, -0.3], [[0, -0.05, -0.08], [0, -0.11, -0.03], [0, -0.09, 0.02]], 0.042, 0.026, 'dark');

    rig.bone('neck', 'body', [0, 0.45, 0.15], [-0.15, 0, 0]);
    rig.add('neck', Taper([[0, -0.03, -0.03], [0, 0.1, 0.03], [0, 0.2, 0.06]], 0.08, 0.062, 10, 12), 'main');
    for (let i = 0; i < 6; i++) rig.add('neck', S(0.04, 12, 8), 'dark', [0, 0.22 - i * 0.045, -0.02 - i * 0.012], [0, 0, 0], [0.7, 1, 1]);
    rig.bone('head', 'neck', [0, 0.2, 0.06], [0.15, 0, 0]);
    rig.add('head', S(0.1, 22, 16), 'main', [0, 0.04, 0.01], [0, 0, 0], [1, 1.02, 1.12]);
    rig.add('head', S(0.078), 'second', [0, -0.015, 0.11], [0, 0, 0], [1.02, 0.86, 1.08]);
    rig.both((s) => rig.add('head', S(0.012, 8, 6), 'pupil', [s * 0.03, 0.005, 0.193]));
    rig.add('head', S(0.045, 12, 8), 'dark', [0.01, 0.125, 0.04], [0.5, 0, 0.3], [0.9, 0.7, 1.3]);
    rig.both((s) => {
      const n = s < 0 ? 'earL' : 'earR';
      rig.bone(n, 'head', [s * 0.05, 0.11, -0.02], [0, 0, -s * 0.25]);
      rig.add(n, Co(0.03, 0.085, 10), 'main', [0, 0.04, 0]);
      rig.add(n, Co(0.017, 0.055, 8), 'pink', [0, 0.035, 0.014]);
    });
    eyes(rig, 'head', { x: 0.064, y: 0.065, z: 0.075, r: 0.038, yaw: 0.55, iris: true, pupilSize: 0.58 });
    mouths(rig, 'head', { p: [0, -0.058, 0.172], r: [0.6, 0, 0], w: 0.03 });
    brows(rig, 'head', [0, 0.115, 0.1], 0.038, 0.028);
    cheeks(rig, 'head', 0.072, 0.0, 0.1, 0.02, 0.8);
  },
};

const goat: AnimalDef = {
  side: 'land', kind: 'b', name: 'Mountain goat', targetHeight: 0.84,
  colors: { main: '#f3eee4', second: '#d9ccb6', dark: '#3b332c', accent: '#3a7fc4', extra: '#9c958c', extra2: '#8d7660', pink: '#e99a95', iris: '#e3b04b' },
  finishes: { extra2: F.gloss, extra: { r: 0.85, m: 0, c: 0, e: 0 } },
  anchors: {
    top: { bone: 'head', p: [0, 0.16, 0.03], s: 0.75 },
    face: { bone: 'head', p: [0, 0.08, 0.115], s: 0.8 },
    neck: { bone: 'body', p: [0, 0.465, 0.17], r: [0.4, 0, 0], s: 0.75 },
  },
  build(rig) {
    start(rig);
    const rock = new THREE.DodecahedronGeometry(0.17, 0);
    rig.add('body', rock, 'extra', [0, 0.06, 0], [0.3, 0.5, 0.1], [1.55, 0.6, 1.3]);
    rig.add('body', new THREE.DodecahedronGeometry(0.06, 0), 'extra', [0.16, 0.04, 0.12], [0.6, 0.2, 0]);
    rig.add('body', C(0.1, 0.13, 6, 14), 'main', [0, 0.42, -0.01], [PI / 2, 0, 0]);
    for (const [x, y, z, r] of [[0, 0.5, 0.0, 0.07], [0.06, 0.47, -0.09, 0.06], [-0.06, 0.47, -0.09, 0.06], [0.07, 0.45, 0.06, 0.06], [-0.07, 0.45, 0.06, 0.06]] as const) {
      rig.add('body', S(r, 12, 9), 'main', [x, y, z]);
    }
    for (const [n, x, z] of [['legFL', -0.058, 0.09], ['legFR', 0.058, 0.09], ['legBL', -0.058, -0.11], ['legBR', 0.058, -0.11]] as const) {
      leg(rig, n, 'body', [x, 0.38, z], 0.22, 0.027, 'main', { slot: 'dark', r: 0.031, h: 0.04 });
    }
    rig.add('body', T(0.07, 0.015, PI * 2, 6, 20), 'accent', [0, 0.49, 0.13], [PI / 2 - 0.75, 0, 0]);
    rig.add('body', Cy(0.02, 0.032, 0.04, 12), 'gold', [0, 0.435, 0.185]);
    rig.add('body', S(0.01, 6, 5), 'gold', [0, 0.41, 0.185]);
    chain(rig, 'tail', 'body', [0, 0.47, -0.2], [[0, 0.05, -0.03]], 0.026, 0.015, 'main');

    rig.bone('head', 'body', [0, 0.52, 0.12]);
    rig.add('head', S(0.098, 22, 16), 'main', [0, 0.065, 0.03]);
    rig.add('head', S(0.06), 'second', [0, 0.012, 0.1], [0, 0, 0], [0.9, 0.8, 1.15]);
    rig.add('head', S(0.016, 8, 6), 'pink', [0, 0.025, 0.166], [0, 0, 0], [1.3, 0.8, 0.8]);
    rig.bone('beard', 'head', [0, -0.035, 0.11]);
    rig.add('beard', Co(0.026, 0.085, 10), 'main', [0, -0.04, 0], [PI, 0, 0]);
    rig.both((s) => {
      rig.add('head', Taper([[s * 0.04, 0.13, 0.04], [s * 0.065, 0.2, -0.02], [s * 0.075, 0.2, -0.1], [s * 0.06, 0.14, -0.13]], 0.024, 0.008, 16, 9), 'extra2');
      const n = s < 0 ? 'earL' : 'earR';
      rig.bone(n, 'head', [s * 0.085, 0.09, 0.0], [0, 0, -s * 0.3]);
      rig.add(n, S(0.042, 12, 8), 'main', [s * 0.035, 0, 0], [0, 0, 0], [1.4, 0.5, 0.8]);
      rig.add(n, S(0.03, 10, 6), 'pink', [s * 0.038, 0, 0.012], [0, 0, 0], [1.3, 0.4, 0.5]);
    });
    eyes(rig, 'head', { x: 0.056, y: 0.085, z: 0.088, r: 0.037, yaw: 0.45, pupil: 'bar', iris: true, pupilSize: 0.55 });
    mouths(rig, 'head', { p: [0, -0.018, 0.155], r: [0.4, 0, 0], w: 0.024 });
    brows(rig, 'head', [0, 0.135, 0.105], 0.036, 0.026);
    cheeks(rig, 'head', 0.07, 0.03, 0.09, 0.018, 0.7);
  },
};

const elephant: AnimalDef = {
  side: 'land', kind: 'r', name: 'Elephant', targetHeight: 0.97,
  colors: { main: '#a39aa0', second: '#c8c0c4', dark: '#4b4448', accent: '#c8323c', light: '#efe2c4', extra: '#cdb991', pink: '#e4a3ab', extra2: '#fbf6ec', iris: '#3a3236' },
  finishes: { extra2: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.19, 0.03], s: 0.95 },
    face: { bone: 'head', p: [0, 0.095, 0.19], s: 1.0 },
    neck: { bone: 'body', p: [0, 0.31, 0.29], r: [0.3, 0, 0], s: 0.95 },
  },
  build(rig) {
    start(rig);
    rig.add('body', S(0.21, 24, 16), 'main', [0, 0.3, -0.04], [0, 0, 0], [1, 0.9, 1.12]);
    for (const [n, x, z] of [['legFL', -0.11, 0.1], ['legFR', 0.11, 0.1], ['legBL', -0.11, -0.17], ['legBR', 0.11, -0.17]] as const) {
      const b = leg(rig, n, 'body', [x, 0.2, z], 0.19, 0.068, 'main', { slot: 'second', r: 0.072, h: 0.035 });
      rig.both((s) => rig.add(b, S(0.016, 8, 6), 'extra2', [s * 0.03, -0.18, 0.06]));
    }
    chain(rig, 'tail', 'body', [0, 0.3, -0.27], [[0, -0.07, -0.04]], 0.016, 0.012, 'main');
    rig.add('tail1', S(0.022, 8, 6), 'dark', [0, -0.08, -0.045], [0, 0, 0], [1, 1.4, 1]);
    // The tower on its back (the rook).
    rig.add('body', Cy(0.2, 0.21, 0.035, 24), 'accent', [0, 0.47, -0.05]);
    rig.add('body', T(0.205, 0.01, PI * 2, 5, 28), 'gold', [0, 0.455, -0.05], [PI / 2, 0, 0]);
    rig.add('body', Cy(0.12, 0.14, 0.27, 20), 'light', [0, 0.62, -0.05]);
    rig.add('body', T(0.127, 0.012, PI * 2, 5, 24), 'extra', [0, 0.6, -0.05], [PI / 2, 0, 0]);
    rig.add('body', Cy(0.145, 0.13, 0.04, 20), 'light', [0, 0.765, -0.05]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      rig.add('body', Box(0.06, 0.06, 0.05, 0.01), 'light', [Math.sin(a) * 0.12, 0.81, -0.05 + Math.cos(a) * 0.12], [0, a, 0]);
    }
    rig.add('body', Box(0.05, 0.08, 0.03, 0.02), 'dark', [0, 0.66, 0.07]);
    rig.add('body', Cy(0.006, 0.006, 0.18, 6), 'dark', [0, 0.87, -0.05]);
    rig.bone('flag', 'body', [0, 0.94, -0.05]);
    rig.add('flag', Box(0.11, 0.06, 0.01, 0.004), 'accent', [0.058, 0, 0]);

    rig.bone('head', 'body', [0, 0.4, 0.15]);
    rig.add('head', S(0.15, 24, 16), 'main', [0, 0.05, 0.04]);
    rig.both((s) => {
      const n = s < 0 ? 'earL' : 'earR';
      rig.bone(n, 'head', [s * 0.12, 0.06, 0.0], [0, -s * 0.35, 0]);
      rig.add(n, S(0.13, 18, 12), 'main', [s * 0.1, -0.01, -0.02], [0, 0, 0], [1, 1.05, 0.2]);
      rig.add(n, S(0.1, 16, 10), 'pink', [s * 0.1, -0.02, 0.0], [0, 0, 0], [0.8, 0.85, 0.12]);
      rig.add('head', Co(0.017, 0.085, 10), 'extra2', [s * 0.065, -0.06, 0.15], [1.25, 0, 0]);
    });
    chain(rig, 'trunk', 'head', [0, 0.0, 0.17], [[0, -0.075, 0.05], [0, -0.08, 0.025], [0, -0.06, -0.0]], 0.05, 0.028, 'main');
    rig.add('trunk3', T(0.022, 0.006, PI * 2, 5, 12), 'dark', [0, -0.062, 0], [PI / 2, 0, 0]);
    eyes(rig, 'head', { x: 0.075, y: 0.1, z: 0.15, r: 0.038, yaw: 0.4, iris: true, pupilSize: 0.58 });
    mouths(rig, 'head', { p: [0.0, -0.058, 0.15], r: [0.55, 0, 0], w: 0.04 });
    brows(rig, 'head', [0, 0.15, 0.15], 0.05, 0.034);
    cheeks(rig, 'head', 0.1, 0.035, 0.135, 0.026);
  },
};

const cat: AnimalDef = {
  side: 'land', kind: 'q', name: 'Cat', targetHeight: 1.15,
  colors: { main: '#e48a3c', second: '#b35e22', light: '#fbe6c6', dark: '#4a2a18', pink: '#f29aa6', accent: '#7b3fb0', extra2: '#3fb6e0', iris: '#8fd16a' },
  finishes: { extra2: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0.03, 0.39, 0.0], r: [0.1, 0, -0.2], s: 0.95 },
    face: { bone: 'head', p: [0, 0.14, 0.175], s: 1.15 },
    neck: { bone: 'body', p: [0, 0.48, 0.12], r: [0.3, 0, 0], s: 1.0 },
  },
  build(rig) {
    start(rig);
    rig.add('body', S(0.16, 22, 16), 'main', [0, 0.17, -0.03], [0, 0, 0], [1.05, 1.0, 1.05]);
    rig.add('body', S(0.13, 22, 16), 'main', [0, 0.35, 0.02], [0, 0, 0], [0.95, 1.3, 0.9]);
    rig.add('body', S(0.1, 18, 12), 'light', [0, 0.31, 0.085], [0, 0, 0], [0.8, 1.35, 0.5]);
    rig.both((s) => rig.add('body', S(0.06, 12, 9), 'light', [s * 0.1, 0.03, 0.1], [0, 0, 0], [1, 0.6, 1.35]));
    rig.both((s) => {
      const n = s < 0 ? 'pawL' : 'pawR';
      leg(rig, n, 'body', [s * 0.068, 0.42, 0.07], 0.37, 0.036, 'main', { slot: 'light', r: 0.043, h: 0.04 });
    });
    rig.add('body', T(0.1, 0.034, PI * 2, 8, 22), 'light', [0, 0.49, 0.02], [PI / 2, 0, 0]);
    rig.add('body', S(0.028, 10, 8), 'extra2', [0, 0.45, 0.13], [0, 0, 0], [1, 1.2, 0.6]);
    rig.add('body', T(0.11, 0.008, PI * 2, 4, 24), 'gold', [0, 0.465, 0.02], [PI / 2 - 0.3, 0, 0]);
    chain(rig, 'tail', 'body', [0.07, 0.04, -0.16], [[0.12, -0.005, 0.03], [0.05, 0.0, 0.13], [-0.05, 0.03, 0.09]], 0.034, 0.026, (i) => (i === 2 ? 'second' : 'main'));

    rig.bone('head', 'body', [0, 0.55, 0.03]);
    rig.add('head', S(0.17, 24, 18), 'main', [0, 0.13, 0.02], [0, 0, 0], [1.12, 0.95, 1]);
    rig.add('head', S(0.06), 'light', [0, 0.07, 0.15], [0, 0, 0], [1.3, 0.8, 0.7]);
    rig.add('head', S(0.018, 8, 6), 'pink', [0, 0.1, 0.188], [0, 0, 0], [1.3, 0.8, 0.8]);
    for (let i = 0; i < 3; i++) rig.add('head', S(0.026, 8, 6), 'second', [(i - 1) * 0.045, 0.27, 0.07 + (i === 1 ? 0.01 : 0)], [0.6, 0, 0], [0.5, 1.4, 0.4]);
    rig.both((s) => {
      const n = s < 0 ? 'earL' : 'earR';
      rig.bone(n, 'head', [s * 0.1, 0.25, 0.0], [0, 0, -s * 0.38]);
      rig.add(n, Co(0.066, 0.13, 12), 'main', [0, 0.045, 0]);
      rig.add(n, Co(0.04, 0.085, 10), 'pink', [0, 0.035, 0.02]);
      for (const k of [-1, 1]) rig.add('head', Cy(0.003, 0.003, 0.13, 4), 'light', [s * 0.11, 0.075 + k * 0.012, 0.15], [0, 0, PI / 2 + k * 0.12 * s]);
    });
    eyes(rig, 'head', { x: 0.07, y: 0.15, z: 0.13, r: 0.052, yaw: 0.3, pupil: 'slit', iris: true, pupilSize: 0.6 });
    mouths(rig, 'head', { p: [0, 0.048, 0.178], r: [0.25, 0, 0], w: 0.028 });
    brows(rig, 'head', [0, 0.215, 0.145], 0.05, 0.034);
    cheeks(rig, 'head', 0.115, 0.06, 0.115, 0.026);
    crown(rig, 'head', [0.03, 0.29, 0.0], 0.075, [0.1, 0, -0.2]);
  },
};

const pug: AnimalDef = {
  side: 'land', kind: 'k', name: 'Pug', targetHeight: 1.25,
  colors: { main: '#dcb68a', second: '#c49a6c', dark: '#3b2c26', accent: '#c8323c', light: '#fbf6ec', pink: '#ef7d8f', extra2: '#3fb0e0', iris: '#3a2418' },
  finishes: { accent: F.soft, light: F.soft, extra2: F.gloss },
  anchors: {
    top: { bone: 'head', p: [0, 0.44, 0.02], r: [0.06, 0, 0], s: 1.0 },
    face: { bone: 'head', p: [0, 0.17, 0.2], s: 1.2 },
    neck: { bone: 'body', p: [0, 0.4, 0.19], r: [0.3, 0, 0], s: 1.05 },
  },
  build(rig) {
    start(rig);
    rig.add('body', S(0.19, 24, 16), 'main', [0, 0.21, 0], [0, 0, 0], [1.05, 1.1, 1]);
    rig.add('body', S(0.13, 18, 12), 'light', [0, 0.2, 0.09], [0, 0, 0], [1, 1.1, 0.6]);
    rig.both((s) => rig.add('body', S(0.065, 12, 9), 'main', [s * 0.11, 0.03, 0.1], [0, 0, 0], [1, 0.6, 1.3]));
    rig.both((s) => leg(rig, s < 0 ? 'pawL' : 'pawR', 'body', [s * 0.085, 0.35, 0.1], 0.33, 0.045, 'main', { slot: 'main', r: 0.05, h: 0.045 }));
    // Scepter in the right paw.
    rig.add('pawR', Cy(0.011, 0.011, 0.36, 8), 'gold', [0.035, -0.22, 0.07], [0.15, 0, -0.1]);
    rig.add('pawR', S(0.03, 12, 9), 'extra2', [0.052, -0.04, 0.095]);
    rig.add('pawR', T(0.03, 0.008, PI * 2, 4, 14), 'gold', [0.05, -0.07, 0.093], [PI / 2, 0, 0]);
    // Royal cape with an ermine trim.
    rig.add('body', Cy(0.17, 0.27, 0.36, 24, true, PI * 0.3, PI * 1.4), 'accent', [0, 0.27, -0.02]);
    rig.add('body', T(0.17, 0.032, PI * 1.4, 7, 22), 'light', [0, 0.45, -0.02], [PI / 2, 0, -PI * 1.2]);
    for (let i = 0; i < 5; i++) {
      const a = PI * 0.45 + (i / 4) * PI * 1.1;
      rig.add('body', S(0.012, 6, 5), 'dark', [Math.sin(a) * 0.195, 0.455, -0.02 + Math.cos(a) * 0.195]);
    }
    rig.add('body', T(0.04, 0.016, PI * 1.6, 6, 14), 'main', [0, 0.2, -0.2], [0, PI / 2, 0]);

    rig.bone('head', 'body', [0, 0.42, 0.04]);
    rig.add('head', S(0.2, 26, 18), 'main', [0, 0.15, 0.02], [0, 0, 0], [1.15, 0.95, 1]);
    rig.add('head', S(0.1, 18, 12), 'second', [0, 0.1, 0.15], [0, 0, 0], [1.15, 0.75, 0.62]);
    rig.add('head', S(0.06, 14, 10), 'dark', [0, 0.135, 0.19], [0, 0, 0], [1.15, 0.6, 0.5]);
    rig.add('head', S(0.028, 10, 8), 'pupil', [0, 0.15, 0.218], [0, 0, 0], [1.4, 0.8, 0.8]);
    for (const [y, w] of [[0.255, 0.05], [0.23, 0.035]] as const) rig.add('head', T(w, 0.008, PI, 4, 12), 'second', [0, y, 0.175], [-0.4, 0, 0]);
    rig.both((s) => {
      const n = s < 0 ? 'earL' : 'earR';
      rig.bone(n, 'head', [s * 0.16, 0.26, 0.02], [0, 0, s * 0.9]);
      rig.add(n, S(0.065, 12, 9), 'dark', [0, -0.03, 0], [0, 0, 0], [0.42, 1, 0.8]);
    });
    eyes(rig, 'head', { x: 0.088, y: 0.17, z: 0.15, r: 0.057, yaw: 0.45, iris: true, pupilSize: 0.62 });
    mouths(rig, 'head', { p: [0, 0.07, 0.2], r: [0.3, 0, 0], w: 0.036, tongue: 'pink' });
    brows(rig, 'head', [0, 0.255, 0.17], 0.06, 0.04);
    cheeks(rig, 'head', 0.14, 0.08, 0.135, 0.03);
    crown(rig, 'head', [0, 0.33, 0.02], 0.1, [0.06, 0, 0]);
  },
};

export const LAND: Record<PieceKind, AnimalDef> = { p: dachshund, n: horse, b: goat, r: elephant, q: cat, k: pug };
