import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import gsap from 'gsap';
import type { PieceKind, Side } from '../contracts/types';
import { createCast, type Actor } from './index';
import { KINDS } from './roster';
import { LEVEL } from './climb';

const SIDES: Side[] = ['land', 'sea'];
const ALL = SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind]));
const SQ = 2;
const LV = LEVEL * SQ;

// Drive GSAP by hand so tests run on simulated time.
let T = 0;
beforeAll(() => {
  gsap.ticker.remove(gsap.updateRoot);
  T = gsap.ticker.time;
});
afterAll(() => {
  gsap.ticker.add(gsap.updateRoot);
});
async function run(actors: Actor[], until: () => boolean, max = 6, each?: () => void): Promise<number> {
  let t = 0;
  while (!until() && t < max) {
    T += 1 / 60;
    t += 1 / 60;
    gsap.updateRoot(T);
    for (const a of actors) a.update(1 / 60, T);
    each?.();
    await Promise.resolve();
  }
  return t;
}
async function settle<T>(actors: Actor[], p: Promise<T>, max = 6, each?: () => void) {
  let done = false;
  p.then(() => (done = true));
  const t = await run(actors, () => done, max, each);
  return { done, t };
}
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

describe('phase 6', () => {
  const world = new THREE.Group();
  const cast = createCast({ squareSize: SQ, quality: 'high' });
  const make = (side: Side, kind: PieceKind, x = 0, y = 0, z = 0) => {
    const a = cast.createPiece({ id: `${side}-${kind}-${Math.random()}`, side, kind, square: 'a1' });
    a.object.position.set(x, y, z);
    world.add(a.object);
    return a;
  };

  it.each(ALL)('%s %s climbs up 1, up 2 and drops down 2: clears the edge, lands on target, faces home', async (side, kind) => {
    const a = make(side, kind);
    const home = a.object.rotation.y;
    const legs: [THREE.Vector3, THREE.Vector3][] = [];
    const go = async (to: THREE.Vector3) => {
      const from = a.object.position.clone();
      const span = to.clone().sub(from).setY(0).length();
      let low = Infinity, clipped = false;
      const r = await settle([a], a.moveTo(to, { style: 'climb' }), 6, () => {
        const p = a.object.position;
        low = Math.min(low, p.y);
        const h = p.clone().sub(from).setY(0).length() / span;
        // Going up, it is over the top by the time it is halfway across; going down, it stays up until it reaches the edge.
        if (to.y > from.y && h > 0.45 && p.y < to.y - 1e-3) clipped = true;
        if (to.y < from.y && h < 0.35 && p.y < from.y - 1e-3) clipped = true;
      });
      expect(r.done).toBe(true);
      expect(r.t).toBeLessThanOrEqual(1.2);
      expect(a.object.position.distanceTo(to)).toBeLessThan(1e-6);
      expect(low).toBeGreaterThanOrEqual(Math.min(from.y, to.y) - 1e-6);
      expect(clipped).toBe(false);
      legs.push([from, to]);
    };
    await go(new THREE.Vector3(0, LV, SQ));
    await go(new THREE.Vector3(SQ, LV * 3, SQ * 2));
    await go(new THREE.Vector3(SQ, LV, SQ * 3));
    await go(new THREE.Vector3(SQ, LV, SQ * 4)); // same height: a plain hop
    await run([a], () => !a.isBusy);
    expect(Math.abs(Math.sin(a.object.rotation.y - home))).toBeLessThan(1e-3);
    a.dispose();
  });

  it('the Climbers bound up 2 higher than the others; drops land harder than hops up', async () => {
    const peak = async (side: Side, kind: PieceKind) => {
      const a = make(side, kind);
      let top = 0;
      const lands: number[] = [];
      const off = cast.on('land', (p) => lands.push(p.intensity));
      await settle([a], a.moveTo(new THREE.Vector3(0, LV * 2, SQ), { style: 'climb' }), 6, () => (top = Math.max(top, a.object.position.y)));
      await settle([a], a.moveTo(new THREE.Vector3(0, 0, SQ * 2), { style: 'climb' }));
      off();
      a.dispose();
      return { over: top - LV * 2, up: lands[0], down: lands[lands.length - 1] };
    };
    for (const side of SIDES) {
      const climber = await peak(side, 'b');
      for (const k of ['p', 'n', 'r', 'q', 'k'] as PieceKind[]) {
        const other = await peak(side, k);
        expect(climber.over).toBeGreaterThan(other.over);
        expect(other.down).toBeGreaterThan(other.up);
      }
    }
  });

  it('climb under reduced motion is quicker, still clears the edge, and lands with zero intensity', async () => {
    const a = make('land', 'r');
    const full = await settle([a], a.moveTo(new THREE.Vector3(0, LV, SQ), { style: 'climb' }));
    a.object.position.set(0, 0, 0);
    const lands: number[] = [];
    const off = cast.on('land', (p) => lands.push(p.intensity));
    cast.setReducedMotion(true);
    let clipped = false;
    const short = await settle([a], a.moveTo(new THREE.Vector3(0, LV, SQ), { style: 'climb' }), 6, () => {
      if (a.object.position.z > SQ * 0.45 && a.object.position.y < LV - 1e-3) clipped = true;
    });
    cast.setReducedMotion(false);
    off();
    expect(short.t).toBeLessThan(full.t);
    expect(clipped).toBe(false);
    expect(lands).toEqual([0]);
    a.dispose();
  });

  it('pushed off a ledge: skids off, falls 2 levels, lands on target with a bigger thump; a flat push is unchanged', async () => {
    for (const side of SIDES) for (const kind of KINDS) {
      const v = make(side, kind, 0, LV * 2, 0);
      const lands: number[] = [];
      const off = cast.on('land', (p) => lands.push(p.intensity));
      const to = new THREE.Vector3(SQ, 0, 0);
      let early = false;
      const r = await settle([v], v.moveTo(to, { style: 'pushed' }), 6, () => {
        if (v.object.position.x < SQ * 0.3 && v.object.position.y < LV * 2 - 1e-3) early = true;
      });
      expect(r.done).toBe(true);
      expect(r.t).toBeLessThanOrEqual(1.2);
      expect(v.object.position.distanceTo(to)).toBeLessThan(1e-6);
      expect(early).toBe(false);
      // Flat: stays on the ground the whole way.
      let rose = false;
      await settle([v], v.moveTo(new THREE.Vector3(SQ * 2, 0, 0), { style: 'pushed' }), 6, () => { if (Math.abs(v.object.position.y) > 1e-9) rose = true; });
      expect(rose).toBe(false);
      off();
      expect(lands[0]).toBeGreaterThan(lands[1]);
      v.dispose();
    }
  });

  it.each(ALL)('%s %s builds and digs, on sand and on water: resolves when the sand lands or leaves, stays put, faces home', async (side, kind) => {
    const a = make(side, kind);
    const home = a.object.rotation.y;
    for (const water of [false, true]) for (const k of ['build', 'dig'] as const) for (const target of [new THREE.Vector3(SQ, LV, 0), new THREE.Vector3(-SQ, 0, -SQ)]) {
      // Let the last effects finish (pooled particle meshes stay in the scene, hidden while idle).
      const quiet = () => world.children.every((c) => c.name.startsWith('piece:') || (c.name.startsWith('fx:') && !c.visible));
      await run([a], quiet, 3);
      expect(quiet()).toBe(true);
      const before = new Set(world.children);
      const r = await settle([a], a.work(k, target, { water }));
      expect(r.done).toBe(true);
      expect(r.t).toBeGreaterThan(0.3);
      expect(r.t).toBeLessThan(1.0);
      // Effects are out at that moment: new meshes (mound, tossed sand, splash) or a pooled burst (clods, dust).
      expect(world.children.some((c) => c !== a.object && (!before.has(c) || (c.name.startsWith('fx:') && c.visible)))).toBe(true);
      const end = await run([a], () => !a.isBusy);
      expect(r.t + end).toBeLessThan(1.4);
      expect(a.object.position.length()).toBeLessThan(1e-9);
      expect(Math.abs(Math.sin(a.object.rotation.y - home))).toBeLessThan(1e-3);
    }
    await run([a], () => false, 1.5);
    a.dispose();
  });

  it('work resolves on skip and on dispose, and is quicker under reduced motion', async () => {
    const a = make('sea', 'q');
    const full = await settle([a], a.work('build', new THREE.Vector3(SQ, 0, 0)));
    cast.setReducedMotion(true);
    const short = await settle([a], a.work('build', new THREE.Vector3(SQ, 0, 0)));
    cast.setReducedMotion(false);
    expect(short.t).toBeLessThan(full.t);
    let done = false;
    a.work('dig', new THREE.Vector3(SQ, 0, 0)).then(() => (done = true));
    await run([a], () => false, 0.1);
    a.skip();
    await flush();
    expect(done).toBe(true);
    done = false;
    a.work('dig', new THREE.Vector3(SQ, 0, 0)).then(() => (done = true));
    a.dispose();
    await flush();
    expect(done).toBe(true);
  });

  it('a riding animal can be lowered with a plain y tween: idle, selection and hover never fight it', async () => {
    for (const [side, kind] of ALL) {
      const a = make(side, kind, 0, LV * 3, 0);
      a.setSelected(true);
      a.setHovered(true);
      a.emote('laugh');
      const want = { y: LV * 3 };
      gsap.to(want, { y: LV, duration: 0.5, ease: 'power2.inOut' });
      const ride = gsap.to(a.object.position, { y: LV, duration: 0.5, ease: 'power2.inOut' });
      let drift = 0;
      await run([a], () => ride.progress() >= 1, 2, () => { drift = Math.max(drift, Math.abs(a.object.position.y - want.y)); });
      expect(drift).toBeLessThan(1e-9);
      // The object itself never moves sideways or tilts (idle lives on the bones).
      expect(a.object.position.x).toBe(0);
      expect(a.object.position.z).toBe(0);
      expect(a.object.rotation.x).toBe(0);
      expect(a.object.rotation.z).toBe(0);
      expect(a.object.position.y).toBeCloseTo(LV, 9);
      // The next climb starts from where it rode to (no snap back).
      const p = a.moveTo(new THREE.Vector3(0, 0, SQ), { style: 'climb' });
      await run([a], () => false, 1 / 60);
      expect(Math.abs(a.object.position.y - LV)).toBeLessThan(0.05 * SQ);
      await settle([a], p);
      a.dispose();
    }
  });
});
