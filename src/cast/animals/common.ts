/**
 * Shared bits for the animal builders.
 *
 * Bone names every animal may use (styles look them up by name; a missing bone is simply skipped):
 * - `base` (pedestal), `body` (whole animal, origin at its feet on the pedestal top: squash pivot)
 * - `head`, `eyeL/R`, `lookL/R`, `mSmile/mOpen/mO/mFrown`, `brows`
 * - quadruped legs `legFL/FR/BL/BR`, front paws of sitters `pawL/R`
 * - `tail1..3`, `earL/R`, plus per-animal parts (trunk1..3, clawL/R, jawL/R, finL/R, t0a..t7c ...)
 *
 * Every animal faces +Z. Units are squares: the pedestal is ~0.78 wide.
 */
import type { PieceKind, Side } from '../../contracts/types';
import { FINISH, type Finish, type Slot } from '../material';
import { PEDESTAL_H, Rig, Taper, pedestal, type V3 } from '../kit';

export interface Anchor {
  bone: string;
  p: V3;
  r?: V3;
  s?: number;
  /** Face anchors: half the eye spacing and the eye radius (unscaled), so glasses fit. */
  w?: number;
  lr?: number;
}

export interface AnimalDef {
  side: Side;
  kind: PieceKind;
  name: string;
  /** Wanted top of the animal (with pedestal and crown), in square units. The body is scaled to fit. */
  targetHeight: number;
  build(rig: Rig): void;
  /** Natural palette (colour per slot). */
  colors: Partial<Record<Slot, string>>;
  /** Finish overrides per slot (default: toy). */
  finishes?: Partial<Record<Slot, Finish>>;
  /** Where accessories sit: on top of the head, on the eyes, at the neck. */
  anchors: { top: Anchor; face: Anchor; neck: Anchor };
}

/** Pedestal plus the `body` bone at the pedestal top. */
export function start(rig: Rig) {
  pedestal(rig);
  return rig.bone('body', 'base', [0, PEDESTAL_H, 0]);
}

/** A leg bone at the hip with a capsule hanging down and a foot. Returns the bone. */
export function leg(rig: Rig, name: string, parent: string, hip: V3, len: number, r: number, slot: Slot, foot?: { slot: Slot; r?: number; h?: number }) {
  const b = rig.bone(name, parent, hip);
  rig.add(b, Taper([[0, 0, 0], [0, -len * 0.55, 0.004], [0, -len, 0]], r, r * 0.85, 8, 10), slot);
  if (foot) {
    const fr = foot.r ?? r * 1.1;
    const fh = foot.h ?? fr * 0.9;
    rig.add(b, Taper([[0, -len + fh * 0.5, 0], [0, -len - fh * 0.2, 0]], fr, fr * 1.04, 3, 12), foot.slot);
  }
  return b;
}

/**
 * A chain of bones with tapered segments (tails, trunks, tentacles).
 * `segs` are the segment vectors, each in the previous bone's space. Bones are named prefix1..N.
 */
export function chain(rig: Rig, prefix: string, parent: string, at: V3, segs: V3[], r0: number, r1: number, slot: Slot | ((i: number) => Slot), names?: string[]) {
  let par = parent;
  let p = at;
  const n = segs.length;
  const out: string[] = [];
  segs.forEach((v, i) => {
    const name = names?.[i] ?? prefix + (i + 1);
    rig.bone(name, par, p);
    const ra = r0 + (r1 - r0) * (i / n);
    const rb = r0 + (r1 - r0) * ((i + 1) / n);
    const mid: V3 = [v[0] * 0.5, v[1] * 0.5, v[2] * 0.5];
    rig.add(name, Taper([[0, 0, 0], mid, v], ra, rb, 8, 9), typeof slot === 'function' ? slot(i) : slot);
    par = name;
    p = v;
    out.push(name);
  });
  return out;
}

export const F = FINISH;
