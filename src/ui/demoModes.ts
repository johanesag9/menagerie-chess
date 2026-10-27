/**
 * Demo only: fake Normal/Crazy state and the drawer buttons for every Phase 3 overlay, plus a scripted "Crazy turn".
 * The fake state follows the rules in GAME_SPEC.md "Game modes" (start hand 1, 3 duel tokens, a card every 3rd own turn,
 * the wheel at the start of round 6, 11, ...). It is not core: nothing here checks legality.
 */
import type {
  ActionRecord, Card, CardSuit, DieValue, DuelInfo, GameMode, GameOptions, Hand, JokerOutcome, ModeState, PieceState, Side, WheelOutcome,
} from '../contracts/types';
import type { MenagerieUi } from './index';

const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const SUITS: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades', 'joker'];
let cardN = 0;
export const newCard = (suit: CardSuit = pick(SUITS)): Card => ({ id: `card-${++cardN}`, suit });

/** A fresh game's mode state, as core would emit it after newGame. */
export function freshState(mode: Exclude<GameMode, 'classic'>): ModeState {
  const crazy = mode === 'crazy';
  const side = () => ({ powersUsed: [], hand: crazy ? [newCard()] : [], playableCards: [], duelTokens: crazy ? 3 : 0, captured: [], nextCardIn: crazy ? 3 : 0 });
  return { mode, round: 1, phase: 'action', die: null, nextWheelIn: crazy ? 5 : null, statuses: [], squares: [], land: side(), sea: side() };
}

/** Holds a fake ModeState and pushes every change to the UI. */
export class FakeMode {
  st: ModeState;
  /** Own turns taken per side, for the card draw countdown. */
  private turns: Record<Side, number> = { land: 0, sea: 0 };

  constructor(private ui: MenagerieUi, mode: Exclude<GameMode, 'classic'>, private human: Side | null) {
    this.st = freshState(mode);
  }

  get crazy(): boolean {
    return this.st.mode === 'crazy';
  }

  push(): void {
    // Cards are playable only for the side in its action phase. ♥ needs a captured animal.
    for (const s of ['land', 'sea'] as const) {
      const ss = this.st[s];
      ss.playableCards = this.st.phase === 'action' && s === this.turn ? ss.hand.filter((c) => c.suit !== 'hearts' || ss.captured.length > 0).map((c) => c.id) : [];
    }
    this.ui.setModeState(structuredClone(this.st));
  }

  turn: Side = 'land';

  /** A turn ended: count it, tick the round and the wheel, and say if a card or wheel is due next. */
  endTurn(side: Side): { wheelDue: boolean; cardDue: boolean } {
    this.turns[side]++;
    this.st[side].nextCardIn = 3 - (this.turns[side] % 3);
    const next = other(side);
    this.turn = next;
    this.st.die = null;
    this.st.phase = 'action';
    let wheelDue = false;
    if (side === 'sea') {
      this.st.round++;
      if (this.st.nextWheelIn !== null) {
        this.st.nextWheelIn--;
        wheelDue = this.st.nextWheelIn === 0;
      }
    }
    // A draw happens at the start of every 3rd own turn (the 3rd, 6th, ...).
    const cardDue = this.crazy && (this.turns[next] + 1) % 3 === 0 && this.st[next].hand.length < 3;
    return { wheelDue, cardDue };
  }

  captured(p: PieceState): void {
    this.st[p.side].captured.push(p);
  }

  draw(side: Side, card = newCard()): Card {
    if (this.st[side].hand.length < 3) this.st[side].hand.push(card);
    return card;
  }

  get you(): Side | null {
    return this.human;
  }
}

type Btn = (parent: HTMLElement, label: string, fn: () => void) => HTMLButtonElement;
type Section = (title: string, hint?: string) => HTMLElement;


const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Drawer buttons for the mode HUD and every overlay. `stage` puts the UI on a game screen with fake info. */
export function addModeControls(ui: MenagerieUi, section: Section, btn: Btn, note: (n: string, p: unknown) => void, stop: () => void): void {
  let fm: FakeMode | null = null;
  const BOT: GameOptions = { mode: 'crazy', opponent: { type: 'bot', level: 3, botSide: 'sea' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };
  const LOCAL: GameOptions = { ...BOT, opponent: { type: 'local' } };

  /** A quiet game screen (no fake moves) with mode state, for showing one thing at a time. */
  function stage(mode: Exclude<GameMode, 'classic'>, local = false, mid = true): FakeMode {
    stop();
    const opts = { ...(local ? LOCAL : BOT), mode };
    ui.setGameInfo(opts);
    ui.show('game');
    fm = new FakeMode(ui, mode, local ? null : 'land');
    if (mid) midGame(fm);
    ui.setTurn('land');
    fm.push();
    return fm;
  }

  /** Round 4 of a game: some powers used, some captures, a couple of cards and a token spent. */
  function midGame(f: FakeMode): void {
    const st = f.st;
    st.round = 4;
    if (st.nextWheelIn !== null) st.nextWheelIn = 2;
    st.land.powersUsed = ['land-n-g1', 'land-p-d2'];
    st.sea.powersUsed = ['sea-q-d8'];
    st.land.captured = [{ id: 'land-p-c2', side: 'land', kind: 'p', square: 'c4' }];
    st.sea.captured = [{ id: 'sea-p-e7', side: 'sea', kind: 'p', square: 'e5' }, { id: 'sea-n-b8', side: 'sea', kind: 'n', square: 'c6' }];
    if (f.crazy) {
      st.land.hand = [newCard('hearts'), newCard('clubs'), newCard('joker')];
      st.sea.hand = [newCard('diamonds'), newCard('spades')];
      st.land.nextCardIn = 2;
      st.sea.nextCardIn = 3;
      st.sea.duelTokens = 2;
      st.die = { value: 3, effect: 'none' };
    }
  }

  const hud = section('Mode HUD', 'A quiet game screen with fake Normal/Crazy state at round 4. Tap a card in the hand.');
  btn(hud, 'Normal vs bot', () => stage('normal'));
  btn(hud, 'Crazy vs bot', () => stage('crazy'));
  btn(hud, 'Crazy, 2 players', () => stage('crazy', true));
  btn(hud, 'Wheel next round', () => {
    const f = fm ?? stage('crazy');
    f.st.nextWheelIn = 1;
    f.push();
  });
  btn(hud, 'Hide (Classic)', () => {
    ui.setModeState(null);
    ui.setSelection(null);
    ui.setPrompt(null);
  });

  const sel = section('Selection and prompt', '"Use power" shows an aiming prompt; Cancel or Esc clears it.');
  const select = (available: boolean, reason?: 'used' | 'stunned' | 'frozen' | 'noTarget' | 'notYourTurn') => {
    if (!fm) stage('normal');
    ui.setPrompt(null);
    ui.setSelection({ pieceId: 'land-n-b1', side: 'land', kind: 'n', power: { power: 'doubleJump', available, reason } });
  };
  btn(sel, 'Horse (ready)', () => select(true));
  btn(sel, 'Used', () => select(false, 'used'));
  btn(sel, 'Stunned', () => select(false, 'stunned'));
  btn(sel, 'No target', () => select(false, 'noTarget'));
  btn(sel, 'Octopus (Sea)', () => {
    if (!fm) stage('normal');
    ui.setSelection({ pieceId: 'sea-q-d8', side: 'sea', kind: 'q', power: { power: 'block', available: true } });
  });
  btn(sel, 'Prompt', () => ui.setPrompt('Pick an empty square to block'));
  btn(sel, 'Clear', () => {
    ui.setSelection(null);
    ui.setPrompt(null);
  });
  ui.on('powerRequested', ({ pieceId }) => {
    ui.setSelection(null);
    ui.setPrompt(pieceId.includes('-n-') ? 'Pick the first hop (an empty square)' : 'Pick an empty square to block');
  });
  ui.on('cancelAction', () => ui.setPrompt(null));
  ui.on('cardRequested', async ({ cardId }) => {
    const st = fm?.st;
    const card = st && [...st.land.hand, ...st.sea.hand].find((c) => c.id === cardId);
    if (!card || !fm) return;
    const side: Side = st.land.hand.includes(card) ? 'land' : 'sea';
    const prompts: Record<CardSuit, string> = { hearts: '', diamonds: 'Pick the first piece to swap', clubs: 'Pick an enemy piece to freeze', spades: 'Pick a pawn to dig back', joker: '' };
    if (card.suit === 'hearts') {
      const id = await ui.askRevive(side, st[side].captured);
      note('askRevive →', id);
      if (id) ui.setPrompt('Pick an empty square on your back rank');
    } else if (card.suit === 'joker') {
      st[side].hand = st[side].hand.filter((c) => c !== card);
      fm.push();
      const j = pick<JokerOutcome>(['party', 'teleport', 'butterfingers', 'double']);
      await ui.showCardPlayed(side, card, j);
      ui.addLog({ side, kind: 'card', label: `★ Joker: ${j}` });
    } else {
      ui.setPrompt(prompts[card.suit]);
    }
  });

  const logs = section('Move-list lines', 'Non-move lines sit between the moves.');
  const LINES: ActionRecord[] = [
    { side: 'land', kind: 'power', label: 'Horse: Double jump g1→f3→e5' },
    { side: 'sea', kind: 'card', label: '♣ Freeze on c3' },
    { side: 'land', kind: 'bonus', label: 'Lucky: recharge Horse' },
    { side: 'sea', kind: 'bonk', label: 'Bonked! Crab goes back to d5' },
    { side: null, kind: 'wheel', label: 'Wheel: Tide' },
    { side: 'sea', kind: 'pass', label: 'No legal action: turn passes' },
  ];
  LINES.forEach((l) => btn(logs, l.kind, () => {
    ui.addLog(l);
  }));

  const die = section('Fate die', 'Tap anywhere (or Space) to skip.');
  ([1, 3, 6] as DieValue[]).forEach((v) => btn(die, `Roll ${v}`, async () => {
    const f = fm ?? stage('crazy');
    await ui.rollDie(f.turn, v, v === 1 ? 'banana' : v === 6 ? 'lucky' : 'none');
    f.st.die = { value: v, effect: v === 1 ? 'banana' : v === 6 ? 'lucky' : 'none' };
    f.push();
  }));
  btn(die, 'Lucky', async () => note('askLucky →', await ui.askLucky('land', { canRecharge: true, canStep: true })));
  btn(die, 'Lucky (no recharge)', async () => note('askLucky →', await ui.askLucky('land', { canRecharge: false, canStep: true })));

  const cards = section('Cards');
  SUITS.forEach((s) => btn(cards, `Draw ${s}`, async () => {
    const f = fm ?? stage('crazy');
    const c = newCard(s);
    await ui.showCardDrawn('land', c);
    f.draw('land', c);
    f.push();
  }));
  (['hearts', 'diamonds', 'clubs', 'spades'] as CardSuit[]).forEach((s) => btn(cards, `Play ${s}`, () => void ui.showCardPlayed('sea', newCard(s))));
  (['party', 'teleport', 'butterfingers', 'double'] as JokerOutcome[]).forEach((j) => btn(cards, `Joker: ${j}`, () => void ui.showCardPlayed('land', newCard('joker'), j)));
  btn(cards, 'Revive picker', async () => {
    const captured: PieceState[] = [
      { id: 'land-p-c2', side: 'land', kind: 'p', square: 'c4' }, { id: 'land-p-h2', side: 'land', kind: 'p', square: 'h5' },
      { id: 'land-n-g1', side: 'land', kind: 'n', square: 'f3' }, { id: 'land-q-d1', side: 'land', kind: 'q', square: 'd5' },
    ];
    note('askRevive →', await ui.askRevive('land', captured));
  });

  const duel = section('Duels');
  const INFO: DuelInfo = { attackerId: 'sea-p-d7', victimId: 'land-p-e2', via: 'move', from: 'd5', to: 'e4', attacker: 'sea', defender: 'land', tokensLeft: 3 };
  btn(duel, 'Duel ask', async () => {
    if (!fm) stage('crazy');
    note('askDuel →', await ui.askDuel(INFO));
  });
  btn(duel, 'Duel ask (double jump)', async () => {
    if (!fm) stage('crazy');
    note('askDuel →', await ui.askDuel({ ...INFO, attackerId: 'sea-n-g8', via: 'doubleJump', mid: 'f6', from: 'g8', tokensLeft: 1 }));
  });
  btn(duel, 'Throw vs bot', async () => note('askThrow →', await ui.askThrow('land', { hotSeat: false })));
  btn(duel, 'Throw hot seat', async () => {
    stage('crazy', true);
    const a = await ui.askThrow('sea', { hotSeat: true });
    const d = await ui.askThrow('land', { hotSeat: true });
    note('askThrow (hot seat) →', { sea: a, land: d });
  });
  const round = (attackerHand: Hand, defenderHand: Hand, result: 'attacker' | 'defender' | 'tie', n = 1) =>
    ui.showDuelRound({ info: INFO, round: n, attackerHand, defenderHand, result });
  btn(duel, 'Round: you win', () => void round('rock', 'paper', 'defender'));
  btn(duel, 'Round: you lose', () => void round('scissors', 'paper', 'attacker'));
  btn(duel, 'Round: tie', () => void round('rock', 'rock', 'tie'));

  const wheel = section('Wheel of Chaos');
  (['tide', 'pigeon', 'earthquake', 'disco'] as WheelOutcome[]).forEach((w) => btn(wheel, w, () => {
    if (!fm) stage('crazy');
    void ui.spinWheel(w);
  }));

  const misc = section('Crazy: danger and result');
  btn(misc, 'King in danger!', () => {
    if (!fm) stage('crazy');
    ui.showCheck('land');
  });
  btn(misc, 'Result: king bonked', () => {
    if (!fm) stage('crazy');
    ui.showResult({ winner: 'land', reason: 'kingCaptured' });
  });

  const script = section('Scripted Crazy turn', 'Wheel → card draw → die → lucky → Sea attacks → duel → card played. Answer the questions yourself.');
  btn(script, '▶ Crazy turn (vs bot)', () => void crazyTurn(false));
  btn(script, '▶ Crazy turn (2 players)', () => void crazyTurn(true));

  async function crazyTurn(local: boolean): Promise<void> {
    const f = stage('crazy', local);
    const st = f.st;
    ui.setSelection(null);
    ui.setPrompt(null);
    // End of round 5: the wheel spins at the start of Land's turn in round 6.
    st.round = 6;
    st.nextWheelIn = 0;
    st.land.nextCardIn = 0;
    st.land.hand = [newCard('clubs')];
    f.push();
    note('script', 'wheel');
    await ui.spinWheel('tide');
    ui.addLog({ side: null, kind: 'wheel', label: 'Wheel: Tide (2 Land pieces swept back)' });
    st.nextWheelIn = 5;
    f.push();

    note('script', 'card draw');
    const joker = newCard('joker');
    await ui.showCardDrawn('land', joker);
    f.draw('land', joker);
    st.land.nextCardIn = 3;
    f.push();

    note('script', 'die');
    await ui.rollDie('land', 6, 'lucky');
    st.die = { value: 6, effect: 'lucky' };
    st.phase = 'bonus';
    f.push();
    const lucky = await ui.askLucky('land', { canRecharge: st.land.powersUsed.length > 0, canStep: true });
    ui.addLog({ side: 'land', kind: 'bonus', label: lucky === 'skip' ? 'Lucky: skipped' : lucky === 'recharge' ? 'Lucky: Horse recharged' : 'Lucky: Pup steps e3→e4' });
    if (lucky === 'recharge') st.land.powersUsed = st.land.powersUsed.filter((id) => id !== 'land-n-g1');
    st.phase = 'action';
    f.push();
    await wait(400);
    ui.addMove({ pieceId: 'land-n-b1', side: 'land', kind: 'n', from: 'b1', to: 'c3', san: 'Nc3', flags: [], check: false, fenAfter: '' });
    f.endTurn('land');
    ui.setTurn('sea');
    f.push();

    // Sea's turn: a quiet roll, then the Crab tries to take the Pup.
    await wait(300);
    await ui.rollDie('sea', 3, 'none');
    st.die = { value: 3, effect: 'none' };
    f.push();
    note('script', 'duel');
    const info: DuelInfo = { ...INFO, tokensLeft: st.land.duelTokens };
    st.phase = 'duel';
    f.push();
    const call = await ui.askDuel(info);
    let bonked = false;
    if (call) {
      st.land.duelTokens--;
      f.push();
      for (let n = 1; n <= 3; n++) {
        const atk = local ? await ui.askThrow('sea', { hotSeat: true }) : pick<Hand>(['rock', 'paper', 'scissors']);
        const def = await ui.askThrow('land', { hotSeat: local });
        const beats: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
        // Three ties in a row: the attacker wins.
        const result = atk === def ? (n === 3 ? 'attacker' : 'tie') : beats[def] === atk ? 'defender' : 'attacker';
        await ui.showDuelRound({ info, round: n, attackerHand: atk, defenderHand: def, result: atk === def ? 'tie' : result });
        if (atk !== def || n === 3) {
          bonked = result === 'defender';
          break;
        }
      }
    }
    if (bonked) {
      ui.addLog({ side: 'sea', kind: 'bonk', label: 'Bonked! Crab goes back to d5' });
    } else {
      const victim: PieceState = { id: 'land-p-e2', side: 'land', kind: 'p', square: 'e4' };
      ui.addMove({ pieceId: 'sea-p-d7', side: 'sea', kind: 'p', from: 'd5', to: 'e4', san: 'dxe4', flags: ['capture'], captured: victim, check: false, fenAfter: '' });
      f.captured(victim);
    }
    f.endTurn('sea');
    ui.setTurn('land');
    f.push();

    // Land's turn: roll, then play the joker.
    await wait(300);
    await ui.rollDie('land', 4, 'none');
    st.die = { value: 4, effect: 'none' };
    f.push();
    note('script', 'card played');
    st.land.hand = st.land.hand.filter((c) => c.id !== joker.id);
    f.push();
    await ui.showCardPlayed('land', joker, 'party');
    st.land.powersUsed = [];
    ui.addLog({ side: 'land', kind: 'card', label: '★ Joker: Party! All powers recharged' });
    f.push();
    note('script', 'done');
  }

  Object.assign(window, { __modes: { stage, crazyTurn, get fm() { return fm; } } });
}
