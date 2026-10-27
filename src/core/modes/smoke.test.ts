import { it, expect } from 'vitest';
import { ModeGame } from './game';
import { legalActions } from './rules';
import { seeded } from '../testUtils';

for (const mode of ['normal', 'crazy'] as const) {
  it(`smoke ${mode}`, () => {
    let plies = 0; const reasons: Record<string, number> = {};
    for (let g = 0; g < 30; g++) {
      const rnd = seeded(g + 1);
      const game = new ModeGame({ botMinThinkMs: 0 });
      game.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: g });
      for (let n = 0; n < 400 && !game.isOver(); n++) {
        const ms = game.modeState;
        if (ms.phase === 'duel') {
          game.answerDuel(rnd() < 0.5);
          if (game.modeState.phase === 'duel') { game.throwHand('land', (['rock','paper','scissors'] as const)[Math.floor(rnd()*3)]); game.throwHand('sea', (['rock','paper','scissors'] as const)[Math.floor(rnd()*3)]); }
          continue;
        }
        const acts = legalActions(game.state);
        expect(acts.length).toBeGreaterThan(0);
        const a = acts[Math.floor(rnd() * acts.length)];
        const r = game.act(a);
        if (!r.ok) throw new Error(`${JSON.stringify(a)} ${JSON.stringify(r)} ${game.fen}`);
        plies++;
      }
      const o = game.isOver(); reasons[o ? o.reason : 'none'] = (reasons[o ? o.reason : 'none'] ?? 0) + 1;
    }
    console.log(mode, plies, reasons);
  }, 60000);
}
