/** Builds and caches one rig template per animal. The body is scaled so each animal hits its target height. */
import * as THREE from 'three';
import type { PieceKind, Side } from '../contracts/types';
import { PEDESTAL_H, Rig, type RigTemplate } from './kit';
import { LAND } from './animals/land';
import { SEA } from './animals/sea';
import type { AnimalDef, Anchor } from './animals/common';

export interface AnimalTemplate {
  def: AnimalDef;
  rig: RigTemplate;
  /** Top of the animal in square units (pedestal included). */
  height: number;
  /** Accessory anchors; the face anchor is derived from the eyes. */
  anchors: { top: Anchor; face: Anchor; neck: Anchor };
}

export const ROSTER: Record<Side, Record<PieceKind, AnimalDef>> = { land: LAND, sea: SEA };
export const KINDS: PieceKind[] = ['p', 'n', 'b', 'r', 'q', 'k'];

const cache = new Map<string, AnimalTemplate>();

export function getTemplate(side: Side, kind: PieceKind): AnimalTemplate {
  const key = side + kind;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = ROSTER[side][kind];
  const rig = new Rig();
  def.build(rig);
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.root, true);
  const scale = (def.targetHeight - PEDESTAL_H) / Math.max(0.05, box.max.y - PEDESTAL_H);
  rig.get('body').scale.setScalar(scale);
  // Glasses sit in front of the eyes, sized to their spacing.
  const eye = rig.get('eyeR');
  const er = (eye.userData.r as number) * Math.max(eye.scale.x, eye.scale.y);
  const face: Anchor = { bone: eye.parent!.name, p: [0, eye.position.y, eye.position.z + er * 0.85], w: eye.position.x, lr: er };
  const t: AnimalTemplate = { def, rig: rig.compile(), height: def.targetHeight, anchors: { ...def.anchors, face } };
  cache.set(key, t);
  return t;
}
