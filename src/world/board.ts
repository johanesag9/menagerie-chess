/**
 * The 8x8 board in its wooden frame. Ranks 1-4 are meadow squares, 5-8 beach squares.
 * Everything sits in `group` (board-local space); pieces go in `pieceLayer`, a child of it,
 * so pieces ride along when the board wobbles.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_TOP, FRAME_H, FRAME_W, PALETTE, SQUARE, TILE_H } from './constants';
import { FILES } from './coords';
import { type Bin, type Materials, StaticBatch, seeded } from './kit';
import type { Textures } from './textures';

export interface Board {
  group: THREE.Group;
  pieceLayer: THREE.Group;
  /** Highlights and board-riding effects go here. */
  overlay: THREE.Group;
  labels: THREE.Mesh;
  squares: THREE.InstancedMesh;
  /** Base colour of each square, index = file * 8 + rank. */
  baseColors: THREE.Color[];
}

export function squareColor(file: number, rank: number): string {
  const light = (file + rank) % 2 === 1;
  if (rank < 4) return light ? PALETTE.meadowLight : PALETTE.meadowDark;
  return light ? PALETTE.beachLight : PALETTE.beachDark;
}

export function createBoard(bin: Bin, mats: Materials, tex: Textures): Board {
  const group = new THREE.Group();
  group.name = 'board';
  const rnd = seeded(8);

  // Squares: one instanced draw call.
  const tileGeo = bin.add(new RoundedBoxGeometry(SQUARE * 0.975, TILE_H, SQUARE * 0.975, 3, 0.045));
  const tileMat = bin.add(new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.32 }));
  const squares = new THREE.InstancedMesh(tileGeo, tileMat, 64);
  squares.name = 'squares';
  squares.receiveShadow = true;
  squares.castShadow = true;
  const m = new THREE.Matrix4();
  const baseColors: THREE.Color[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const i = f * 8 + r;
      // Tiny random lift + tilt so it feels hand-placed, like a toy.
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.004, 0, (rnd() - 0.5) * 0.004));
      m.compose(new THREE.Vector3((f - 3.5) * SQUARE, BOARD_TOP - TILE_H / 2 - rnd() * 0.004, (3.5 - r) * SQUARE), tilt, new THREE.Vector3(1, 1, 1));
      squares.setMatrixAt(i, m);
      const c = new THREE.Color(squareColor(f, r)).offsetHSL((rnd() - 0.5) * 0.012, 0, (rnd() - 0.5) * 0.03);
      baseColors.push(c.clone());
      squares.setColorAt(i, c);
    }
  }
  group.add(squares);

  // Frame: an outer wooden rim and a darker inner bed the tiles sit in.
  const outer = 8 * SQUARE + FRAME_W * 2;
  const frameTop = BOARD_TOP - 0.05;
  const batch = new StaticBatch(bin);
  const rimGeo = bin.add(new RoundedBoxGeometry(outer, FRAME_H, outer, 4, 0.12));
  batch.put(rimGeo, mats.get(PALETTE.frame, 'wood'), [0, frameTop - FRAME_H / 2, 0]);
  const bedGeo = bin.add(new RoundedBoxGeometry(8 * SQUARE + 0.06, 0.1, 8 * SQUARE + 0.06, 2, 0.03));
  batch.put(bedGeo, mats.get(PALETTE.frameDark, 'wood'), [0, frameTop + 0.001 - 0.05 + 0.002, 0]);
  // Little brass corner studs.
  const stud = bin.add(new THREE.SphereGeometry(0.075, 16, 10));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    batch.put(stud, mats.get('#e2b45a', 'metal'), [sx * (outer / 2 - FRAME_W / 2), frameTop + 0.005, sz * (outer / 2 - FRAME_W / 2)], [0, 0, 0], [1, 0.45, 1]);
  }
  group.add(batch.build('frame'));

  const labels = createLabels(bin, tex.labels, frameTop + 0.004);
  group.add(labels);

  const overlay = new THREE.Group();
  overlay.name = 'overlay';
  group.add(overlay);

  const pieceLayer = new THREE.Group();
  pieceLayer.name = 'pieceLayer';
  group.add(pieceLayer);

  return { group, pieceLayer, overlay, labels, squares, baseColors };
}

/** a..h and 1..8 on the frame, readable from both the Land and the Sea side, in one mesh. */
function createLabels(bin: Bin, atlas: THREE.Texture, y: number): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const size = 0.3;
  const edge = 4 * SQUARE + FRAME_W / 2;
  const glyph = (i: number, x: number, z: number, yaw: number) => {
    const g = new THREE.PlaneGeometry(size, size);
    const col = i % 4, row = Math.floor(i / 4);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 4);
    }
    g.rotateX(-Math.PI / 2);
    g.rotateY(yaw);
    g.translate(x, y, z);
    geos.push(g);
  };
  for (let f = 0; f < 8; f++) {
    const x = (f - 3.5) * SQUARE;
    glyph(f, x, edge, 0); // Land edge, upright for Land
    glyph(f, x, -edge, Math.PI); // Sea edge, upright for Sea
  }
  for (let r = 0; r < 8; r++) {
    const z = (3.5 - r) * SQUARE;
    glyph(8 + r, -edge, z, 0);
    glyph(8 + r, edge, z, Math.PI);
  }
  const merged = mergeLabelGeos(geos);
  const mat = bin.add(new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, toneMapped: false }));
  const mesh = new THREE.Mesh(bin.add(merged), mat);
  mesh.name = 'coordinates';
  mesh.renderOrder = 1;
  return mesh;
}

function mergeLabelGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    for (const i of g.index!.array) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

export { FILES };
