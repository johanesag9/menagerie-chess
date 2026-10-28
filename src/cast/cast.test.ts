import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import gsap from 'gsap';
import { POWER_OF, type MoveStyle, type PieceKind, type Side } from '../contracts/types';
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

  it('the low quality tier builds lighter meshes', () => {
    for (const s of SIDES) for (const k of KINDS) {
      const hi = getTemplate(s, k).rig.vertexCount;
      const lo = getTemplate(s, k, 'low').rig.vertexCount;
      expect(lo).toBeLessThan(hi * 0.8);
      expect(getTemplate(s, k, 'low').height).toBe(getTemplate(s, k).height);
    }
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

describe('phase 3', () => {
  const world = new THREE.Group();
  const cast = createCast({ squareSize: 2, quality: 'high' });
  const make = (side: Side, kind: PieceKind, x = 0, z = 0) => {
    const a = cast.createPiece({ id: `${side}-${kind}-p3-${x}-${z}`, side, kind, square: 'a1' });
    a.object.position.set(x, 0, z);
    world.add(a.object);
    return a;
  };
  const ALL = SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind]));
  const STYLES: MoveStyle[] = ['sidestep', 'jump', 'slip', 'pushed', 'teleport', 'dig', 'swept', 'quake', 'bonked', 'step'];

  it.each(ALL)('%s %s: its power flourish takes effect in 0.4-1s and emits `power` once, at that moment', async (side, kind) => {
    const a = make(side, kind);
    const power = POWER_OF[kind];
    const seen: { power: string; t: number }[] = [];
    let t = 0;
    const off = cast.on('power', (p) => { if (p.id === a.id) seen.push({ power: p.power, t }); });
    const target = new THREE.Vector3(4, 0, 4);
    let done = false;
    a.powerUp(power, target).then(() => (done = true));
    while (!done && t < 3) {
      T += 1 / 60;
      t += 1 / 60;
      gsap.updateRoot(T);
      a.update(1 / 60, T);
      await Promise.resolve();
    }
    off();
    expect(done).toBe(true);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(1.0);
    expect(seen).toHaveLength(1);
    expect(seen[0].power).toBe(power);
    expect(Math.abs(seen[0].t - t)).toBeLessThan(0.05);
    await run([a], () => !a.isBusy);
    a.dispose();
  });

  it('a power the animal does not own still plays (generic flourish)', async () => {
    const a = make('land', 'p');
    expect((await settle([a], a.powerUp('stomp'))).done).toBe(true);
    a.dispose();
  });

  it.each(ALL)('%s %s: every move style ends on target in under 1.2s', async (side, kind) => {
    const a = make(side, kind);
    let at = new THREE.Vector3(0, 0, 0);
    for (const style of STYLES) {
      const to = at.clone().add(new THREE.Vector3(style === 'jump' ? 2 : 0, 0, style === 'jump' ? 4 : 2));
      const r = await settle([a], a.moveTo(to, { style }));
      expect(r.done, style).toBe(true);
      expect(r.t, style).toBeLessThanOrEqual(1.2);
      expect(a.object.position.distanceTo(to), style).toBeLessThan(1e-6);
      await run([a], () => !a.isBusy);
      at = to;
    }
    // No helper objects (wave humps) are left behind.
    let extra = 0;
    a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) extra++; });
    expect(extra).toBe(0);
    a.dispose();
  });

  it('a double jump is two hops in a row, both under 1.2s', async () => {
    const a = make('land', 'n');
    const mid = new THREE.Vector3(2, 0, 4), to = new THREE.Vector3(4, 0, 8);
    const one = await settle([a], a.moveTo(mid, { style: 'jump' }));
    const two = await settle([a], a.moveTo(to, { style: 'jump' }));
    expect(one.t + two.t).toBeLessThan(2.2);
    expect(a.object.position.distanceTo(to)).toBeLessThan(1e-6);
    a.dispose();
  });

  it('statuses add one cheap mesh, survive moves and skins, and clear', async () => {
    for (const side of SIDES) {
      const a = make(side, 'b');
      const extras = () => {
        let n = 0;
        a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) n++; });
        return n;
      };
      a.setStatus('stunned');
      expect(a.statusKind).toBe('stunned');
      expect(extras()).toBe(1);
      await settle([a], a.moveTo(new THREE.Vector3(0, 0, 2), { style: 'pushed' }));
      a.setSkin({ palette: PALETTES[side][1].id });
      expect(extras()).toBe(1);
      a.setStatus('frozen');
      await run([a], () => false, 0.5);
      expect(extras()).toBe(1);
      // Frozen: the idle stops dead.
      a.update(1 / 60, 10);
      for (const o of a.idleL.m.values()) expect(o.ry + o.rz + o.rx).toBe(0);
      a.setStatus(null);
      expect(a.statusKind).toBeNull();
      await run([a], () => false, 0.5);
      expect(extras()).toBe(0);
      a.dispose();
    }
  });

  it('hit and appear resolve; appear ends at full size', async () => {
    for (const side of SIDES) {
      const a = make(side, 'q');
      const h = await settle([a], a.hit());
      expect(h.done).toBe(true);
      expect(h.t).toBeLessThan(1);
      const ap = await settle([a], a.appear());
      expect(ap.done).toBe(true);
      expect(ap.t).toBeGreaterThan(0.6);
      expect(ap.t).toBeLessThan(1.0);
      await run([a], () => !a.isBusy);
      const base = a.act.get('base');
      expect(base.py).toBeCloseTo(0);
      expect(base.sx).toBeCloseTo(1);
      a.dispose();
    }
  });

  it('everything new resolves on skip', async () => {
    const a = make('sea', 'k');
    const check = async (p: Promise<void>) => {
      let done = false;
      p.then(() => (done = true));
      await run([a], () => false, 0.1);
      cast.skipAll();
      await Promise.resolve();
      await Promise.resolve();
      expect(done).toBe(true);
    };
    await check(a.powerUp('escape'));
    await check(a.moveTo(new THREE.Vector3(4, 0, 4), { style: 'teleport' }));
    expect(a.object.position.distanceTo(new THREE.Vector3(4, 0, 4))).toBeLessThan(1e-6);
    await check(a.moveTo(new THREE.Vector3(4, 0, 6), { style: 'swept' }));
    await check(a.hit());
    await check(a.appear());
    let extra = 0;
    a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) extra++; });
    expect(extra).toBe(0);
    a.dispose();
  });

  it('reduced motion: power and land events have zero intensity, and flourishes are quicker', async () => {
    const a = make('land', 'r');
    const full = await settle([a], a.powerUp('stomp'));
    await run([a], () => !a.isBusy);
    const ints: number[] = [];
    const off = cast.on('power', (p) => ints.push(p.intensity));
    cast.setReducedMotion(true);
    const short = await settle([a], a.powerUp('stomp'));
    cast.setReducedMotion(false);
    off();
    expect(short.t).toBeLessThan(full.t);
    expect(ints).toEqual([0]);
    a.dispose();
  });
});

describe('phase 4', () => {
  const world = new THREE.Group();
  const cast = createCast({ squareSize: 2, quality: 'high' });
  let n = 0;
  const make = (side: Side, kind: PieceKind) => {
    const a = cast.createPiece({ id: `${side}-${kind}-p4-${n++}`, side, kind, square: 'a1' });
    world.add(a.object);
    return a;
  };
  const extras = (a: Actor) => {
    let k = 0;
    a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) k++; });
    return k;
  };
  const ALL = SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind]));

  it.each(ALL)('%s %s falls toward dir in about 1s, splashes once below the board, and leaves', async (side, kind) => {
    const a = make(side, kind);
    a.setCarrying(side === 'land' ? 'sea' : 'land');
    const splashes: { id: string; at: THREE.Vector3; intensity: number }[] = [];
    const off = cast.on('splash', (p) => splashes.push(p));
    const r = await settle([a], a.fall(new THREE.Vector3(1, 0, 0)), 3);
    off();
    expect(r.done).toBe(true);
    expect(r.t).toBeGreaterThan(0.8);
    expect(r.t).toBeLessThan(1.45);
    expect(splashes).toHaveLength(1);
    expect(splashes[0].id).toBe(a.id);
    expect(splashes[0].at.x).toBeGreaterThan(1.5); // about one square (2 units) toward +x
    expect(splashes[0].at.y).toBeLessThan(0);
    expect(splashes[0].intensity).toBeGreaterThan(0);
    expect(a.object.parent).toBeNull();
    // Further actions are no-ops; dispose still frees it.
    await expect(a.moveTo(new THREE.Vector3(0, 0, 2))).resolves.toBeUndefined();
    a.dispose();
  });

  it('kings make the biggest splash; reduced motion falls quicker with zero intensity', async () => {
    const k: number[] = [];
    const off = cast.on('splash', (p) => k.push(p.intensity));
    const full = await settle([], make('sea', 'p').fall(new THREE.Vector3(0, 0, -1)), 3);
    await settle([], make('land', 'k').fall(new THREE.Vector3(0, 0, -1)), 3);
    cast.setReducedMotion(true);
    const short = await settle([], make('land', 'p').fall(new THREE.Vector3(0, 0, -1)), 3);
    cast.setReducedMotion(false);
    off();
    expect(k[1]).toBeGreaterThan(k[0]);
    expect(k[2]).toBe(0);
    expect(short.t).toBeLessThan(full.t);
  });

  it('a fall resolves on skip and still splashes', async () => {
    const a = make('land', 'r');
    let hits = 0;
    const off = cast.on('splash', () => hits++);
    let done = false;
    a.fall(new THREE.Vector3(0, 0, 1)).then(() => (done = true));
    await run([a], () => false, 0.1);
    cast.skipAll();
    await Promise.resolve();
    await Promise.resolve();
    off();
    expect(done).toBe(true);
    expect(hits).toBe(1);
    expect(a.object.parent).toBeNull();
    a.dispose();
  });

  it.each(ALL)('%s %s holds either treasure at a readable size', async (side, kind) => {
    const a = make(side, kind);
    for (const owner of SIDES) {
      a.setCarrying(owner);
      expect(a.carrying).toBe(owner);
      await run([a], () => false, 0.5);
      expect(extras(a)).toBe(owner === 'land' ? 1 : 2); // bone, or shell + pearl
      a.object.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) box.expandByObject(o); });
      const size = box.getSize(new THREE.Vector3());
      const w = Math.max(size.x, size.z) / a.sq;
      expect(w).toBeGreaterThan(0.18);
      expect(w).toBeLessThan(0.5);
      // Held near the animal, not floating off somewhere.
      const c = box.getCenter(new THREE.Vector3()).sub(a.object.position).divideScalar(a.sq);
      expect(Math.hypot(c.x, c.z)).toBeLessThan(0.6);
      expect(c.y).toBeGreaterThan(0.1);
      expect(c.y).toBeLessThan(a.height + 0.4);
    }
    a.setCarrying(null);
    expect(a.carrying).toBeNull();
    await run([a], () => false, 0.4);
    expect(extras(a)).toBe(0);
    a.dispose();
  });

  it('the treasure stays through moves, emotes and skins, and the carrier walks heavier', async () => {
    for (const side of SIDES) {
      const free = make(side, 'n');
      // One square (a Raid step).
      const t0 = await settle([free], free.moveTo(new THREE.Vector3(0, 0, 2)));
      const a = make(side, 'n');
      a.setCarrying(side === 'land' ? 'sea' : 'land');
      const t1 = await settle([a], a.moveTo(new THREE.Vector3(0, 0, 2)));
      expect(t1.t).toBeGreaterThan(t0.t);
      expect(t1.t).toBeLessThanOrEqual(1.2);
      a.emote('laugh');
      a.setSkin({ palette: PALETTES[side][1].id, accessory: ACCESSORIES[0].id });
      await settle([a], a.moveTo(new THREE.Vector3(2, 0, 4), { style: 'pushed' }));
      await run([a], () => false, 0.5);
      expect(a.carrying).not.toBeNull();
      expect(extras(a)).toBe((side === 'land' ? 2 : 1) + 1); // treasure + accessory
      free.dispose();
      a.dispose();
    }
  });

  it('anchored: one ring of dirt or sand, sunk and braced, and it clears', async () => {
    for (const side of SIDES) {
      const a = make(side, 'p');
      await run([a], () => false, 0.2);
      a.object.updateWorldMatrix(true, true);
      const y0 = a.bonePoint('body').y;
      a.setStatus('anchored');
      expect(a.statusKind).toBe('anchored');
      await run([a], () => false, 0.6);
      expect(extras(a)).toBe(1);
      expect(a.bonePoint('body').y).toBeLessThan(y0 - 0.05);
      await settle([a], a.moveTo(new THREE.Vector3(0, 0, 2)));
      expect(extras(a)).toBe(1);
      a.setStatus(null);
      await run([a], () => false, 0.6);
      expect(extras(a)).toBe(0);
      expect(a.bonePoint('body').y).toBeCloseTo(y0, 1);
      a.dispose();
    }
  });
});

describe('raid toss', () => {
  const world = new THREE.Group();
  const cast = createCast({ squareSize: 2, quality: 'high' });
  let n = 0;
  const make = (side: Side, kind: PieceKind, x = 0) => {
    const a = cast.createPiece({ id: `${side}-${kind}-toss-${n++}`, side, kind, square: 'a1' });
    a.object.position.x = x;
    world.add(a.object);
    return a;
  };
  const enemy = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
  /** Treasure meshes (non-skinned) that are actually showing. */
  const shown = (a: Actor) => {
    let k = 0;
    a.object.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
      let v = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) v &&= p.visible;
      if (v) k++;
    });
    return k;
  };
  const ALL = SIDES.flatMap((s) => KINDS.map((k) => [s, k] as [Side, PieceKind]));

  it.each(ALL)('%s %s turns, throws, lets go at about 0.3s, then settles back facing home', async (side, kind) => {
    const a = make(side, kind);
    const yaw0 = a.object.rotation.y;
    a.setCarrying(enemy(side));
    await run([a], () => false, 0.5);
    expect(shown(a)).toBeGreaterThan(0);
    // Two squares to the side (+x).
    const r = await settle([a], a.toss(new THREE.Vector3(4, 0, 0)), 2);
    expect(r.done).toBe(true);
    expect(r.t).toBeGreaterThan(0.25);
    expect(r.t).toBeLessThan(0.4);
    expect(a.forward().x).toBeGreaterThan(0.7);
    // Hidden at the release (the world flies it), still carried until integration clears it.
    expect(shown(a)).toBe(0);
    expect(a.carrying).toBe(enemy(side));
    a.setCarrying(null);
    await run([a], () => false, 0.5);
    expect(a.carrying).toBeNull();
    expect(a.object.children.length).toBeGreaterThan(0);
    let left = 0;
    a.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) left++; });
    expect(left).toBe(0);
    await run([a], () => !a.isBusy, 1.5);
    expect(a.isBusy).toBe(false);
    expect(Math.cos(a.object.rotation.y - yaw0)).toBeGreaterThan(0.99);
    a.dispose();
  });

  it('the catcher hops with its arms up, only right after a toss', async () => {
    for (const side of SIDES) {
      const owner = enemy(side);
      const thrower = make(side, 'r');
      const catcher = make(side, 'p', 4);
      const later = make(side, 'b', -4);
      thrower.setCarrying(owner);
      await run([thrower], () => false, 0.4);
      await settle([thrower, catcher], thrower.toss(catcher.worldPos()));
      thrower.setCarrying(null);
      await run([thrower, catcher], () => false, 0.5);
      catcher.setCarrying(owner);
      await run([catcher], () => false, 0.2);
      expect(catcher.eb('base').py).toBeGreaterThan(0.05);
      if (side === 'land') expect(catcher.eb('legFL').rx).toBeLessThan(-0.3);
      else expect(catcher.eb('clawR').rz).toBeGreaterThan(0.3);
      await run([catcher], () => false, 1);
      expect(catcher.eb('base').py).toBeCloseTo(0, 3);
      // A second pickup isn't a catch, and neither is one with no toss before it.
      catcher.setCarrying(null);
      later.setCarrying(owner);
      await run([later], () => false, 0.2);
      expect(later.eb('base').py).toBe(0);
      for (const a of [thrower, catcher, later]) a.dispose();
    }
  });

  it('skip resolves a toss at once and still lets go; reduced motion is quicker', async () => {
    const a = make('sea', 'q');
    a.setCarrying('land');
    await run([a], () => false, 0.4);
    let done = false;
    a.toss(new THREE.Vector3(0, 0, 4)).then(() => (done = true));
    await run([a], () => false, 0.05);
    cast.skipAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(shown(a)).toBe(0);
    a.setCarrying(null);
    const full = await settle([a], a.toss(new THREE.Vector3(0, 0, -4)), 2);
    cast.setReducedMotion(true);
    const short = await settle([a], a.toss(new THREE.Vector3(0, 0, 4)), 2);
    cast.setReducedMotion(false);
    expect(short.t).toBeLessThan(full.t);
    a.dispose();
  });

  it('a toss nobody clears shows the treasure again on the next action', async () => {
    const a = make('land', 'n');
    a.setCarrying('sea');
    await run([a], () => false, 0.4);
    await settle([a], a.toss(new THREE.Vector3(4, 0, 0)));
    await run([a], () => false, 1);
    expect(shown(a)).toBe(0);
    const p = a.moveTo(new THREE.Vector3(0, 0, 2));
    expect(shown(a)).toBeGreaterThan(0);
    await settle([a], p);
    a.dispose();
  });
});
