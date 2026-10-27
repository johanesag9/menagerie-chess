/** Sizes and colours for the shoreline diorama. Change the look here. */

/** One square is one world unit. Pieces scale to this. */
export const SQUARE = 1;
/** Height of the board's playing surface above the diorama origin (board-local y). */
export const BOARD_TOP = 0.36;
/** Thickness of one square tile. */
export const TILE_H = 0.16;
/** Wooden frame around the 8x8 squares. */
export const FRAME_W = 0.42;
export const FRAME_H = 0.34;

/** Diorama base (wooden display stand) footprint. */
export const BASE_W = 18;
export const BASE_D = 17;

export const PALETTE = {
  meadowLight: '#f7efd9',
  meadowDark: '#8fc46c',
  beachLight: '#f6e2b3',
  beachDark: '#4fb7c2',
  frame: '#c99a63',
  frameDark: '#a8794a',
  base: '#7a4b2f',
  baseTrim: '#5e3820',
  sand: '#f1d9a6',
  grass: '#8cc265',
  grassBlade: '#6fae4a',
  waterDeep: '#2b86b0',
  waterShallow: '#79dcd6',
  skyTop: '#7fb2ec',
  skyMid: '#ffdcb6',
  skyBottom: '#f4ad86',
  sun: '#ffd29e',
  hemiSky: '#cfe3ff',
  hemiGround: '#f2c79b',
  fog: '#ffdcb6',
  // Highlights
  selected: '#ffe28a',
  legal: '#2f3b45',
  capture: '#ff6b5a',
  lastMove: '#ffc65c',
  check: '#ff3b3b',
  label: '#5b3a20',
} as const;
