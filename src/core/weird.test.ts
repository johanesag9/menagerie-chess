import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { WeirdEvent } from '../contracts/types';
import { makeGame, seeded } from './testUtils';
import { WEIRD_KINDS } from './weird';

describe('Weird Mode', () => {
  it('fires every 4–6 plies, never repeats a kind back to back, and never touches the position', () => {
    const rnd = seeded(11);
    const g = makeGame({ weirdMode: true }, { random: seeded(5) });
    const fired: { ply: number; e: WeirdEvent }[] = [];
    let ply = 0;
    g.on('weirdEvent', (e) => fired.push({ ply, e }));
    const fens: string[] = [];
    while (ply < 120 && !g.isOver()) {
      const legal = new Chess(g.fen).moves({ verbose: true });
      const m = legal[Math.floor(rnd() * legal.length)];
      ply++;
      const r = g.move({ from: m.from as never, to: m.to as never, promotion: m.promotion as never })!;
      fens.push(r.fenAfter);
      expect(g.fen).toBe(r.fenAfter); // the event (if any) changed nothing
    }
    expect(fired.length).toBeGreaterThan(10);
    const gaps = fired.map((f, i) => f.ply - (i ? fired[i - 1].ply : 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(6);
    for (let i = 1; i < fired.length; i++) expect(fired[i].e.kind).not.toBe(fired[i - 1].e.kind);
    for (const { ply: p, e } of fired) {
      expect(WEIRD_KINDS).toContain(e.kind);
      expect(e.durationTurns).toBeGreaterThanOrEqual(1);
      for (const sq of e.squares ?? []) expect(sq).toMatch(/^[a-h][1-8]$/);
      if (e.kind === 'pigeonPeek') expect(new Chess(fens[p - 1]).get(e.squares![0])).toBeTruthy();
    }
    expect(new Set(fired.map((f) => f.e.kind)).size).toBe(WEIRD_KINDS.length); // every kind shows up
  });

  it('is silent when off', () => {
    const g = makeGame({ weirdMode: false });
    let count = 0;
    g.on('weirdEvent', () => count++);
    const rnd = seeded(2);
    for (let i = 0; i < 40 && !g.isOver(); i++) {
      const legal = new Chess(g.fen).moves({ verbose: true });
      const m = legal[Math.floor(rnd() * legal.length)];
      g.move({ from: m.from as never, to: m.to as never, promotion: m.promotion as never });
    }
    expect(count).toBe(0);
  });

  it('emotes just pass through', () => {
    const g = makeGame();
    const got: unknown[] = [];
    g.on('emote', (e) => got.push(e));
    g.sendEmote('sea', 'taunt');
    expect(got).toEqual([{ side: 'sea', emote: 'taunt' }]);
  });
});
