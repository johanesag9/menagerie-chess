/**
 * The "slot" toy material. Every vertex carries a `slot` index (0..SLOT_COUNT-1). The colour,
 * roughness, metalness, clearcoat and glow of each slot come from uniform arrays, so one shader
 * program serves every animal, and a skin swap is just new uniform values (no new geometry).
 */
import * as THREE from 'three';

export const SLOTS = [
  'main', 'second', 'accent', 'dark', 'light', 'pink',
  'eyeWhite', 'pupil', 'glint', 'gold', 'iris', 'cheek',
  'extra', 'extra2', 'teamBase', 'teamRim',
  'acc1', 'acc2', 'acc3', 'acc4',
] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_COUNT = SLOTS.length;
export const slotIndex = (s: Slot) => SLOTS.indexOf(s);

/** Finish of one slot: roughness, metalness, clearcoat, emissive (glow strength). */
export interface Finish { r: number; m: number; c: number; e: number }
export const FINISH = {
  toy: { r: 0.52, m: 0, c: 0.3, e: 0 },
  soft: { r: 0.7, m: 0, c: 0.05, e: 0 },
  gloss: { r: 0.22, m: 0, c: 1, e: 0 },
  eye: { r: 0.1, m: 0, c: 1, e: 0.04 },
  glint: { r: 0.2, m: 0, c: 0, e: 2.2 },
  gold: { r: 0.3, m: 1, c: 0.6, e: 0 },
  glow: { r: 0.4, m: 0, c: 0, e: 1.6 },
  porcelain: { r: 0.16, m: 0, c: 1, e: 0 },
  metal: { r: 0.26, m: 1, c: 0.5, e: 0 },
  pearl: { r: 0.2, m: 0.35, c: 1, e: 0 },
} satisfies Record<string, Finish>;

export interface SlotStyle { color: string; finish: Finish }
export type SlotTable = Record<Slot, SlotStyle>;

export interface SlotUniforms {
  uSlotColor: { value: THREE.Color[] };
  uSlotMat: { value: THREE.Vector4[] };
  /** 0..1 flash to white (hit / pop). */
  uFlash: { value: number };
  /** Fresnel rim glow: rgb colour, a = strength. Hover and selection raise it. */
  uRim: { value: THREE.Vector4 };
}

const PROGRAM_KEY = 'cast-slot-v1';

/** `lite` drops the clearcoat layer (cheaper pixels, for the 'low' quality tier). */
export function createSlotMaterial(table: SlotTable, lite = false): THREE.MeshPhysicalMaterial & { userData: { u: SlotUniforms } } {
  const u: SlotUniforms = {
    uSlotColor: { value: SLOTS.map(() => new THREE.Color()) },
    uSlotMat: { value: SLOTS.map(() => new THREE.Vector4()) },
    uFlash: { value: 0 },
    uRim: { value: new THREE.Vector4(1, 0.92, 0.8, 0.18) },
  };
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: lite ? 0 : 1, clearcoatRoughness: 0.4 });
  m.userData.u = u;
  applySlotTable(m as never, table);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vSlot;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSlot = slot;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSlot;
uniform vec3 uSlotColor[${SLOT_COUNT}];
uniform vec4 uSlotMat[${SLOT_COUNT}];
uniform float uFlash;
uniform vec4 uRim;`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `int sIdx = int( vSlot + 0.5 );
vec4 sMat = uSlotMat[ sIdx ];
vec4 diffuseColor = vec4( uSlotColor[ sIdx ], opacity );`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = sMat.x;\nmetalnessFactor = sMat.y;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = sMat.z;\n#endif')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
totalEmissiveRadiance += diffuseColor.rgb * sMat.w + uRim.rgb * uRim.a * rimF;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight = mix( outgoingLight, vec3( 1.0 ), uFlash );
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => PROGRAM_KEY;
  return m as never;
}

export function applySlotTable(m: { userData: { u: SlotUniforms } }, table: Partial<SlotTable>): void {
  const u = m.userData.u;
  for (const [name, style] of Object.entries(table) as [Slot, SlotStyle][]) {
    const i = slotIndex(name);
    u.uSlotColor.value[i].set(style.color);
    const f = style.finish;
    u.uSlotMat.value[i].set(f.r, f.m, f.c, f.e);
  }
}
