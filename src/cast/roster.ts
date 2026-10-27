/** Builds and caches one rig template per animal. The body is scaled so each animal hits its target height. */
import * as THREE from 'three';
import type { PieceKind, QualityTier, Side } from '../contracts/types';
import { PEDESTAL_H, Rig, detail, type RigTemplate } from './kit';
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

/** `low` quality builds with ~60% of the segments (for phones). */
export function getTemplate(side: Side, kind: PieceKind, quality: QualityTier = 'high'): AnimalTemplate {
  const key = side + kind + quality;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = ROSTER[side][kind];
  const rig = new Rig();
  detail.k = quality === 'low' ? 0.6 : 1;
  try {
    def.build(rig);
  } finally {
    detail.k = 1;
  }
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.root, true);
  const scale = (def.targetHeight - PEDESTAL_H) / Math.max(0.05, box.max.y - PEDESTAL_H);
  rig.get('body').scale.setScalar(scale);
  snapMouth(rig);
  // Glasses sit in front of the eyes, sized to their spacing.
  const eye = rig.get('eyeR');
  const er = (eye.userData.r as number) * Math.max(eye.scale.x, eye.scale.y);
  const face: Anchor = { bone: eye.parent!.name, p: [0, eye.position.y, eye.position.z + er * 0.85], w: eye.position.x, lr: er };
  const t: AnimalTemplate = { def, rig: rig.compile(), height: def.targetHeight, anchors: { ...def.anchors, face } };
  cache.set(key, t);
  return t;
}

/**
 * Slide the mouth onto the face surface: cast a short ray from just in front of the mouth back
 * toward it, against the head and body shapes (not legs, trunks, tentacles or eyes), and sit the
 * mouth there. Keeps every expression visible without hand-tuning each face.
 */
function snapMouth(rig: Rig) {
  const mf = rig.root.getObjectByName('mouthFrame');
  if (!mf?.parent) return;
  rig.root.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    let b: THREE.Object3D | null = o.parent;
    while (b && !(b as THREE.Bone).isBone) b = b.parent;
    if (b && (b.name === 'head' || b.name === 'body')) meshes.push(o);
  });
  const pos = mf.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(mf.matrixWorld);
  const ray = new THREE.Raycaster(pos.clone().addScaledVector(fwd, 0.15), fwd.clone().negate(), 0, 0.3);
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return;
  const target = hit.point.clone().addScaledVector(fwd, 0.004);
  if (target.distanceTo(pos) > 0.08) return;
  mf.position.copy(mf.parent.worldToLocal(target));
}
