/**
 * Flat animal face icons drawn in SVG, one per side and piece. First-pass art, built in code:
 * used for the captured tray, the promotion picker, player cards and the customize preview.
 */
import type { PieceKind, Side } from '../contracts/types';

const INK = '#3b2a1e';

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const eyes = (lx: number, rx: number, y: number, r = 1.7) =>
  `<circle cx="${lx}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${rx}" cy="${y}" r="${r}" fill="${INK}"/>` +
  `<circle cx="${lx + r * 0.35}" cy="${y - r * 0.4}" r="${r * 0.38}" fill="#fff"/><circle cx="${rx + r * 0.35}" cy="${y - r * 0.4}" r="${r * 0.38}" fill="#fff"/>`;

const crown = (y: number) =>
  `<path d="M9.5 ${y + 7} L10 ${y} L13 ${y + 4} L16 ${y - 1} L19 ${y + 4} L22 ${y} L22.5 ${y + 7} Z" fill="#f6c445" stroke="#b9771a" stroke-width="1.2" stroke-linejoin="round"/>`;

type Draw = (c: string) => string;

/** Each animal's natural main colour (what the "default" palette looks like). */
export const NATURAL: Record<Side, Record<PieceKind, string>> = {
  land: { p: '#b86b35', n: '#8b5a3c', b: '#ede3d1', r: '#9aa3ae', q: '#f0a04b', k: '#e3c08f' },
  sea: { p: '#e5604d', n: '#f2a03c', b: '#f6d35b', r: '#4e9a5b', q: '#9b6fc9', k: '#f2a7b4' },
};

const LAND: Record<PieceKind, Draw> = {
  // Dachshund pup: long floppy ears.
  p: (c) => `
    <ellipse cx="7.5" cy="17" rx="4" ry="8" fill="${shade(c, -0.3)}"/><ellipse cx="24.5" cy="17" rx="4" ry="8" fill="${shade(c, -0.3)}"/>
    <ellipse cx="16" cy="15" rx="9" ry="9" fill="${c}"/>
    <ellipse cx="16" cy="21" rx="5.5" ry="4.2" fill="${shade(c, 0.45)}"/>
    <ellipse cx="16" cy="19.2" rx="2.2" ry="1.6" fill="${INK}"/>${eyes(12, 20, 13.5)}`,
  // Horse: long face, blaze, ears and mane.
  n: (c) => `
    <path d="M10 9 L11.5 2.5 L15 7 Z M22 9 L20.5 2.5 L17 7 Z" fill="${shade(c, -0.2)}"/>
    <rect x="9" y="5" width="14" height="23" rx="7" fill="${c}"/>
    <path d="M13 5 Q16 1 19 5 Q16 8 13 5Z" fill="${shade(c, -0.45)}"/>
    <rect x="14.6" y="8" width="2.8" height="11" rx="1.4" fill="#fff8ec"/>
    <ellipse cx="16" cy="24" rx="6.3" ry="4.5" fill="${shade(c, 0.35)}"/>
    <circle cx="13.6" cy="24.5" r="1" fill="${INK}"/><circle cx="18.4" cy="24.5" r="1" fill="${INK}"/>${eyes(12, 20, 13)}`,
  // Mountain goat: curled horns and a beard.
  b: (c) => `
    <path d="M12 10 C9 3 3 5 5 11" fill="none" stroke="#9c8466" stroke-width="3" stroke-linecap="round"/>
    <path d="M20 10 C23 3 29 5 27 11" fill="none" stroke="#9c8466" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="6" cy="16" rx="4.2" ry="2" fill="${shade(c, -0.12)}" transform="rotate(20 6 16)"/>
    <ellipse cx="26" cy="16" rx="4.2" ry="2" fill="${shade(c, -0.12)}" transform="rotate(-20 26 16)"/>
    <ellipse cx="16" cy="17" rx="8" ry="9" fill="${c}"/>
    <path d="M13.5 24 L18.5 24 L16 31 Z" fill="${shade(c, -0.18)}"/>
    <ellipse cx="16" cy="22" rx="2" ry="1.3" fill="${shade(c, -0.5)}"/>${eyes(12.5, 19.5, 15.5)}`,
  // Elephant with a little tower on its head.
  r: (c) => `
    <ellipse cx="6" cy="15" rx="6" ry="8" fill="${shade(c, -0.15)}"/><ellipse cx="26" cy="15" rx="6" ry="8" fill="${shade(c, -0.15)}"/>
    <path d="M11 8 V2.5 H13 V4.5 H15 V2.5 H17 V4.5 H19 V2.5 H21 V8 Z" fill="#c9a27a" stroke="#8a6440" stroke-width="1"/>
    <circle cx="16" cy="15" r="8" fill="${c}"/>
    <path d="M16 18 C16 25 16 28 20.5 28.5" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M16 18 C16 25 16 28 20.5 28.5" fill="none" stroke="${shade(c, -0.2)}" stroke-width="1" stroke-dasharray="1 2.5"/>${eyes(12.5, 19.5, 13)}`,
  // Cat: pointy ears and whiskers.
  q: (c) => `
    <path d="M6.5 14 L8 3 L14.5 10 Z M25.5 14 L24 3 L17.5 10 Z" fill="${c}"/>
    <path d="M8.5 11 L9.2 6 L12.3 9.5 Z M23.5 11 L22.8 6 L19.7 9.5 Z" fill="#f4a7b0"/>
    <ellipse cx="16" cy="18" rx="10.5" ry="8.5" fill="${c}"/>
    <path d="M14.3 20 H17.7 L16 22 Z" fill="#e0707f"/>
    <path d="M4 19 L10 20 M4 23 L10 21.5 M28 19 L22 20 M28 23 L22 21.5" stroke="${INK}" stroke-width="0.8" stroke-linecap="round"/>
    <ellipse cx="12" cy="17" rx="1.6" ry="2.2" fill="${INK}"/><ellipse cx="20" cy="17" rx="1.6" ry="2.2" fill="${INK}"/>`,
  // Pug in a crown.
  k: (c) => `
    <path d="M6 12 L10 9 L9 16 Z M26 12 L22 9 L23 16 Z" fill="#4a3426"/>
    <ellipse cx="16" cy="18.5" rx="10" ry="9" fill="${c}"/>
    <ellipse cx="16" cy="22.5" rx="6.2" ry="4.6" fill="#4a3426"/>
    <ellipse cx="16" cy="20.5" rx="2" ry="1.2" fill="#1d130c"/>${eyes(11, 21, 16, 2.3)}${crown(4)}`,
};

const SEA: Record<PieceKind, Draw> = {
  // Crab: claws up, eyes on stalks.
  p: (c) => `
    <path d="M9 18 L5 12 M23 18 L27 12" stroke="${shade(c, -0.15)}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="5" cy="10" r="4" fill="${c}"/><circle cx="27" cy="10" r="4" fill="${c}"/>
    <path d="M5 10 L3 5.5 L7.5 7 Z M27 10 L29 5.5 L24.5 7 Z" fill="#fff8ec"/>
    <path d="M13 15 L12 8 M19 15 L20 8" stroke="${shade(c, -0.15)}" stroke-width="1.8" stroke-linecap="round"/>
    <ellipse cx="16" cy="21" rx="10.5" ry="7" fill="${c}"/>
    <circle cx="12" cy="8" r="2.6" fill="#fff"/><circle cx="20" cy="8" r="2.6" fill="#fff"/>
    <circle cx="12.4" cy="8.3" r="1.3" fill="${INK}"/><circle cx="20.4" cy="8.3" r="1.3" fill="${INK}"/>
    <path d="M13 22 Q16 24.5 19 22" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`,
  // Seahorse in profile, curly tail.
  n: (c) => `
    <path d="M18 9 C25 11 25 18 20 20 C24 23 22 28 18 28 C14.5 28 15 24.5 17.5 24.5" fill="none" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M24 13 L28 15 L24.5 18 Z" fill="${shade(c, 0.3)}"/>
    <path d="M14 7 L6.5 8.5 L6.5 11 L14 11.5 Z" fill="${c}"/>
    <circle cx="17" cy="8.5" r="5" fill="${c}"/>
    <path d="M15 4 L16.5 0.8 L18 4 L20 1.8 L20.5 5 Z" fill="${shade(c, -0.2)}"/>
    <circle cx="18" cy="7.6" r="1.5" fill="${INK}"/><circle cx="18.5" cy="7.1" r="0.55" fill="#fff"/>`,
  // Pufferfish: round and spiky.
  b: (c) => {
    let spikes = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = 16 + Math.cos(a) * 13.2, y = 17 + Math.sin(a) * 13.2;
      const l = a - 0.22, r = a + 0.22;
      spikes += `<path d="M${(16 + Math.cos(l) * 9.5).toFixed(1)} ${(17 + Math.sin(l) * 9.5).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(16 + Math.cos(r) * 9.5).toFixed(1)} ${(17 + Math.sin(r) * 9.5).toFixed(1)}Z" fill="${shade(c, -0.25)}"/>`;
    }
    return `${spikes}<circle cx="16" cy="17" r="10.3" fill="${c}"/>
      <ellipse cx="16" cy="22" rx="7" ry="4.5" fill="${shade(c, 0.5)}"/>
      <circle cx="16" cy="21" r="1.7" fill="#e0707f"/>${eyes(11.8, 20.2, 14, 2.2)}`;
  },
  // Sea turtle with a lighthouse on its shell.
  r: (c) => `
    <circle cx="16" cy="26" r="4.2" fill="#9ccb8a"/>
    <circle cx="14.4" cy="26.2" r="0.9" fill="${INK}"/><circle cx="17.6" cy="26.2" r="0.9" fill="${INK}"/>
    <path d="M3.5 24 C3.5 12 28.5 12 28.5 24 Z" fill="${c}"/>
    <path d="M9 23 L11 17 L16 15.5 L21 17 L23 23 M11 17 L8 21 M21 17 L24 21" fill="none" stroke="${shade(c, -0.3)}" stroke-width="1.1"/>
    <path d="M13.5 15 L14.2 5 H17.8 L18.5 15 Z" fill="#fff8ec"/>
    <path d="M13.8 11 H18.2 L18.4 13.5 H13.6 Z M14.1 7 H17.9 L18 9 H14 Z" fill="#e5604d"/>
    <rect x="13.6" y="2" width="4.8" height="3.2" rx="1" fill="#f6c445"/><path d="M13.2 2.2 L16 0.2 L18.8 2.2 Z" fill="#e5604d"/>`,
  // Octopus: big head, wavy arms.
  q: (c) => `
    <path d="M9 18 C6 22 9 25 5 29 M13 20 C12 24 14 27 11.5 30 M19 20 C20 24 18 27 20.5 30 M23 18 C26 22 23 25 27 29" fill="none" stroke="${c}" stroke-width="3.6" stroke-linecap="round"/>
    <ellipse cx="16" cy="12.5" rx="9.5" ry="9.5" fill="${c}"/>
    <circle cx="10" cy="9" r="1.2" fill="${shade(c, 0.3)}"/><circle cx="21.5" cy="7.5" r="1" fill="${shade(c, 0.3)}"/>
    ${eyes(12.3, 19.7, 14, 2)}
    <path d="M14.5 18 Q16 19.3 17.5 18" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>`,
  // Blobfish king: droopy nose, small frown.
  k: (c) => `
    <path d="M4.5 20 C4.5 9 27.5 9 27.5 20 C27.5 27.5 4.5 27.5 4.5 20Z" fill="${c}"/>
    <ellipse cx="16" cy="20" rx="3.6" ry="4.6" fill="${shade(c, -0.15)}"/>
    <path d="M12 26 Q16 23.5 20 26" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>
    ${eyes(10.5, 21.5, 16.5, 1.4)}${crown(4.5)}`,
};

export interface IconOpts {
  /** Replace the animal's main colour (customize preview). */
  tint?: string;
  /** Draw the round team pedestal behind the face. */
  disc?: boolean;
  /** Accessible name. Omit for decorative icons. */
  label?: string;
}

/** SVG markup for one animal face. */
export function animalIcon(side: Side, kind: PieceKind, opts: IconOpts = {}): string {
  const c = opts.tint ?? NATURAL[side][kind];
  const body = (side === 'land' ? LAND : SEA)[kind](c);
  const disc = opts.disc
    ? side === 'land'
      ? '<circle cx="16" cy="16" r="15.5" fill="#fff3d6" stroke="#e7a43a" stroke-width="1.6"/>'
      : '<circle cx="16" cy="16" r="15.5" fill="#1f6f73" stroke="#6fd6cf" stroke-width="1.6"/>'
    : '';
  const a11y = opts.label ? `role="img" aria-label="${opts.label}"` : 'aria-hidden="true" focusable="false"';
  const inner = opts.disc ? `<g transform="translate(3.2 3.2) scale(0.8)">${body}</g>` : body;
  return `<svg class="mc-icon" viewBox="0 0 32 32" ${a11y}>${disc}${inner}</svg>`;
}
