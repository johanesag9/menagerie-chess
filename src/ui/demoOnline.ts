/**
 * Phase 5 demo controls: the invite and join overlays and every online HUD state, with fake data.
 * Phase 6 adds the board games online: the castle draft (your pick, friend picking) and the board strips with the timer.
 * Nothing here talks to a server. The "room" is a made-up code and the friend is a timer.
 */
import type { GameOptions, PlayMode, Side } from '../contracts/types';
import type { OnlineHud } from '../contracts/net';
import { FakeBoard, TRAITS } from './demoBoard';
import { FakeMode } from './demoModes';
import type { MenagerieUi } from './index';

type Btn = (parent: HTMLElement, label: string, fn: () => void) => HTMLButtonElement;
type Section = (title: string, hint?: string) => HTMLElement;

const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const fakeRoom = () => Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
const online = (mode: PlayMode, you: Side): GameOptions => ({ mode, opponent: { type: 'online', you }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false });

export function addOnlineControls(
  ui: MenagerieUi,
  section: Section,
  btn: Btn,
  note: (n: string, p: unknown) => void,
  /** Runs the demo's fake game (chess or party) for these options. */
  play: (o: GameOptions) => void,
  stop: () => void,
): void {
  const hud: OnlineHud = { connection: 'online', opponent: 'here', graceEndsAt: null, timer: null, rematch: 'none' };
  const push = () => ui.setOnline({ ...hud, timer: hud.timer && { ...hud.timer } });
  let pending: GameOptions | null = null;
  let autoTimer = true;
  let gen = 0;

  const you = (): Side => (ui.gameInfo?.opponent.type === 'online' ? ui.gameInfo.opponent.you : 'land');
  const turnSide = (): Side => ui.arenaState?.turn ?? lastTurn;

  // The turn timer follows the side to move in the playing fake (60s each turn).
  let lastTurn: Side = 'land';
  const setTurn = ui.setTurn.bind(ui);
  ui.setTurn = (t: Side) => {
    setTurn(t);
    lastTurn = t;
    if (autoTimer && ui.gameInfo?.opponent.type === 'online') {
      hud.timer = { side: t, endsAt: performance.now() + 60_000 };
      push();
    }
  };

  /** The friend joined (or you did): the game starts on the online HUD. */
  function begin(o: GameOptions, quiet = false): void {
    gen++;
    pending = null;
    Object.assign(hud, { connection: 'online', opponent: 'here', graceEndsAt: null, timer: null, rematch: 'none' });
    ui.setGameInfo(o);
    ui.show('game');
    push();
    if (quiet) {
      stop();
      ui.closeQuestion(); // a question left open by an earlier fake game
      return;
    }
    autoTimer = true;
    play(o);
  }

  // Setup's "Invite a friend": pretend to make a room, then show the invite.
  ui.on('startGame', (o) => {
    if (o.opponent.type !== 'online') return;
    const you = o.opponent.you;
    pending = o;
    const my = ++gen;
    void wait(700).then(() => {
      if (my === gen) ui.showInvite({ link: `${location.origin}/?room=${fakeRoom()}`, mode: o.mode ?? 'classic', you });
    });
  });
  ui.on('cancelInvite', (p) => {
    pending = null;
    note('cancelInvite', p);
  });
  // Online Rematch: if the friend asked first the new game starts; else they accept after a moment. Sides swap.
  ui.on('rematchOnline', (p) => {
    note('rematchOnline', p);
    const o = ui.gameInfo;
    if (!o || o.opponent.type !== 'online') return;
    const next = online(o.mode ?? 'classic', other(o.opponent.you));
    const theyAsked = hud.rematch === 'theyAsked';
    hud.rematch = 'youAsked';
    push();
    const my = ++gen;
    void wait(theyAsked ? 500 : 2500).then(() => my === gen && begin(next));
  });

  const inv = section('Online: invite and join', 'Setup → Friend online → Invite a friend also opens the invite (after a fake 0.7s "making the room").');
  btn(inv, 'Invite (Sumo, you Land)', () => {
    pending = online('sumo', 'land');
    ui.showInvite({ link: `${location.origin}/?room=${fakeRoom()}`, mode: 'sumo', you: 'land' });
  });
  btn(inv, 'Invite (Crazy, you Sea)', () => {
    pending = online('crazy', 'sea');
    ui.showInvite({ link: `${location.origin}/?room=${fakeRoom()}`, mode: 'crazy', you: 'sea' });
  });
  btn(inv, 'Friend joins', () => begin(pending ?? online('classic', 'land')));
  btn(inv, 'Hide invite', () => ui.hideInvite());
  btn(inv, 'Room error', () => ui.showError("Couldn't make a game room. Try again in a moment."));
  btn(inv, 'Join: good link', () => void ui.askJoin({ mode: 'sumo', you: 'sea' }).then((join) => {
    note('askJoin →', join);
    if (join) begin(online('sumo', 'sea'));
  }));
  btn(inv, 'Join: dead link', () => void ui.askJoin(null).then((join) => note('askJoin →', join)));

  const games = section('Online: games', 'You and Friend, you at the bottom. "Playing" runs the fake game with a 60s timer each turn.');
  btn(games, 'Classic (playing)', () => begin(online('classic', 'land')));
  btn(games, 'Crazy: friend\'s hand', () => {
    begin(online('crazy', 'land'), true);
    const fm = new FakeMode(ui, 'crazy', 'land');
    fm.draw('land');
    fm.draw('land');
    fm.draw('sea');
    fm.draw('sea');
    fm.push();
    ui.setTurn('land');
  });
  btn(games, 'Friend draws a card', () => void ui.showCardDrawn(other(you()), { id: `demo-${Math.random()}`, suit: 'spades' }));
  btn(games, 'Duel throw (no cover)', () => void ui.askThrow(you(), { hotSeat: true }).then((hd) => note('askThrow →', hd)));
  // The room answered for you (time ran out): any open question closes with its default.
  btn(games, 'Ask duel, time runs out', () => {
    void ui.askDuel({ attackerId: 'land-n-g1', victimId: 'sea-p-e7', via: 'move', from: 'g1', to: 'e7', attacker: other(you()), defender: you(), tokensLeft: 3 })
      .then((call) => note('askDuel →', call));
    window.setTimeout(() => ui.closeQuestion(), 1500);
  });
  btn(games, 'Promotion, time runs out', () => {
    void ui.askPromotion(you()).then((k) => note('askPromotion →', k));
    window.setTimeout(() => ui.closeQuestion(), 1500);
  });
  btn(games, 'Close question now', () => ui.closeQuestion());
  btn(games, 'Sumo, you Sea', () => begin(online('sumo', 'sea')));
  btn(games, 'Raid, you Land', () => begin(online('raid', 'land')));

  // Phase 6: the board games online. The draft asks only for your picks; the friend's arrive on their own.
  let board: FakeBoard | null = null;
  const draftAt = (picks: NonNullable<FakeBoard['st']['draft']>): FakeBoard => {
    begin(online('castle', 'land'), true);
    const f = new FakeBoard(ui, 'castle');
    f.st.draft!.picks = picks.picks;
    f.st.turn = picks.picks.land.length > picks.picks.sea.length ? 'sea' : 'land';
    ui.setTurn(f.st.turn);
    f.push();
    return (board = f);
  };
  const bg = section('Online: board games', '"Playing" runs the fake draft: the friend picks after about 2s. Stones lets you move both sides (the fake has no friend moves).');
  btn(bg, 'Castle, you Land (playing)', () => begin(online('castle', 'land')));
  btn(bg, 'Castle, you Sea (playing)', () => begin(online('castle', 'sea')));
  btn(bg, 'Draft: friend is picking', () => void draftAt({ size: 2, picks: { land: ['b'], sea: [] } }));
  btn(bg, "Draft: friend's pick comes in", () => {
    const d = board?.st.draft;
    if (!board || !d || board.st.phase !== 'draft' || ui.gameInfo?.opponent.type !== 'online') return;
    const friend = other(you());
    const kind = (['q', 'p', 'r', 'n'] as const).find((k) => !d.picks[friend].includes(k));
    if (!kind || d.picks[friend].length >= d.size) return;
    d.picks[friend].push(kind);
    board.st.turn = you();
    ui.setTurn(you());
    board.push();
  });
  btn(bg, 'Draft: your pick', () => {
    const f = draftAt({ size: 2, picks: { land: ['b'], sea: ['q'] } });
    // hotSeat: true on purpose: online the picker must still skip the "pass the device" wording.
    void ui.askDraft('land', { picks: structuredClone(f.st.draft!.picks), size: 2, traits: TRAITS, hotSeat: true }).then((k) => note('askDraft →', k));
  });
  btn(bg, 'Draft pick, time runs out', () => {
    const f = draftAt({ size: 2, picks: { land: ['b'], sea: ['q'] } });
    void ui.askDraft('land', { picks: structuredClone(f.st.draft!.picks), size: 2, traits: TRAITS, hotSeat: false }).then((k) => note('askDraft → (random)', k));
    window.setTimeout(() => ui.closeQuestion(), 1500);
  });
  btn(bg, 'Castle mid-game', () => {
    const f = draftAt({ size: 2, picks: { land: ['b', 'r'], sea: ['q', 'p'] } });
    f.enter();
    Object.assign(f.st, { round: 4, nextTideIn: 2, levels: { d3: 1, d4: 2, e4: 3, e5: 1, c6: 2, f5: 1, f3: 1 } });
    f.piece('land-b-c2').square = 'e4';
    f.st.crowned = { pieceId: 'land-b-c2', side: 'land', square: 'e4' };
    f.st.turn = 'sea';
    ui.setTurn('sea');
    f.push();
  });
  btn(bg, 'Stones, you Sea (playing)', () => begin(online('stones', 'sea')));
  btn(bg, 'Stones mid-game', () => {
    begin(online('stones', 'land'), true);
    const f = new FakeBoard(ui, 'stones');
    f.st.round = 6;
    f.st.sunk = f.st.sunk.filter((s) => !['a3', 'a4', 'a5', 'a6', 'b4', 'h3', 'h4', 'h5', 'g5', 'd4'].includes(s));
    f.st.stage = 'move';
    ui.setTurn('land');
    f.push();
    board = f;
  });

  const st = section('Online: HUD states');
  btn(st, 'All good', () => {
    Object.assign(hud, { connection: 'online', opponent: 'here', graceEndsAt: null });
    push();
  });
  btn(st, 'Reconnecting', () => {
    hud.connection = 'reconnecting';
    push();
  });
  btn(st, 'Offline', () => {
    hud.connection = 'offline';
    push();
  });
  btn(st, 'Friend away (2:00)', () => {
    Object.assign(hud, { opponent: 'away', graceEndsAt: performance.now() + 120_000 });
    push();
  });
  btn(st, 'Friend back', () => {
    Object.assign(hud, { opponent: 'here', graceEndsAt: null });
    push();
  });
  btn(st, 'Friend left', () => {
    Object.assign(hud, { opponent: 'left', graceEndsAt: null });
    push();
  });
  btn(st, 'Timer: your turn', () => {
    autoTimer = false;
    hud.timer = { side: you(), endsAt: performance.now() + 60_000 };
    push();
  });
  btn(st, 'Timer: urgent (12s)', () => {
    autoTimer = false;
    hud.timer = { side: you(), endsAt: performance.now() + 12_000 };
    push();
  });
  btn(st, "Timer: friend's turn", () => {
    autoTimer = false;
    hud.timer = { side: other(you()), endsAt: performance.now() + 45_000 };
    push();
  });
  btn(st, 'Timer off', () => {
    autoTimer = false;
    hud.timer = null;
    push();
  });
  btn(st, 'Timer follows turns', () => {
    autoTimer = true;
    hud.timer = { side: turnSide(), endsAt: performance.now() + 60_000 };
    push();
  });

  const res = section('Online: result and rematch', 'Rematch online emits rematchOnline; the fake friend accepts after 2.5s and sides swap.');
  btn(res, 'You win', () => {
    stop();
    gen++;
    hud.timer = null;
    hud.rematch = 'none';
    push();
    ui.showResult({ winner: you(), reason: 'checkmate' });
  });
  btn(res, 'Friend wins', () => {
    stop();
    gen++;
    hud.timer = null;
    hud.rematch = 'none';
    push();
    ui.showResult({ winner: other(you()), reason: 'resign' });
  });
  btn(res, 'Rematch: you asked', () => {
    gen++;
    hud.rematch = 'youAsked';
    push();
  });
  btn(res, 'Rematch: friend asked', () => {
    gen++;
    hud.rematch = 'theyAsked';
    push();
  });
  btn(res, 'Rematch: friend left', () => {
    gen++;
    Object.assign(hud, { rematch: 'none', opponent: 'left' });
    push();
  });
}
