/**
 * UI + audio demo. Everything here is fake input: a stand-in board, a scripted game driven by chess.js,
 * and a control drawer for every screen, event and sound. Run the `ui-demo` launch config, open /src/ui/demo.html.
 */
import { Chess, type Move } from 'chess.js';
import { ALL_CUES, createAudio, measureCue, type CueLevel } from '../audio';
import type { AudioCue, DieValue, EmoteKind, GameOptions, MoveFlag, MoveResult, PieceKind, Side, WeirdEventKind, WheelOutcome } from '../contracts/types';
import { FakeMode, addModeControls } from './demoModes';
import { createUi, type MenagerieUi } from './index';

// ---------- Stand-in board ----------
const board = document.getElementById('board')!;
for (let r = 8; r >= 1; r--) {
  for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 0;
    const land = r <= 4;
    const c = land ? (light ? '#f6ecd0' : '#9cc96b') : light ? '#f3dca6' : '#7fd3cf';
    board.append(Object.assign(document.createElement('i'), { style: `background:${c}` }));
  }
}

const audio = createAudio();
const ui = createUi(document.getElementById('ui-root')!, audio) as MenagerieUi;

// ---------- Fake game ----------
/** Morphy's Opera Game (1858): castling, checks, captures and a mate in 33 plies. */
const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
const WEIRD: WeirdEventKind[] = ['tilt', 'fog', 'gravityHop', 'pigeonPeek', 'tideSwap', 'disco'];
const EMOTE_KINDS: EmoteKind[] = ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'];
const CLOCK_SPEED = 4; // demo clocks run fast so low-time states show up
const side = (c: 'w' | 'b'): Side => (c === 'w' ? 'land' : 'sea');
const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function toResult(m: Move): MoveResult {
  const flags: MoveFlag[] = [];
  if (m.isCapture()) flags.push('capture');
  if (m.isEnPassant()) flags.push('enPassant');
  if (m.isKingsideCastle()) flags.push('castleKing');
  if (m.isQueensideCastle()) flags.push('castleQueen');
  if (m.isPromotion()) flags.push('promotion');
  if (m.isBigPawn()) flags.push('doublePush');
  const s = side(m.color);
  const r: MoveResult = {
    pieceId: `${s}-${m.piece}-${m.from}`, side: s, kind: m.piece as PieceKind, from: m.from, to: m.to, san: m.san, flags,
    check: /[+#]/.test(m.san), fenAfter: m.after,
  };
  if (m.captured) r.captured = { id: `${other(s)}-${m.captured}-${m.to}`, side: other(s), kind: m.captured as PieceKind, square: m.to };
  if (m.promotion) r.promotion = m.promotion as PieceKind;
  return r;
}

class FakeGame {
  private chess = new Chess();
  private history: MoveResult[] = [];
  private stepTimer = 0;
  private clockTimer = 0;
  private ms: Record<Side, number | null> = { land: null, sea: null };
  private running: Side | null = null;
  private paused = false;
  private over = false;
  private opts: GameOptions | null = null;
  /** Normal/Crazy: fake mode state (powers, cards, die, wheel). Moves still come from chess.js. */
  private fm: FakeMode | null = null;
  private rolledFor = -1;
  private gen = 0;

  start(opts: GameOptions): void {
    this.stop();
    this.gen++;
    this.opts = opts;
    this.rolledFor = -1;
    this.fm = opts.mode && (opts.mode === 'normal' || opts.mode === 'crazy') ? new FakeMode(ui, opts.mode, this.botSide() ? other(this.botSide()!) : null) : null;
    ui.setModeState(null);
    this.over = false;
    this.paused = false;
    try {
      this.chess = new Chess(opts.fen);
    } catch {
      ui.showError("That position didn't load. Starting from the normal setup.");
      this.chess = new Chess();
    }
    this.history = [];
    this.ms = { land: opts.time.initialMs, sea: opts.time.initialMs };
    this.running = opts.time.initialMs === null ? null : side(this.chess.turn());
    ui.setGameInfo(opts);
    ui.setTurn(side(this.chess.turn()));
    this.fm?.push();
    ui.setClocks(this.ms.land, this.ms.sea, this.running);
    audio.play('gameStart');
    this.clockTimer = window.setInterval(() => this.tick(), 100);
    this.schedule(1200);
  }

  stop(): void {
    this.gen++;
    window.clearTimeout(this.stepTimer);
    window.clearInterval(this.clockTimer);
    this.running = null;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  private botSide(): Side | null {
    return this.opts?.opponent.type === 'bot' ? this.opts.opponent.botSide : null;
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.stepTimer);
    this.stepTimer = window.setTimeout(() => this.step(), ms);
  }

  private step(): void {
    if (this.over) return;
    if (this.paused) return this.schedule(400);
    const mover = side(this.chess.turn());
    // Crazy: the wheel (when due) and the fate die come before each turn.
    if (this.fm?.crazy && this.rolledFor !== this.history.length) {
      this.rolledFor = this.history.length;
      return void this.turnStart(mover);
    }
    if (mover === this.botSide() && !this.thinking) {
      this.thinking = true;
      ui.setBotThinking(true);
      return this.schedule(900);
    }
    this.thinking = false;
    ui.setBotThinking(false);
    const scripted = this.opts?.fen ? undefined : OPERA[this.history.length];
    let m: Move | null = null;
    try {
      if (scripted) m = this.chess.move(scripted);
    } catch {
      m = null;
    }
    if (!m) {
      const legal = this.chess.moves({ verbose: true }) as Move[];
      const caps = legal.filter((x) => x.isCapture());
      const choice = pick(caps.length && Math.random() < 0.6 ? caps : legal);
      m = this.chess.move(choice.promotion ? { from: choice.from, to: choice.to, promotion: 'q' } : choice.san);
    }
    const r = toResult(m);
    this.history.push(r);
    ui.addMove(r);
    if (this.fm) {
      if (r.captured) this.fm.captured(r.captured);
      this.fm.endTurn(r.side);
      this.fm.push();
    }
    audio.play(r.captured ? 'capture' : r.flags.some((f) => f.startsWith('castle')) ? 'castle' : r.side === 'land' ? 'moveLand' : 'moveSea');
    if (this.opts?.time.initialMs != null) this.ms[r.side]! += this.opts.time.incrementMs;

    if (this.chess.isCheckmate()) return this.end({ winner: r.side, reason: 'checkmate' });
    if (this.chess.isStalemate()) return this.end({ winner: null, reason: 'stalemate' });
    if (this.chess.isInsufficientMaterial()) return this.end({ winner: null, reason: 'insufficient' });
    if (this.chess.isThreefoldRepetition()) return this.end({ winner: null, reason: 'threefold' });
    if (this.chess.isDrawByFiftyMoves() || this.history.length > 140) return this.end({ winner: null, reason: this.history.length > 140 ? 'agreement' : 'fiftyMove' });

    const next = other(r.side);
    if (r.check) window.setTimeout(() => ui.showCheck(next), 250);
    if (this.opts?.weirdMode && this.history.length % 6 === 0) window.setTimeout(() => ui.showWeirdEvent({ kind: pick(WEIRD), durationTurns: 1 }), 500);
    if (r.captured && r.side === this.botSide() && Math.random() < 0.5) window.setTimeout(() => ui.showEmote(r.side, pick(['laugh', 'taunt'])), 700);
    if (this.running) this.running = next;
    ui.setTurn(next);
    ui.setClocks(this.ms.land, this.ms.sea, this.running);
    this.schedule(next === this.botSide() ? 400 : 1300);
  }

  private thinking = false;

  private async turnStart(mover: Side): Promise<void> {
    const fm = this.fm!;
    const g = this.gen;
    if (mover === 'land' && fm.st.nextWheelIn === 0) {
      const w = (['tide', 'pigeon', 'earthquake', 'disco'] as WheelOutcome[])[Math.floor(Math.random() * 4)];
      await ui.spinWheel(w);
      if (g !== this.gen) return;
      ui.addLog({ side: null, kind: 'wheel', label: `Wheel: ${w[0].toUpperCase()}${w.slice(1)}` });
      fm.st.nextWheelIn = 5;
      fm.push();
    }
    if (fm.st[mover].nextCardIn === 1 && fm.st[mover].hand.length < 3) {
      const c = fm.draw(mover);
      await ui.showCardDrawn(mover, c);
      if (g !== this.gen) return;
      fm.push();
    }
    const v = (1 + Math.floor(Math.random() * 6)) as DieValue;
    const effect = v === 1 ? 'banana' : v === 6 ? 'lucky' : 'none';
    await ui.rollDie(mover, v, effect);
    if (g !== this.gen) return;
    fm.st.die = { value: v, effect };
    fm.push();
    if (v === 6 && mover !== this.botSide()) {
      const c = await ui.askLucky(mover, { canRecharge: fm.st[mover].powersUsed.length > 0, canStep: true });
      if (g !== this.gen) return;
      ui.addLog({ side: mover, kind: 'bonus', label: c === 'skip' ? 'Lucky: skipped' : c === 'recharge' ? 'Lucky: recharge' : 'Lucky: pawn step' });
    }
    this.schedule(250);
  }

  private end(result: { winner: Side | null; reason: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fiftyMove' | 'agreement' | 'timeout' | 'resign' }): void {
    this.over = true;
    this.stop();
    ui.setBotThinking(false);
    ui.setClocks(this.ms.land, this.ms.sea, null);
    window.setTimeout(() => ui.showResult(result), result.reason === 'checkmate' ? 900 : 300);
  }

  private tick(): void {
    if (this.paused || !this.running || this.over) return;
    const r = this.running;
    this.ms[r] = Math.max(0, (this.ms[r] ?? 0) - 100 * CLOCK_SPEED);
    ui.setClocks(this.ms.land, this.ms.sea, r);
    if (this.ms[r] === 0) this.end({ winner: other(r), reason: 'timeout' });
  }

  /** Demo shortcut: drop the side to move to 12 seconds. */
  lowClock(): void {
    if (!this.running) return;
    this.ms[this.running] = 12_000;
    ui.setClocks(this.ms.land, this.ms.sea, this.running);
  }

  undo(): void {
    if (!this.history.length || this.over) return;
    // Vs the bot, take back the bot's reply too.
    const n = this.botSide() && this.history[this.history.length - 1].side === this.botSide() && this.history.length > 1 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      this.chess.undo();
      this.history.pop();
    }
    ui.resetMoves();
    this.history.forEach((m) => ui.addMove(m));
    if (this.fm) {
      this.fm.st.land.captured = [];
      this.fm.st.sea.captured = [];
      this.history.forEach((m) => m.captured && this.fm!.captured(m.captured));
      this.fm.push();
    }
    const t = side(this.chess.turn());
    if (this.running) this.running = t;
    ui.setTurn(t);
    ui.setClocks(this.ms.land, this.ms.sea, this.running);
    this.thinking = false;
    ui.setBotThinking(false);
    this.schedule(1500);
  }

  resign(): void {
    if (this.over || !this.opts) return;
    const human = this.botSide() ? other(this.botSide()!) : side(this.chess.turn());
    this.end({ winner: other(human), reason: 'resign' });
  }

  get human(): Side {
    return this.botSide() ? other(this.botSide()!) : side(this.chess.turn());
  }

  get options(): GameOptions | null {
    return this.opts;
  }
}

const game = new FakeGame();
const DEMO_OPTS: GameOptions = { opponent: { type: 'bot', level: 5, botSide: 'sea' }, time: { initialMs: 3 * 60_000, incrementMs: 2000 }, weirdMode: true };

// ---------- Wire UI events like integration would ----------
const log: string[] = [];
const logEl = document.createElement('ol');
function note(name: string, payload: unknown) {
  log.unshift(`${name} ${JSON.stringify(payload)}`.slice(0, 140));
  log.length = Math.min(log.length, 8);
  logEl.replaceChildren(...log.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
}
(['startGame', 'promotionChosen', 'emote', 'undo', 'resign', 'rematch', 'settingsChanged', 'screenChanged', 'powerRequested', 'cardRequested', 'cancelAction'] as const).forEach((n) => ui.on(n, (p) => note(n, p)));
ui.on('startGame', (o) => game.start(o));
ui.on('rematch', () => game.options && game.start(game.options));
ui.on('undo', () => game.undo());
ui.on('resign', () => game.resign());
ui.on('emote', ({ emote }) => {
  ui.showEmote(game.human, emote);
  if (game.options?.opponent.type === 'bot') window.setTimeout(() => ui.showEmote(other(game.human), pick(EMOTE_KINDS)), 1200);
});
ui.on('screenChanged', ({ screen }) => {
  game.setPaused(screen !== 'game');
  if (screen === 'title' || screen === 'setup') game.stop();
});

// ---------- Demo drawer ----------
const css = `
  #demo { position: fixed; z-index: 50; top: 0; left: 0; bottom: 0; width: min(340px, 88vw); transform: translateX(-100%);
    transition: transform .3s cubic-bezier(.2,1.2,.4,1); background: #fffaf0; border-right: 3px solid #ecd6ae;
    box-shadow: 0 0 40px rgba(59,42,30,.25); font: 500 14px/1.3 Fredoka, system-ui, sans-serif; color: #3b2a1e; }
  #demo.open { transform: none; }
  #demo-tab { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); width: 44px; height: 88px; border: 3px solid #ecd6ae;
    border-left: 0; border-radius: 0 16px 16px 0; background: #fffaf0; font: 600 13px Fredoka, sans-serif; color: #3b2a1e; cursor: pointer;
    writing-mode: vertical-rl; }
  #demo-tab:focus-visible, #demo button:focus-visible { outline: 3px solid #12606a; outline-offset: 2px; }
  #demo-body { height: 100%; overflow-y: auto; padding: 12px 14px 40px; }
  #demo h2 { margin: 14px 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #6b5442; }
  #demo h2:first-child { margin-top: 0; }
  #demo .grid { display: flex; flex-wrap: wrap; gap: 6px; }
  #demo button.d { min-height: 44px; padding: 0 12px; border: 2px solid #ecd6ae; border-radius: 12px; background: #fff; font: inherit; color: inherit; cursor: pointer; }
  #demo button.d:hover { border-color: #d9bb86; }
  #demo button.d:active { transform: translateY(1px); }
  #demo button.cue { min-height: 44px; font-size: 12px; padding: 0 8px; }
  #demo .hint { margin: 4px 0; font-size: 12px; color: #6b5442; }
  #demo ol { margin: 0; padding-left: 18px; font: 11px/1.4 ui-monospace, Menlo, monospace; color: #6b5442; word-break: break-all; }
  #demo table { width: 100%; border-collapse: collapse; font: 11px/1.4 ui-monospace, Menlo, monospace; }
  #demo td, #demo th { padding: 2px 4px; text-align: right; border-bottom: 1px solid #f0e2c6; }
  #demo td:first-child, #demo th:first-child { text-align: left; }
`;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

const drawer = document.createElement('aside');
drawer.id = 'demo';
drawer.setAttribute('aria-label', 'Demo controls');
const tab = Object.assign(document.createElement('button'), { id: 'demo-tab', textContent: 'Demo controls', type: 'button' });
tab.setAttribute('aria-expanded', 'false');
tab.addEventListener('click', () => {
  const open = drawer.classList.toggle('open');
  tab.setAttribute('aria-expanded', String(open));
  void audio.unlock();
});
const body = document.createElement('div');
body.id = 'demo-body';
drawer.append(tab, body);
document.body.append(drawer);

function section(title: string, hint?: string): HTMLElement {
  body.append(Object.assign(document.createElement('h2'), { textContent: title }));
  if (hint) body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: hint }));
  const g = document.createElement('div');
  g.className = 'grid';
  body.append(g);
  return g;
}
function btn(parent: HTMLElement, label: string, fn: () => void, cls = 'd'): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: label });
  b.addEventListener('click', () => {
    void audio.unlock();
    fn();
  });
  parent.append(b);
  return b;
}

const screens = section('Screens');
(['title', 'setup', 'game', 'customize', 'settings', 'pause'] as const).forEach((s) => btn(screens, s, () => ui.show(s)));

const fake = section('Fake game', `Bot game, 3+2 with clocks at ${CLOCK_SPEED}× speed, Weird Mode on. Plays Morphy's Opera Game, then random moves.`);
btn(fake, '▶ Start fake game', () => {
  ui.startGame(DEMO_OPTS);
});
btn(fake, 'Local 2-player', () => ui.startGame({ ...DEMO_OPTS, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 } }));
btn(fake, 'Normal vs bot', () => ui.startGame({ ...DEMO_OPTS, mode: 'normal' }));
btn(fake, 'Crazy vs bot', () => ui.startGame({ ...DEMO_OPTS, mode: 'crazy', weirdMode: false }));
btn(fake, 'Low clock', () => game.lowClock());
btn(fake, 'Stop', () => game.stop());

const events = section('Single events');
btn(events, 'Check: Land', () => ui.showCheck('land'));
btn(events, 'Check: Sea', () => ui.showCheck('sea'));
let wi = 0;
btn(events, 'Weird event', () => ui.showWeirdEvent({ kind: WEIRD[wi++ % WEIRD.length], durationTurns: wi % 3 === 0 ? 2 : 1 }));
btn(events, 'Emote: Land', () => ui.showEmote('land', pick(EMOTE_KINDS)));
btn(events, 'Emote: Sea', () => ui.showEmote('sea', pick(EMOTE_KINDS)));
let thinking = false;
btn(events, 'Bot thinking', () => ui.setBotThinking((thinking = !thinking)));
btn(events, 'Promotion: Land', () => void ui.askPromotion('land').then((k) => note('askPromotion →', k)));
btn(events, 'Promotion: Sea', () => void ui.askPromotion('sea').then((k) => note('askPromotion →', k)));
btn(events, 'Error line', () => ui.showError("Core couldn't read that position."));

const results = section('Result screen');
btn(results, 'You win', () => ui.showResult({ winner: game.options?.opponent.type === 'bot' ? other(game.options.opponent.botSide) : 'land', reason: 'checkmate' }));
btn(results, 'Bot wins', () => ui.showResult({ winner: game.options?.opponent.type === 'bot' ? game.options.opponent.botSide : 'sea', reason: 'timeout' }));
btn(results, 'Stalemate', () => ui.showResult({ winner: null, reason: 'stalemate' }));
btn(results, 'Draw: threefold', () => ui.showResult({ winner: null, reason: 'threefold' }));

addModeControls(ui, section, btn, note, () => game.stop());

const music = section('Music');
(['title', 'game', 'tense', 'none'] as const).forEach((t) => btn(music, t, () => audio.setMusic(t)));

const board2 = section('Sound board', 'Every AudioCue. Tap to hear it.');
ALL_CUES.forEach((c) => btn(board2, c.replace('voice:', '🗣 ').replace('emote:', '😀 '), () => audio.play(c), 'd cue'));

const levels = section('Levels', 'Renders each cue offline and measures it (dBFS, after trims). Loud = loudest 50 ms.');
const table = document.createElement('table');
async function measureAll(withTrim = true): Promise<CueLevel[]> {
  const out: CueLevel[] = [];
  for (const c of ALL_CUES) out.push(await measureCue(c as AudioCue, withTrim));
  return out;
}
btn(levels, 'Check levels', async () => {
  const rows = await measureAll();
  table.innerHTML = '<tr><th>cue</th><th>peak</th><th>loud</th><th>sec</th></tr>' +
    rows.map((r) => `<tr><td>${r.cue}</td><td>${r.peakDb.toFixed(1)}</td><td>${r.loudDb.toFixed(1)}</td><td>${r.length.toFixed(2)}</td></tr>`).join('');
});
body.append(table);

body.append(Object.assign(document.createElement('h2'), { textContent: 'UI events (latest first)' }), logEl);

// For automated checks from the browser console.
Object.assign(window, { __demo: { ui, audio, game, measureAll } });
