/** Textures drawn in code on a canvas (no downloaded images). */
import * as THREE from 'three';
import type { Bin } from './kit';

function canvasTexture(bin: Bin, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return bin.add(t);
}

export interface Textures {
  /** White disc fading to transparent at the edge. */
  softDisc: THREE.Texture;
  /** Solid dot with a soft rim (legal-move dots). */
  dot: THREE.Texture;
  /** Ring with soft edges (capture rings, check waves). */
  ring: THREE.Texture;
  /** Rounded-square border glow (selected square). */
  squareGlow: THREE.Texture;
  /** Filled rounded square (last-move tint). */
  squareFill: THREE.Texture;
  /** 4x4 atlas of a..h and 1..8 for the frame coordinates. */
  labels: THREE.Texture;
  /** Phase 3: a jagged branching ground crack (earthquake decals). */
  crack: THREE.Texture;
}

export function makeTextures(bin: Bin): Textures {
  const softDisc = canvasTexture(bin, 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });

  const dot = canvasTexture(bin, 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.72, 'rgba(255,255,255,1)');
    grd.addColorStop(0.86, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });

  const ring = canvasTexture(bin, 256, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.68, 'rgba(255,255,255,0)');
    grd.addColorStop(0.78, 'rgba(255,255,255,1)');
    grd.addColorStop(0.88, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });

  const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };

  const squareGlow = canvasTexture(bin, 256, (g, s) => {
    g.shadowColor = 'rgba(255,255,255,1)';
    g.shadowBlur = s * 0.07;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = s * 0.08;
    roundRect(g, s * 0.07, s * 0.07, s * 0.86, s * 0.86, s * 0.12);
    g.stroke();
    g.stroke();
    // Faint inner fill so the square reads as "lit".
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(g, s * 0.07, s * 0.07, s * 0.86, s * 0.86, s * 0.12);
    g.fill();
  });

  const squareFill = canvasTexture(bin, 128, (g, s) => {
    g.fillStyle = 'rgba(255,255,255,1)';
    g.shadowColor = 'rgba(255,255,255,1)';
    g.shadowBlur = s * 0.04;
    roundRect(g, s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.12);
    g.fill();
  });

  const labels = canvasTexture(bin, 512, (g, s) => {
    const cell = s / 4;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${cell * 0.62}px ui-rounded, "SF Pro Rounded", "Fredoka", "Nunito", system-ui, sans-serif`;
    const glyphs = 'abcdefgh12345678';
    for (let i = 0; i < 16; i++) {
      const cx = (i % 4) * cell + cell / 2;
      const cy = Math.floor(i / 4) * cell + cell / 2;
      g.fillStyle = 'rgba(255,240,215,0.55)';
      g.fillText(glyphs[i], cx + 2, cy + 3);
      g.fillStyle = '#5b3a20';
      g.fillText(glyphs[i], cx, cy);
    }
  });

  const crack = canvasTexture(bin, 256, (g, s) => {
    // Seeded so every load draws the same crack.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      g.beginPath();
      g.moveTo(x, y);
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        a += (rnd() - 0.5) * 0.9;
        x += Math.cos(a) * (len / steps);
        y += Math.sin(a) * (len / steps);
        g.lineTo(x, y);
      }
      g.lineWidth = w;
      g.stroke();
      if (depth > 0) {
        branch(x, y, a + 0.7, len * 0.55, w * 0.6, depth - 1);
        branch(x, y, a - 0.6, len * 0.5, w * 0.6, depth - 1);
      }
    };
    const draw = (style: string, grow: number) => {
      g.strokeStyle = style;
      seed = 7;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        branch(s / 2, s / 2, a, s * 0.2, s * 0.035 + grow, 2);
      }
    };
    draw('rgba(255,236,200,0.55)', 4); // light lip
    draw('rgba(40,24,12,1)', 0); // dark crack
  });

  return { softDisc, dot, ring, squareGlow, squareFill, labels, crack };
}
