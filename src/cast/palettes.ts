/**
 * Skins: palettes (slot colours per side) and accessory colours.
 * Land: Meadow (natural), Porcelain, Candy, Gilded. Sea: Lagoon (natural), Abyss, Coral, Pearl.
 * `teamBase` and `teamRim` never change, so the sides stay readable whatever the skin.
 */
import * as THREE from 'three';
import type { PieceKind, Side } from '../contracts/types';
import { FINISH, SLOTS, type Finish, type Slot, type SlotTable } from './material';
import type { AnimalDef } from './animals/common';

const F = FINISH;
/** A softer glow than FINISH.glow, so neon accents keep their colour instead of clipping to white. */
const NEON: Finish = { r: 0.35, m: 0, c: 0.6, e: 0.55 };

export const TEAM: Record<Side, { base: string; rim: string }> = {
  land: { base: '#f3e3c3', rim: '#d9a441' },
  sea: { base: '#1d5a70', rim: '#7fe0d8' },
};

/** Default finish per slot. */
const BASE_FINISH: Record<Slot, Finish> = {
  main: F.toy, second: F.toy, accent: F.toy, dark: F.toy, light: F.toy, pink: F.gloss,
  eyeWhite: F.eye, pupil: F.gloss, glint: F.glint, gold: F.gold, iris: F.eye, cheek: F.soft,
  extra: F.toy, extra2: F.toy, teamBase: F.toy, teamRim: F.gloss,
  acc1: F.toy, acc2: F.toy, acc3: F.toy, acc4: F.toy,
};

const BASE_COLOR: Record<Slot, string> = {
  main: '#cccccc', second: '#eeeeee', accent: '#d04040', dark: '#2a1a14', light: '#ffffff', pink: '#f27d8c',
  eyeWhite: '#fbfaf6', pupil: '#16121a', glint: '#ffffff', gold: '#f2c14e', iris: '#5a3a24', cheek: '#ff8f9c',
  extra: '#999999', extra2: '#999999', teamBase: '#ffffff', teamRim: '#ffffff',
  acc1: '#ffffff', acc2: '#ffffff', acc3: '#ffffff', acc4: '#ffffff',
};

/** The animal's natural look, with its side's team colours. */
export function naturalTable(def: AnimalDef): SlotTable {
  const t = {} as SlotTable;
  for (const s of SLOTS) t[s] = { color: def.colors[s] ?? BASE_COLOR[s], finish: def.finishes?.[s] ?? BASE_FINISH[s] };
  t.teamBase = { color: TEAM[def.side].base, finish: F.toy };
  t.teamRim = { color: TEAM[def.side].rim, finish: F.gloss };
  return t;
}

// ---------- palettes ----------

export interface Palette {
  id: string;
  name: string;
  /** UI swatch colour. */
  swatch: string;
  /** Changes on top of the natural table. Body slots only; face and team slots are kept unless set. */
  apply?(t: SlotTable, kind: PieceKind): Partial<SlotTable>;
}

const BODY: Slot[] = ['main', 'second', 'accent', 'dark', 'light', 'extra', 'extra2'];
const lum = (hex: string) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
/** Map each body slot to one of two colours by its natural lightness (keeps the animal's pattern readable). */
function twoTone(t: SlotTable, darkC: string, lightC: string, finish: Finish, mid?: string): Partial<SlotTable> {
  const out: Partial<SlotTable> = {};
  for (const s of BODY) {
    const l = lum(t[s].color);
    const color = l > 0.45 ? lightC : mid && l > 0.18 ? mid : darkC;
    out[s] = { color, finish };
  }
  return out;
}

const CANDY: Record<PieceKind, [string, string]> = {
  p: ['#ff9ec7', '#fff1f7'], n: ['#9fe3c9', '#f2fff9'], b: ['#c9b6ff', '#f7f3ff'],
  r: ['#ffd27a', '#fff8e6'], q: ['#ff9f8a', '#fff1ec'], k: ['#8fd0ff', '#f0f9ff'],
};
const CORAL: Record<PieceKind, [string, string]> = {
  p: ['#ff6f61', '#ffd3c4'], n: ['#ff9b54', '#ffe1c2'], b: ['#ff7aa2', '#ffe0ea'],
  r: ['#f25c54', '#ffd8cf'], q: ['#e8579a', '#ffd6ea'], k: ['#ff8a70', '#ffe3d9'],
};

export const PALETTES: Record<Side, Palette[]> = {
  land: [
    { id: 'meadow', name: 'Meadow', swatch: '#c0703c' },
    {
      id: 'porcelain', name: 'Porcelain', swatch: '#2a4d9b',
      apply: (t) => ({
        ...twoTone(t, '#1f3f8f', '#f6f7fb', F.porcelain, '#4f74c8'),
        pink: { color: '#7d9be0', finish: F.porcelain },
        cheek: { color: '#9db4ec', finish: F.soft },
        iris: { color: '#2a4d9b', finish: F.eye },
      }),
    },
    {
      id: 'candy', name: 'Candy', swatch: '#ff9ec7',
      apply: (t, k) => ({
        ...twoTone(t, CANDY[k][0], CANDY[k][1], F.gloss, CANDY[k][0]),
        dark: { color: '#7a4a6a', finish: F.gloss },
        cheek: { color: '#ff7fae', finish: F.soft },
      }),
    },
    {
      id: 'gilded', name: 'Gilded', swatch: '#e2b23a',
      apply: (t) => ({
        ...twoTone(t, '#3a2a1a', '#f2c14e', F.gold, '#c8962e'),
        accent: { color: '#9e1b32', finish: F.gloss },
        pink: { color: '#e88a7a', finish: F.gloss },
        gold: { color: '#fff1b8', finish: F.gold },
      }),
    },
  ],
  sea: [
    { id: 'lagoon', name: 'Lagoon', swatch: '#2fa7a0' },
    {
      id: 'abyss', name: 'Abyss', swatch: '#2c1f50',
      apply: (t) => ({
        ...twoTone(t, '#1a1230', '#46307a', F.gloss, '#2c1f50'),
        light: { color: '#3fd8ff', finish: NEON },
        extra2: { color: '#ff4fd8', finish: NEON },
        accent: { color: '#3fd8ff', finish: NEON },
        iris: { color: '#5effe0', finish: { r: 0.1, m: 0, c: 1, e: 0.9 } },
        cheek: { color: '#ff4fd8', finish: NEON },
        gold: { color: '#c9d6ff', finish: F.metal },
        pink: { color: '#ff4fd8', finish: NEON },
      }),
    },
    {
      id: 'coral', name: 'Coral', swatch: '#ff6f61',
      apply: (t, k) => ({
        ...twoTone(t, CORAL[k][0], CORAL[k][1], F.toy, CORAL[k][0]),
        dark: { color: '#7a2a2a', finish: F.toy },
        accent: { color: '#ffd166', finish: F.gloss },
      }),
    },
    {
      id: 'pearl', name: 'Pearl', swatch: '#efe6f2',
      apply: (t) => ({
        ...twoTone(t, '#b9a6d6', '#f6f0f4', F.pearl, '#dcd0ea'),
        dark: { color: '#5a4a6a', finish: F.gloss },
        accent: { color: '#9fd6e8', finish: F.pearl },
        gold: { color: '#e8e2f0', finish: F.metal },
      }),
    },
  ],
};

export const DEFAULT_PALETTE: Record<Side, string> = { land: 'meadow', sea: 'lagoon' };

export function paletteTable(def: AnimalDef, paletteId: string | undefined): SlotTable {
  const t = naturalTable(def);
  const pal = PALETTES[def.side].find((p) => p.id === paletteId);
  if (pal?.apply) Object.assign(t, pal.apply(t, def.kind));
  return t;
}
