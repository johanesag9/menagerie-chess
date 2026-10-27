import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import gsap from 'gsap';
import type { PieceKind, Side } from '../contracts/types';
import { createCast, type Actor } from './index';
import { getTemplate, KINDS } from './roster';
import { PALETTES, paletteTable } from './palettes';
import { ACCESSORIES } from './accessories';
import { PEDESTAL_H } from './kit';

const SIDES: Side[] = ['land', 'sea'];

// Drive GSAP by hand so tests run on simulated time.
let T = 0;
beforeAll(() => {
  gsap.ticker.remove(gsap.updateRoot);
  T = gsap.ticker.time;
});
afterAll(() => {
  gsap.ticker.add(gsap.updateRoot);
});
async function run(actors: Actor[], until: () => boolean, max = 6): Promise<number> {
  let t = 0;
  while (!until() && t < max) {
    T += 1 / 60;
    t += 1 / 60;
    gsap.updateRoot(T);
    for (const a of actors) a.update(1 / 60, T);
    await Promise.resolve();
  }
  return t;
}
async function settle<T>(actors: Actor[], p: Promise<T>, max = 6) {
  let done = false;
  p.then(() => (done = true));
  const t = await run(actors, () => done, max);
  return { done, t };
}

describe('roster', () => {
  it.each(SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind])))('%s %s builds with a face and fits its square', (side, kind) => {
    const t = getTemplate(side, kind);
    const names = new Set<string>();
    t.rig.root.traverse((o) => names.add(o.name));
    for (const n of ['base', 'body', 'head', 'eyeL', 'eyeR', 'lookL', 'lookR', 'mSmile', 'mOpen', 'mO', 'mFrown', 'brows']) expect(names.has(n), n).toBe(true);
    const box = new THREE.Box3().setFromBufferAttribute(t.rig.geometry.attributes.position as THREE.BufferAttribute);
    // Hidden mouth shapes are collapsed in the bind pose, so the box is the visible animal.
    expect(box.max.y).toBeCloseTo(t.def.targetHeight, 1);
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThan(0.62);
    expect(t.rig.vertexCount).toBeLessThan(40000);
  });

  it('kings and queens are the tallest, pawns the shortest', () => {
    for (const s of SIDES) {
      const h = (k: PieceKind) => getTemplate(s, k).height;
      expect(h('k')).toBeGreaterThan(h('q'));
      for (const k of ['p', 'n', 'b', 'r'] as PieceKind[]) {
        expect(h('q')).toBeGreaterThan(h(k));
        if (k !== 'p') expect(h(k)).toBeGreaterThan(h('p'));
      }
      expect(h('p')).toBeGreaterThan(PEDESTAL_H);
    }
  });
});

describe('skins', () => {
  it('each side has 3-4 palettes and 4-6 accessories; team colours never change', () => {
    const cast = createCast({ squareSize: 1, quality: 'high' });
    for (const s of SIDES) {
      const l = cast.listSkins(s);
      expect(l.palettes.length).toBeGreaterThanOrEqual(3);
      expect(l.palettes.length).toBeLessThanOrEqual(4);
      const acc = l.accessories.filter((a) => a.id !== 'none');
      expect(acc.length).toBeGreaterThanOrEqual(4);
      expect(acc.length).toBeLessThanOrEqual(6);
      for (const k of KINDS) {
        const def = getTemplate(s, k).def;
        const base = paletteTable(def, undefined);
        for (const p of PALETTES[s]) {
          const t = paletteTable(def, p.id);
          expect(t.teamBase.color).toBe(base.teamBase.color);
          expect(t.teamRim.color).toBe(base.teamRim.color);
          for (const v of Object.values(t)) expect(v.color).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it('display names follow the roster', () => {
    const cast = createCast({ squareSize: 1, quality: 'high' });
    expect(cast.displayName('sea', 'n')).toBe('Seahorse');
    expect(cast.displayName('land', 'k')).toBe('Pug');
    expect(cast.displayName('land', 'r')).toBe('Elephant');
    expect(cast.displayName('sea', 'q')).toBe('Octopus');
  });

  it('setSkin swaps palettes and accessories live', () => {
    const cast = createCast({ squareSize: 1, quality: 'high' });
    for (const s of SIDES) for (const k of KINDS) {
      const a = cast.createPiece({ id: s + k, side: s, kind: k, square: 'e4' });
      for (const p of PALETTES[s]) for (const acc of [undefined, ...ACCESSORIES.map((x) => x.id)]) a.setSkin({ palette: p.id, accessory: acc });
      let meshes = 0;
      a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes++; });
      expect(meshes).toBe(1);
      a.setSkin({});
      meshes = 0;
      a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes++; });
      expect(meshes).toBe(0);
      a.dispose();
    }
  });
});

describe('actors', () => {
  const world = new THREE.Group();
  const cast = createCast({ squareSize: 2, quality: 'high' });
  const make = (side: Side, kind: PieceKind, x: number, z: number) => {
    const a = cast.createPiece({ id: `${side}-${kind}-${x}-${z}`, side, kind, square: 'a1' });
    a.object.position.set(x, 0, z);
    world.add(a.object);
    return a;
  };

  it.each(SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind])))('%s %s moves in under 1.2s and ends on target', async (side, kind) => {
    const a = make(side, kind, 0, 0);
    const homeYaw = a.object.rotation.y;
    for (const to of [new THREE.Vector3(0, 0, 2), new THREE.Vector3(2, 0, 6), new THREE.Vector3(-12, 0, 6)]) {
      const r = await settle([a], a.moveTo(to));
      expect(r.done).toBe(true);
      expect(r.t).toBeLessThanOrEqual(1.2);
      expect(a.object.position.distanceTo(to)).toBeLessThan(1e-6);
    }
    await run([a], () => !a.isBusy);
    expect(Math.abs(Math.sin(a.object.rotation.y - homeYaw))).toBeLessThan(1e-3);
    a.dispose();
  });

  it.each(SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind])))('%s %s captures in about 2s; the victim leaves the board', async (side, kind) => {
    const a = make(side, kind, 0, 0);
    const v = make(side === 'land' ? 'sea' : 'land', 'q', 0, 8);
    const imp = await settle([a, v], a.attack(v));
    expect(imp.done).toBe(true);
    const gone = v.defeat(a);
    const mv = await settle([a, v], a.moveTo(new THREE.Vector3(0, 0, 8)));
    expect(imp.t + mv.t).toBeLessThan(2.1);
    const d = await settle([a, v], gone, 3);
    expect(d.done).toBe(true);
    expect(v.object.parent).toBeNull();
    a.dispose();
    v.dispose();
  });

  it('celebrate and emotes run; promises resolve on dispose and skip', async () => {
    const a = make('land', 'k', 0, 0);
    expect((await settle([a], a.celebrate())).done).toBe(true);
    for (const e of ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'] as const) a.emote(e);
    const p = a.moveTo(new THREE.Vector3(0, 0, 10));
    await run([a], () => false, 0.2);
    a.skip();
    let done = false;
    p.then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(a.object.position.z).toBeCloseTo(10);
    const q = a.celebrate();
    a.dispose();
    let qd = false;
    q.then(() => (qd = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(qd).toBe(true);
    expect(cast.actors.has(a)).toBe(false);
  });

  it('reduced motion makes moves shorter and fires stomps with zero intensity', async () => {
    const a = make('land', 'r', 0, 0);
    const full = await settle([a], a.moveTo(new THREE.Vector3(0, 0, 6)));
    const stomps: number[] = [];
    const off = cast.on('stomp', (s) => stomps.push(s.intensity));
    cast.setReducedMotion(true);
    const short = await settle([a], a.moveTo(new THREE.Vector3(0, 0, 0)));
    cast.setReducedMotion(false);
    off();
    expect(short.t).toBeLessThan(full.t);
    expect(stomps.length).toBeGreaterThan(0);
    expect(stomps.every((s) => s === 0)).toBe(true);
    a.dispose();
  });
});
