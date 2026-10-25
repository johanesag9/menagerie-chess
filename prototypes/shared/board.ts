import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const FILES = 'abcdefgh';

export interface BoardOptions {
  /** Colour of a square. fileIdx 0..7 (a..h), rankIdx 0..7 (1..8). */
  color: (fileIdx: number, rankIdx: number, isLight: boolean) => string;
  thickness?: number;
  gap?: number;
  bevel?: number;
  roughness?: number;
  clearcoat?: number;
  /** Optional frame around the squares. */
  frame?: { color: string; width: number; height: number; roughness?: number };
}

export interface Board {
  group: THREE.Group;
  top: number;
  /** Pieces live here, in board-local space, so they ride along if the board moves. */
  pieceLayer: THREE.Group;
  squareToLocal(sq: string): THREE.Vector3;
}

export function createBoard(o: BoardOptions): Board {
  const group = new THREE.Group();
  const thickness = o.thickness ?? 0.16;
  const gap = o.gap ?? 0.025;
  const geo = new RoundedBoxGeometry(1 - gap, thickness, 1 - gap, 3, o.bevel ?? 0.05);
  const mat = new THREE.MeshPhysicalMaterial({ roughness: o.roughness ?? 0.42, clearcoat: o.clearcoat ?? 0.4, clearcoatRoughness: 0.35 });
  const squares = new THREE.InstancedMesh(geo, mat, 64);
  squares.receiveShadow = true;
  squares.castShadow = true;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const i = f * 8 + r;
      m.makeTranslation(f - 3.5, thickness / 2, 3.5 - r);
      squares.setMatrixAt(i, m);
      squares.setColorAt(i, c.set(o.color(f, r, (f + r) % 2 === 1)));
    }
  }
  group.add(squares);

  if (o.frame) {
    const w = 8 + o.frame.width * 2;
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(w, o.frame.height, w, 4, Math.min(0.12, o.frame.height / 2.2)),
      new THREE.MeshPhysicalMaterial({ color: o.frame.color, roughness: o.frame.roughness ?? 0.55, clearcoat: 0.3 }),
    );
    frame.position.y = thickness / 2 - o.frame.height / 2 + 0.02;
    frame.receiveShadow = frame.castShadow = true;
    group.add(frame);
  }

  const pieceLayer = new THREE.Group();
  group.add(pieceLayer);

  return {
    group,
    pieceLayer,
    top: thickness,
    squareToLocal(sq: string) {
      const f = FILES.indexOf(sq[0]);
      const r = Number(sq[1]) - 1;
      return new THREE.Vector3(f - 3.5, thickness, 3.5 - r);
    },
  };
}
