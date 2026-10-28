/**
 * Shared contracts between the four build streams (core, world, cast, ui/audio).
 * Owned by the orchestrator. Sessions read these; they do not edit them.
 * Need a change? Note it in your session report and the orchestrator updates it.
 *
 * Phase 2 (2026-10-27): added the extras the streams asked for in their reports.
 * Phase 3 (2026-10-27): game modes (Classic, Normal, Crazy). See GAME_SPEC.md "Game modes" for the rules.
 * Phase 4 (2026-10-28): party modes that aren't chess (Sumo, Raid). See GAME_SPEC.md "Party modes" and the `ArenaController` section.
 */
import type { Camera, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';

// ---------- Chess basics ----------

/** Land always plays first (chess "white"). Sea is chess "black". */
export type Side = 'land' | 'sea';
export type PieceKind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export const sideToColor = (s: Side): 'w' | 'b' => (s === 'land' ? 'w' : 'b');
export const colorToSide = (c: 'w' | 'b'): Side => (c === 'w' ? 'land' : 'sea');

/** Stable id for a piece across the whole game, e.g. "land-n-g1" (side-kind-startSquare). Promoted pieces get "-promo<N>". */
export type PieceId = string;

export interface PieceState {
  id: PieceId;
  side: Side;
  kind: PieceKind;
  square: Square;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: Exclude<PieceKind, 'p' | 'k'>;
}

export type MoveFlag = 'capture' | 'enPassant' | 'castleKing' | 'castleQueen' | 'promotion' | 'doublePush';

export interface MoveResult {
  pieceId: PieceId;
  side: Side;
  kind: PieceKind;
  from: Square;
  to: Square;
  san: string;
  flags: MoveFlag[];
  /** Present when something was taken. For en passant, captured.square differs from `to`. */
  captured?: PieceState;
  /** Present when castling: the rook's move. */
  rookMove?: { pieceId: PieceId; from: Square; to: Square };
  promotion?: PieceKind;
  /** Present on promotion: the id of the new piece (the pawn's id is gone from then on). */
  promotedId?: PieceId;
  /** Crazy, banana peel: after landing on `to`, the piece slid on to `slide.to` (never a capture). Promotion happens after the slide. */
  slide?: { from: Square; to: Square };
  /** True when the opponent's king (the side to move next) is attacked after the move. In Crazy it is only a warning ("King in danger!"). */
  check: boolean;
  fenAfter: string;
}

export type GameOverReason =
  | 'checkmate' | 'stalemate' | 'threefold' | 'fiftyMove' | 'insufficient'
  | 'resign' | 'timeout' | 'agreement'
  /** Crazy: the king was captured. */
  | 'kingCaptured'
  /** Sumo: a king fell into the water. Draw when both fell at once. */
  | 'kingOverboard'
  /** Raid: reached the points target. */
  | 'treasure'
  /** Sumo/Raid: the round cap was reached (more animals left / more points wins, else a draw). */
  | 'rounds';

export interface GameOver {
  winner: Side | null; // null = draw
  reason: GameOverReason;
}

// ---------- Game setup ----------

export type Opponent = { type: 'local' } | { type: 'bot'; level: BotLevel; botSide: Side };
/** 1 = toddler ... 8 = grandmaster. Core maps this to Stockfish skill/depth/elo. */
export type BotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface TimeControl {
  /** null = untimed */
  initialMs: number | null;
  incrementMs: number;
}

export interface GameOptions {
  /** Default 'classic'. 'sumo' and 'raid' are run by the `ArenaController`, not the `GameController`. */
  mode?: PlayMode;
  opponent: Opponent;
  time: TimeControl;
  /** Classic and Normal only; ignored in Crazy (the Wheel of Chaos replaces it). */
  weirdMode: boolean;
  /** Start from a custom position. Default = standard start. */
  fen?: string;
  /** Seed for the dice, cards, wheel and bot randomness (tests and replays). Default: random. */
  seed?: number;
}

// ---------- Game modes (Phase 3) ----------

export type GameMode = 'classic' | 'normal' | 'crazy';
/** Phase 4: the party modes (not chess). */
export type ArenaMode = 'sumo' | 'raid';
/** Every mode the setup screen offers. */
export type PlayMode = GameMode | ArenaMode;
export const isArenaMode = (m: PlayMode | undefined): m is ArenaMode => m === 'sumo' || m === 'raid';

/** One power per piece kind, the same for both sides. */
export type PowerKind = 'sidestep' | 'doubleJump' | 'headbutt' | 'stomp' | 'block' | 'escape';
export const POWER_OF: Record<PieceKind, PowerKind> = {
  p: 'sidestep', n: 'doubleJump', b: 'headbutt', r: 'stomp', q: 'block', k: 'escape',
};

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
/** hearts = Revive, diamonds = Swap, clubs = Freeze, spades = Dig, joker = a random wild effect. */
export interface Card { id: string; suit: CardSuit }
export type JokerOutcome = 'party' | 'teleport' | 'butterfingers' | 'double';
export type WheelOutcome = 'tide' | 'pigeon' | 'earthquake' | 'disco';
export type Hand = 'rock' | 'paper' | 'scissors';
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
/** 1 = banana peel, 2-5 = none, 6 = lucky. */
export type DieEffect = 'banana' | 'none' | 'lucky';

/** 'anchored' (Phase 4, Sumo pawn "Dig in"): can't be pushed until its owner's next turn. */
export type PieceStatusKind = 'stunned' | 'frozen' | 'anchored';
export interface PieceStatus {
  pieceId: PieceId;
  status: PieceStatusKind;
  /**
   * Owner's turns it still lasts, counting the next one (1 = it can't act on its owner's next turn).
   * It goes down by 1 at the end of each of the owner's turns (a passed turn counts too) and is removed at 0.
   * One status per piece; a new one replaces the old only if it lasts longer.
   */
  turnsLeft: number;
}
export interface SquareEffect {
  square: Square;
  effect: 'blocked';
  /** Who placed it: Land shows a knocked-over vase, Sea an ink cloud. */
  by: Side;
  /** Plies until it disappears: 4 when placed, minus 1 at the start of every later turn, removed at 0 (so it vanishes at the start of the placer's second turn after). */
  turnsLeft: number;
}

export interface SideModeState {
  /** Pieces of this side whose power is spent. Every other live piece still has its power. */
  powersUsed: PieceId[];
  hand: Card[];
  /** Ids of cards in `hand` that can be played right now (empty when it isn't this side's action phase). */
  playableCards: string[];
  duelTokens: number;
  /** This side's pieces that were captured (♥ Revive picks from these). */
  captured: PieceState[];
  /** Own turns until the next card draw (Crazy). */
  nextCardIn: number;
}

/** A full snapshot of everything beyond the board. Core emits it after every change (`modeState`). */
export interface ModeState {
  mode: GameMode;
  /** Rounds started so far, 1-based (a round is a Land turn plus a Sea turn). */
  round: number;
  /**
   * What core waits for from the side to move:
   * 'bonus' = a lucky 6 was rolled, waiting for a `bonus` action (or skip);
   * 'action' = a move, power or card; 'duel' = a duel is being decided; 'over' = the game ended.
   */
  phase: 'bonus' | 'action' | 'duel' | 'over';
  /** This turn's fate die (Crazy), else null. */
  die: { value: DieValue; effect: DieEffect } | null;
  /** Rounds until the Wheel of Chaos spins (Crazy), else null. */
  nextWheelIn: number | null;
  statuses: PieceStatus[];
  squares: SquareEffect[];
  land: SideModeState;
  sea: SideModeState;
}

/** Why a piece can't use its power right now. */
export type PowerBlock = 'classic' | 'used' | 'stunned' | 'frozen' | 'noTarget' | 'notYourTurn' | 'wrongPhase';
export interface PowerInfo {
  power: PowerKind;
  available: boolean;
  /** Present when not available. */
  reason?: PowerBlock;
}

/**
 * Anything a player can do on their turn. Every target is a square, picked one at a time
 * (ask `targets()` which squares are allowed next):
 * - power sidestep [to] · doubleJump [mid, to] · headbutt [victim] (pushed straight away) · stomp [] · block [square] · escape [to]
 * - card hearts: `pieceId` = the captured piece to bring back, targets [square]
 *   · diamonds [pieceA, pieceB] · clubs [enemy] · spades [pawn] (it digs one square back) · joker []
 * - bonus (Crazy, after a 6): recharge [the piece's square] · pawnStep [the pawn's square] · skip
 */
export type ActionInput =
  | { type: 'move'; from: Square; to: Square; promotion?: Exclude<PieceKind, 'p' | 'k'> }
  | { type: 'power'; pieceId: PieceId; targets: Square[] }
  | { type: 'card'; cardId: string; pieceId?: PieceId; targets: Square[] }
  | { type: 'bonus'; choice: 'recharge'; targets: [Square] }
  | { type: 'bonus'; choice: 'pawnStep'; targets: [Square] }
  | { type: 'bonus'; choice: 'skip' };

/** A half-built action, for `targets()`: what the player picked so far. */
export type PendingAction =
  | { type: 'power'; pieceId: PieceId; targets: Square[] }
  | { type: 'card'; cardId: string; pieceId?: PieceId; targets: Square[] }
  | { type: 'bonus'; choice: 'recharge' | 'pawnStep'; targets: Square[] };

export interface TargetStep {
  /** Squares the player may pick next. Empty when nothing more can be picked. */
  squares: Square[];
  /** True when the action can be submitted as it is. */
  complete: boolean;
  /** Short instruction for the HUD, e.g. "Pick an empty square to block". */
  prompt: string;
}

export type ActResponse = { ok: true; pending?: 'duel' } | { ok: false; reason: string };

/**
 * How a piece travels in a BoardChange. Integration plays it with this cast `MoveStyle`:
 * sidestep→sidestep, jump→jump, pushed→pushed, teleport→teleport, swap→teleport, dig→dig, step→step, swept→swept, quake→quake,
 * sentHome→bonked.
 */
export type ChangeHow =
  | 'sidestep'  // pawn power: pup digs across / crab scuttles
  | 'jump'      // a knight hop (double jump)
  | 'pushed'    // headbutted one square
  | 'teleport'  // king escape, joker teleport
  | 'swap'      // ♦ Swap
  | 'dig'       // ♠ Dig: a pawn steps backward
  | 'step'      // lucky pawn step
  | 'swept'     // tide
  | 'quake'     // earthquake
  // Phase 4 (party modes)
  | 'sentHome'; // Raid: tagged, back to its own back rank

/**
 * One piece-level change. `step` orders them: integration plays every change with the same step together
 * (a swap, a tide, an earthquake, all stomp victims), then the next step. Steps start at 0 and go up by 1.
 * Double jump: step 0 move(mid, jump) · step 1 capture (if any) · step 2 move(to, jump).
 * Statuses and blocked squares are also in the `modeState` snapshot that follows; it is the source of truth.
 */
export type BoardChange = { step: number } & (
  | { type: 'move'; pieceId: PieceId; from: Square; to: Square; how: ChangeHow }
  | { type: 'capture'; pieceId: PieceId; square: Square; by?: PieceId; cause?: 'pigeon' }
  | { type: 'spawn'; piece: PieceState; cause: 'revive' }
  | { type: 'promote'; pieceId: PieceId; newId: PieceId; kind: PieceKind; square: Square }
  | { type: 'status'; pieceId: PieceId; status: PieceStatusKind }
  | { type: 'block'; square: Square; by: Side }
  | { type: 'recharge'; pieceIds: PieceId[] }
  // Phase 4 (party modes)
  /** Sumo: pushed (or left standing) onto water: it topples in from `square` toward `dir` and is out. dir = [dFile, dRank], e.g. [0, 1] = toward rank 8. */
  | { type: 'fall'; pieceId: PieceId; square: Square; dir: [number, number] }
  /** Raid: a treasure changed hands or place. `square` = where it now lies (null while carried); `carrier` = who holds it now. */
  | { type: 'treasure'; owner: Side; event: 'pickup' | 'drop' | 'return' | 'score' | 'snatch'; square: Square | null; carrier: PieceId | null }
);

/** One line of the game log, for the move list (moves, powers, cards, bonuses, bonks, wheel, passes). */
export interface ActionRecord {
  /** Null for the wheel. */
  side: Side | null;
  kind: 'move' | 'power' | 'card' | 'bonus' | 'bonk' | 'wheel' | 'pass';
  /** Short and plain, e.g. "Nf3", "Horse: Double jump g1→f3→e5", "♣ Freeze on c6", "Wheel: Tide", "Bonked!". */
  label: string;
}

export interface PowerResult {
  side: Side;
  pieceId: PieceId;
  power: PowerKind;
  targets: Square[];
  changes: BoardChange[];
  check: boolean;
}

export interface CardResult {
  side: Side;
  card: Card;
  pieceId?: PieceId;
  targets: Square[];
  joker?: JokerOutcome;
  /** Cards drawn by a Joker "double". */
  drawn?: Card[];
  changes: BoardChange[];
  check: boolean;
}

/**
 * A pending capture the defender may duel. Fires only when the defender has a token left (else no duel events at all).
 * Nothing has moved yet when it fires. If the defender wins, the attacker ends back on `from`, nothing is captured,
 * and a double jump still counts as used.
 */
export interface DuelInfo {
  attackerId: PieceId;
  victimId: PieceId;
  /** How the capture happens. For a double jump, `mid` is the first hop's square. Phase 4: 'shove' (Sumo, the victim would fall in), 'tag' (Raid, the victim carries a treasure). */
  via: 'move' | 'doubleJump' | 'shove' | 'tag';
  mid?: Square;
  from: Square;
  /** The square the attacker is trying to land on. */
  to: Square;
  attacker: Side;
  defender: Side;
  /** The defender's tokens before calling. */
  tokensLeft: number;
}

// ---------- Weird Mode ----------

/**
 * Weird Mode events fire every few turns. They never break chess legality:
 * each event is either purely cosmetic or resolves into ordinary legal state changes
 * that core applies itself and reports here.
 */
export type WeirdEventKind =
  | 'tilt'          // cosmetic: board tilts / wobbles for a turn
  | 'fog'           // cosmetic: fog rolls in, distant squares hazy for the mover's opponent
  | 'gravityHop'    // cosmetic: all pieces bounce
  | 'pigeonPeek'    // cosmetic: a pigeon lands on a random piece and leaves
  | 'tideSwap'      // cosmetic: water rises over the beach squares briefly
  | 'disco';        // cosmetic: lights go party mode for one turn

export interface WeirdEvent {
  kind: WeirdEventKind;
  /** Squares the effect focuses on, if any. */
  squares?: Square[];
  /** A hint only: the world plays each effect for a fixed time (about 1.3–8s). */
  durationTurns: number;
}

// ---------- Emotes ----------

export type EmoteKind = 'laugh' | 'angry' | 'love' | 'shock' | 'sleepy' | 'taunt';

// ---------- Events (core -> everyone) ----------

export interface GameEventMap {
  gameStarted: { options: GameOptions; pieces: PieceState[]; fen: string; turn: Side };
  moved: MoveResult;
  turnChanged: { turn: Side; legalMoveCount: number };
  check: { side: Side; kingSquare: Square };
  gameOver: GameOver;
  clock: { landMs: number | null; seaMs: number | null; running: Side | null };
  botThinking: { side: Side; thinking: boolean };
  weirdEvent: WeirdEvent;
  undone: { fen: string; pieces: PieceState[] };
  emote: { side: Side; emote: EmoteKind };

  // ----- Phase 3: Normal and Crazy. None of these fire in Classic. -----
  /** After every change to powers, cards, tokens, statuses, blocked squares, die or phase. Also once inside `newGame` and after `undone`. */
  modeState: ModeState;
  powerUsed: PowerResult;
  cardPlayed: CardResult;
  /** Lucky bonus decided (a skip has no changes). */
  bonusUsed: { side: Side; choice: 'recharge' | 'pawnStep' | 'skip'; changes: BoardChange[] };
  dieRolled: { side: Side; value: DieValue; effect: DieEffect };
  /** A regular draw. Cards from a Joker "double" are in `CardResult.drawn` instead and don't fire this. */
  cardDrawn: { side: Side; card: Card };
  /** Crazy: the side had no legal action, so its turn passed (turnChanged follows). */
  turnPassed: { side: Side };
  /** Normal/Crazy: one line for the move list, after each move, power, card, bonus, bonk, wheel spin or pass. */
  logged: ActionRecord;
  wheelSpun: { outcome: WheelOutcome; direction?: 'left' | 'right'; changes: BoardChange[] };
  /** A capture can be dueled: core waits for `answerDuel` (the bot defender answers by itself). */
  duelOffered: DuelInfo;
  /** One throw, both hands revealed. `result` is who won the throw. */
  duelRound: { info: DuelInfo; round: number; attackerHand: Hand; defenderHand: Hand; result: 'attacker' | 'defender' | 'tie' };
  /** The duel is settled (called = false: the defender declined). Then `moved`/`powerUsed` (attacker won or no duel) or `bonked` follows. */
  duelEnded: { info: DuelInfo; called: boolean; winner: 'attacker' | 'defender' };
  /** The defender won the duel: the attacker bounces back to `from`, nothing is captured, the turn ends. */
  bonked: { info: DuelInfo };
}

export type GameEventName = keyof GameEventMap;
export type Unsubscribe = () => void;

export interface EventSource<M> {
  on<K extends keyof M>(name: K, fn: (payload: M[K]) => void): Unsubscribe;
}

// ---------- Session A: core ----------

export interface GameController extends EventSource<GameEventMap> {
  newGame(options: GameOptions): void;
  readonly fen: string;
  readonly turn: Side;
  readonly pieces: PieceState[];
  readonly history: MoveResult[];
  isOver(): GameOver | null;
  legalTargets(from: Square): Square[];
  /** True if moving from->to needs a promotion choice. */
  needsPromotion(from: Square, to: Square): boolean;
  /** Returns null if illegal. Emits `moved` and follow-up events on success. */
  move(input: MoveInput): MoveResult | null;
  undo(): void;
  resign(side: Side): void;
  sendEmote(side: Side, emote: EmoteKind): void;
  /** Pause clocks/bot while animations play; integration calls resume() when the move animation ends. */
  pause(): void;
  resume(): void;
  dispose(): void;

  // ----- Phase 3: game modes -----
  readonly mode: GameMode;
  /** Classic: null. */
  readonly modeState: ModeState | null;
  /** Normal/Crazy: the whole game log so far (for rebuilding the move list after undo). Classic: []. */
  readonly log: ActionRecord[];
  /**
   * Do a move, power, card or bonus. Legal actions emit their events (see "Event order" in docs/phase3-briefs.md).
   * `pending: 'duel'` means the capture waits on a duel. `move()` stays as a shortcut: it returns null when illegal or pending.
   */
  act(input: ActionInput): ActResponse;
  /** Can this piece use its power now? */
  powerInfo(pieceId: PieceId): PowerInfo;
  /** Can this card be played now? */
  canPlayCard(side: Side, cardId: string): boolean;
  /** The next squares allowed for a half-built power, card or pawn step. */
  targets(pending: PendingAction): TargetStep;
  /** Squares a power or card would affect, for a preview (stomp neighbours, the headbutt landing square). */
  previewArea(pending: PendingAction): Square[];
  /** The duel defender's answer to `duelOffered`. */
  answerDuel(call: boolean): void;
  /** A secret jankenpon pick. The bot's side picks by itself. */
  throwHand(side: Side, hand: Hand): void;
}

// ---------- Phase 4: party modes (Sumo, Raid) — core ----------

/** A treasure in Raid: Land's bone (home e1) or Sea's pearl (home d8). */
export interface TreasureState {
  owner: Side;
  home: Square;
  /** Where it lies (at home or dropped). Null while carried. */
  square: Square | null;
  /** The enemy animal carrying it, else null. */
  carrier: PieceId | null;
}

/** A full snapshot of an arena game. Core emits it (`state`) after every change. */
export interface ArenaState {
  mode: ArenaMode;
  /** 1-based; a round is a Land turn plus a Sea turn. */
  round: number;
  turn: Side;
  /** 'action' = the side to move spends AP; 'duel' = a duel is being decided; 'over' = finished. */
  phase: 'action' | 'duel' | 'over';
  /** This turn's roll. */
  die: DieValue | null;
  /** Action points left this turn. */
  ap: number;
  /** Animals on the board. */
  pieces: PieceState[];
  /** Animals out of the game (Sumo: fell in). Raid: always []. */
  out: PieceState[];
  powersUsed: PieceId[];
  statuses: PieceStatus[];
  /** Blocked squares (queen power). */
  squares: SquareEffect[];
  duelTokens: Record<Side, number>;
  /** Sumo: squares already under water. Raid: []. */
  sunk: Square[];
  /** Sumo: the ring that sinks next, wobbling as a warning during the round before (else []). */
  sinkingNext: Square[];
  /** Sumo: rounds until the next ring sinks (null when no more will). */
  nextSinkIn: number | null;
  /** Raid: both treasures. Sumo: []. */
  treasures: TreasureState[];
  /** Raid points (Sumo: 0). */
  score: Record<Side, number>;
  /** Raid: points to win (Sumo: 0). */
  target: number;
  /** Raid: rounds until the Wheel of Chaos (null in Sumo). */
  nextWheelIn: number | null;
  /** The round cap (Sumo 15, Raid 20). */
  maxRounds: number;
}

/** What one animal can do right now (all empty when it isn't this side's action phase). */
export interface ArenaPieceOptions {
  /** Squares it can step to. */
  steps: Square[];
  /** Enemies it can shove (Sumo) or tag (Raid), by square. */
  hits: Square[];
  /** AP a step costs this animal now (2 for a Raid carrier). */
  stepCost: number;
  /** AP a shove or tag on each square in `hits` costs, same order. */
  hitCosts: number[];
  power: PowerInfo;
}

/**
 * One thing done with AP. A turn is several of these until AP runs out or `endTurn`.
 * power targets per mode (pick them one by one with `targets()`):
 * - Sumo: dig in (pawn) [] · doubleJump [mid, to] · headbutt [victim] · stomp [] · block [square] · escape [to]
 * - Raid: as Normal mode: sidestep [to] · doubleJump [mid, to] · headbutt [victim] · stomp [] · block [square] · escape [to]
 */
export type ArenaAction =
  | { type: 'step'; pieceId: PieceId; to: Square }
  | { type: 'hit'; pieceId: PieceId; target: Square }
  | { type: 'power'; pieceId: PieceId; targets: Square[] }
  | { type: 'endTurn' };

export interface ArenaEventMap {
  /** Inside `newGame`, then `state`, `turnChanged`, `rolled`, `state`. */
  started: { options: GameOptions; state: ArenaState };
  /** After every change (the source of truth for the HUD and for diffing statuses, blocks, sunk squares and treasures). */
  state: ArenaState;
  /** At the start of every turn. */
  rolled: { side: Side; value: DieValue; ap: number };
  /** One action resolved. `changes` (with steps, as in Phase 3) say what to animate. Then `logged`, `state`. */
  acted: { side: Side; action: ArenaAction; power?: PowerKind; changes: BoardChange[] };
  /** Sumo, end of a round: a ring sank. `changes` = the animals that fell with it. */
  sank: { squares: Square[]; changes: BoardChange[] };
  /** Raid, every 5 rounds at the start of Land's turn. */
  wheelSpun: { outcome: WheelOutcome; direction?: 'left' | 'right'; changes: BoardChange[] };
  /** As in Crazy (`via` 'shove' or 'tag'). Nothing has moved yet. Core waits for `answerDuel`, then `throwHand`; a `state` with phase 'duel' starts each throw round. */
  duelOffered: DuelInfo;
  duelRound: GameEventMap['duelRound'];
  duelEnded: GameEventMap['duelEnded'];
  /** The defender won: the hit fails (nothing moves; the attacker's AP is spent). Then `logged`, `state`. */
  bonked: { info: DuelInfo };
  turnChanged: { turn: Side };
  logged: ActionRecord;
  gameOver: GameOver;
  botThinking: { side: Side; thinking: boolean };
}

/**
 * Phase 4: runs Sumo and Raid (GAME_SPEC "Party modes"). Separate from `GameController`: no chess here.
 * Event order after an action: (duelOffered, duelRound*, duelEnded, bonked?) -> acted -> logged -> state;
 * when AP hits 0 or on endTurn: (Sumo, end of a round: sank, logged) -> state -> gameOver? -> turnChanged ->
 * (Raid: wheelSpun, logged) -> rolled -> state.
 * The bot plays its turn one action at a time and holds each next action while paused (like Phase 3).
 */
export interface ArenaController extends EventSource<ArenaEventMap> {
  /** `options.mode` must be 'sumo' or 'raid'; `time`, `weirdMode` and `fen` are ignored. */
  newGame(options: GameOptions): void;
  readonly state: ArenaState;
  /** The whole log so far. */
  readonly log: ActionRecord[];
  pieceOptions(pieceId: PieceId): ArenaPieceOptions;
  /** Next squares for a half-built power (same shape as Phase 3). */
  targets(pending: { pieceId: PieceId; targets: Square[] }): TargetStep;
  /** Squares the power or a hit would affect, for a preview (the shove line, the stomp ring, where a pushed animal lands). */
  previewArea(pending: { pieceId: PieceId; targets: Square[] } | { pieceId: PieceId; hit: Square }): Square[];
  act(action: ArenaAction): ActResponse;
  answerDuel(call: boolean): void;
  throwHand(side: Side, hand: Hand): void;
  resign(side: Side): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

// ---------- Session B: world ----------

export type QualityTier = 'high' | 'low';

export interface WorldEventMap {
  /**
   * `square`: the piece hit (pieces win over the board), else the board square.
   * `boardSquare`: the board square under the pointer, ignoring pieces (a tall animal may stand in front of it).
   */
  squareClicked: { square: Square; boardSquare?: Square | null };
  squareHovered: { square: Square | null; boardSquare?: Square | null };
}

export interface HighlightSet {
  selected?: Square | null;
  legal?: Square[];
  captures?: Square[];
  lastMove?: [Square, Square] | null;
  check?: Square | null;
  /** Phase 3: squares you may pick for a power, card or bonus (a distinct "magic" colour). */
  targets?: Square[];
  /** Phase 3: squares a power will affect (stomp neighbours, the headbutt landing square), a soft wash. */
  area?: Square[];
}

export interface World extends EventSource<WorldEventMap> {
  readonly quality: QualityTier;
  /**
   * Centre of a square on the board surface, with the board at rest. The board sits at the origin,
   * so this is also the position inside `pieceLayer`: use it for piece positions there.
   * For a live world-space point (the board may tilt or hop), use `pieceLayer.localToWorld(...)`.
   */
  squareToWorld(square: Square): Vector3;
  /** Size of one square in world units (pieces scale to this). */
  readonly squareSize: number;
  /** Root that pieces get added to. Picking ignores objects with `userData.noPick = true` (or under such a parent). */
  readonly pieceLayer: Object3D;
  /** Fields you leave out keep their current value; pass null or [] to clear one. */
  setHighlights(h: HighlightSet): void;
  /** Turn the camera to face the given side (local 2-player hand-off). */
  faceSide(side: Side, animate?: boolean): Promise<void>;
  /** Camera punch-in on an action (captures, checkmate). */
  focusOn(point: Vector3, strength?: number): Promise<void>;
  shake(intensity: number): void;
  playWeirdEvent(e: WeirdEvent): Promise<void>;
  /** Register a per-frame callback (dt in seconds). */
  onFrame(fn: (dt: number, elapsed: number) => void): Unsubscribe;
  setPaused(paused: boolean): void;
  setQuality(q: QualityTier): void;
  setCoordinatesVisible(visible: boolean): void;
  /** null = follow the OS setting (prefers-reduced-motion). */
  setReducedMotion(reduced: boolean | null): void;
  /** The camera fly-in (about 2.5s). Any click, key or wheel skips it. */
  playIntro(): Promise<void>;
  /** Phase 3: show exactly these square effects. They must not catch clicks (`noPick`) (blocked squares: a vase for Land, an ink cloud for Sea). Animates appear and vanish. */
  setSquareEffects(effects: SquareEffect[]): void;
  /**
   * Phase 3: the world-side spectacle of a Wheel of Chaos result. Resolves when the board-level effect has played;
   * integration moves the pieces (tide, earthquake) in step with it.
   * - tide: a wave rolls over the beach ranks; `squares` = the squares that get swept.
   * - pigeon: a pigeon flies in, grabs `carry` (a piece's object, reparent it) at `squares[0]` and flies off with it.
   *   Detach `carry` before resolving and don't dispose it; integration disposes the actor afterwards.
   * - earthquake: the board rumbles; `direction` hints which way the pieces slide.
   * - disco: party lights and sparkles over the board.
   */
  playChaos(outcome: WheelOutcome, opts?: { squares?: Square[]; carry?: Object3D; direction?: 'left' | 'right' }): Promise<void>;
  /**
   * Phase 4 (Sumo): show exactly these squares as sunk (the tile drops under rising water, waves lap over it) and `warn` as
   * about to sink (a wobble and a dark wet edge). Animates the change; pass [] [] to restore the board. `noPick` on the water.
   */
  setSunk(sunk: Square[], warn: Square[]): void;
  /**
   * Phase 4 (Raid): home markers (a dog bowl at Land's home, an open shell at Sea's) are always shown while this is set;
   * a treasure lying on the board (`square` not null: at home or dropped) is drawn there with a soft glow. A carried one is
   * drawn by the cast (`setCarrying`), so skip it here. Pass [] to hide everything.
   */
  setTreasures(treasures: TreasureState[]): void;
  /** Phase 4: a splash (an animal falling in, a treasure flying home). `big` for a king. */
  splash(point: Vector3, big?: boolean): void;
  skipIntro(): void;
  /** Read-only access for shader warm-up (`cast.preload`) and screen projection. Don't move the camera yourself. */
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  dispose(): void;
}

export interface WorldOptions {
  container: HTMLElement;
  quality?: QualityTier; // default: auto-detect
  /** Play the intro fly-in on the first frame. Default true. Pass false and call `playIntro()` yourself. */
  autoIntro?: boolean;
}

// ---------- Session C: cast ----------

export interface SkinChoice {
  /** Palette id from the cast's skin list; default = side's base palette. */
  palette?: string;
  /** Accessory id (hat, scarf...) or none. */
  accessory?: string;
}

export interface PieceActor {
  readonly id: PieceId;
  readonly side: Side;
  readonly kind: PieceKind;
  readonly object: Object3D;
  /** Called every frame by integration. Idle animation lives here. */
  update(dt: number, elapsed: number): void;
  setSelected(selected: boolean): void;
  setHovered(hovered: boolean): void;
  /** Look toward a point (e.g. a threatening piece). */
  lookAt(point: Vector3): void;
  /** Travel animation in the animal's own style. Resolves on arrival. `style` (Phase 3) changes how it travels; default 'normal'. */
  moveTo(target: Vector3, opts?: { duration?: number; style?: MoveStyle }): Promise<void>;
  /**
   * Phase 3: the power flourish, in place, in this animal's style (12 in all: 6 powers x 2 sides). `target` = the world point it aims at
   * (headbutt victim, block square, escape or sidestep destination). Resolves at the moment the power takes effect; any follow-through keeps playing.
   * Travel is separate: integration calls moveTo with the matching style after (sidestep, doubleJump, escape) or uses attack (headbutt).
   */
  powerUp(power: PowerKind, target?: Vector3): Promise<void>;
  /** Phase 3: a lasting look until cleared: dizzy stars (stunned), an ice block (frozen). */
  setStatus(status: PieceStatusKind | null): void;
  /** Phase 3: a short flinch: bonked on the head, shoved, hit by a wave. */
  hit(): Promise<void>;
  /** Phase 3: arrive from nowhere (♥ Revive): rises from the ground or bubbles up. Call after adding the object at its square. */
  appear(): Promise<void>;
  /**
   * Phase 4 (Sumo): totters at the edge, then tumbles off toward `dir` (a world-space direction) into the water and sinks.
   * Resolves when it's gone (it leaves the board but isn't freed; integration disposes it, like `defeat`). Emits `poof`-like `splash`.
   */
  fall(dir: Vector3): Promise<void>;
  /** Phase 4 (Raid): hold the other side's treasure in its mouth, claw or tentacle (`owner` = whose treasure: 'land' bone, 'sea' pearl). null = nothing. */
  setCarrying(owner: Side | null): void;
  /** Attack lunge toward a victim. Resolves at the moment of impact. The attacker is left mid-lunge: integration then moves it on (capture) or back (headbutt, bonk). */
  attack(victim: PieceActor): Promise<void>;
  /** Defeat animation (slapstick, never gory). Resolves when it has left the board. */
  defeat(by: PieceActor): Promise<void>;
  /** Happy reaction (won the game, made a great capture). Promotion is handled by integration: it disposes the pawn and creates a new actor. */
  celebrate(): Promise<void>;
  emote(e: EmoteKind): void;
  setSkin(skin: SkinChoice): void;
  /** Jump any running action or emote to its end ("every animation can be skipped by clicking"). */
  skip(): void;
  dispose(): void;
}

/**
 * Phase 3 travel styles. 'normal' is the animal's own move. The others:
 * sidestep (pup digs under / crab scuttles), jump (one knight hop of a double jump), slip (banana peel: a slip and slide, the peel shows),
 * pushed (knocked back, tumbling), teleport (pug zoomies blur / blobfish blorp, also swaps), dig (pawn burrows backward),
 * swept (carried by a wave), quake (stumbles sideways), bonked (dizzy walk back after losing a duel), step (a quick hop forward).
 */
export type MoveStyle = 'normal' | 'sidestep' | 'jump' | 'slip' | 'pushed' | 'teleport' | 'dig' | 'swept' | 'quake' | 'bonked' | 'step';

export interface SkinCatalog {
  palettes: { id: string; name: string; swatch: string }[];
  accessories: { id: string; name: string }[];
}

/** Moments integration hooks camera shake, punch-ins and sounds to. `at` is world space, intensity 0..1 (0 under reduced motion). */
export interface CastEventMap {
  /** A heavy footstep (elephant). */
  stomp: { id: PieceId; at: Vector3; intensity: number };
  /** An attack connects. */
  impact: { id: PieceId; victimId: PieceId; at: Vector3; intensity: number };
  /** A piece lands at the end of a move. */
  land: { id: PieceId; at: Vector3; intensity: number };
  /** A defeated piece vanishes in a poof. */
  poof: { id: PieceId; at: Vector3; intensity: number };
  /** Phase 3: a power takes effect (same moment `powerUp` resolves). */
  power: { id: PieceId; power: PowerKind; at: Vector3; intensity: number };
  /** Phase 4: a falling animal hits the water (integration adds `world.splash` and a sound). */
  splash: { id: PieceId; at: Vector3; intensity: number };
}

/**
 * Board facing: rank 1 is at +Z. Land pieces face -Z (yaw PI), Sea pieces +Z (yaw 0); `createPiece` sets this.
 * Add `actor.object` to `world.pieceLayer` (unscaled) before animating; the actor sets its own scale.
 * `moveTo`/`lookAt` take world-space points.
 * Capture flow: `await attacker.attack(victim); victim.defeat(attacker); await attacker.moveTo(square);`,
 * then `victim.dispose()` once `defeat` resolves (defeat removes it from the board but doesn't free it).
 */
export interface Cast extends EventSource<CastEventMap> {
  createPiece(state: PieceState, skin?: SkinChoice): PieceActor;
  /** Skins the UI can offer, per side. */
  listSkins(side: Side): SkinCatalog;
  /** Display names, e.g. ('sea','n') -> 'Seahorse'. */
  displayName(side: Side, kind: PieceKind): string;
  setReducedMotion(on: boolean): void;
  /** Compile every animal and effect shader up front so the first reveal doesn't hitch. */
  preload(renderer: WebGLRenderer, scene: Scene, camera: Camera): Promise<void>;
  /** `skip()` on every live piece. */
  skipAll(): void;
}

export interface CastOptions {
  /** World square size, pieces scale to fit. */
  squareSize: number;
  quality: QualityTier;
}

// ---------- Session D: ui + audio ----------

export type Screen = 'title' | 'setup' | 'game' | 'customize' | 'settings' | 'pause' | 'result';

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
  quality: QualityTier | 'auto';
  reducedMotion: boolean;
  showCoordinates: boolean;
  landSkin: SkinChoice;
  seaSkin: SkinChoice;
}

export interface UiEventMap {
  startGame: GameOptions;
  promotionChosen: { kind: Exclude<PieceKind, 'p' | 'k'> };
  emote: { emote: EmoteKind };
  undo: Record<string, never>;
  resign: Record<string, never>;
  rematch: Record<string, never>;
  settingsChanged: Settings;
  screenChanged: { screen: Screen };
  /** Phase 3: the player pressed "Use power" for the selected piece. */
  powerRequested: { pieceId: PieceId };
  /** Phase 3: the player picked a card from their hand to play. */
  cardRequested: { cardId: string };
  /** Phase 3: the player cancelled the power or card they were aiming. */
  cancelAction: Record<string, never>;
  /** Phase 4: the player pressed End turn (party modes). */
  endTurn: Record<string, never>;
}

/** Phase 3: what the HUD shows about the selected piece (null = nothing selected). */
export interface SelectionInfo {
  pieceId: PieceId;
  side: Side;
  kind: PieceKind;
  /** Null in Classic. */
  power: PowerInfo | null;
}

export interface Ui extends EventSource<UiEventMap> {
  show(screen: Screen): void;
  readonly settings: Settings;
  /** HUD updates from game events. */
  setTurn(turn: Side): void;
  setClocks(landMs: number | null, seaMs: number | null, running: Side | null): void;
  addMove(move: MoveResult): void;
  resetMoves(): void;
  setBotThinking(thinking: boolean): void;
  showCheck(side: Side): void;
  showWeirdEvent(e: WeirdEvent): void;
  /** Ask the player which piece to promote to. */
  askPromotion(side: Side): Promise<Exclude<PieceKind, 'p' | 'k'>>;
  showResult(result: GameOver): void;
  showEmote(side: Side, emote: EmoteKind): void;
  /** The real skin list from the cast (until called, Customize shows a stand-in list). */
  setSkinCatalog(side: Side, catalog: SkinCatalog): void;
  /** Phase 3: a non-move line in the move list (powers, cards, bonuses, bonks, wheel, passes). `resetMoves` clears these too. */
  addLog(record: ActionRecord): void;
  /** Tell the HUD about a game the setup screen didn't start (names, clocks, bot side). Also resets the HUD. */
  setGameInfo(options: GameOptions): void;
  /** A friendly error line, e.g. when core rejects a FEN. */
  showError(message: string): void;

  // ----- Phase 3: game modes. The setup screen adds the mode picker; `GameOptions.mode` carries it. -----
  /** Render powers left, hand, duel tokens, die, round and next wheel/card. `null` hides the mode HUD (Classic). */
  setModeState(state: ModeState | null): void;
  /** The selected piece and its power button (emits `powerRequested`). */
  setSelection(sel: SelectionInfo | null): void;
  /** Aiming hint with a Cancel button (emits `cancelAction`), e.g. "Pick an empty square to block". null hides it. */
  setPrompt(text: string | null): void;
  /** The fate die tumbles and lands on `value`, with its effect called out. Resolves when it has settled (about 1s, skippable). */
  rollDie(side: Side, value: DieValue, effect: DieEffect): Promise<void>;
  /** After a 6: choose the bonus. Options that can't be used are disabled. */
  askLucky(side: Side, opts: { canRecharge: boolean; canStep: boolean }): Promise<'recharge' | 'pawnStep' | 'skip'>;
  /** A card flies into the hand. */
  showCardDrawn(side: Side, card: Card): Promise<void>;
  /** A played card flips big in the middle; jokers reveal their outcome. */
  showCardPlayed(side: Side, card: Card, joker?: JokerOutcome): Promise<void>;
  /** ♥ Revive: pick which captured animal comes back. null = cancelled. */
  askRevive(side: Side, pieces: PieceState[]): Promise<PieceId | null>;
  /** The defender decides whether to call a duel (shows both animals and tokens left). */
  askDuel(info: DuelInfo): Promise<boolean>;
  /** A secret jankenpon pick. `hotSeat`: local game, so cover the screen first and ask the right player to take the device. */
  askThrow(side: Side, opts: { hotSeat: boolean }): Promise<Hand>;
  /** Both hands slam down; the winner is called out. A tie says "again!". */
  showDuelRound(r: GameEventMap['duelRound']): Promise<void>;
  /** The wheel spins and stops on `outcome`, with its name and one line of what it does. */
  spinWheel(outcome: WheelOutcome): Promise<void>;

  // ----- Phase 4: party modes. The setup screen also offers 'sumo' and 'raid' (`GameOptions.mode`); `setGameInfo` gets them too. -----
  /**
   * Render the party-mode HUD: AP pips and an End turn button (emits `endTurn`, only for a human side to move),
   * animals left / out, powers, duel tokens, round and round cap; Sumo: "Island sinks in N"; Raid: score to `target`,
   * where each treasure is (home, dropped, carried by whom), "Wheel in N". null hides it.
   */
  setArenaState(state: ArenaState | null): void;
  /** A big short banner over the board ("The island sinks!", "Bone stolen!", "+1 Sea!"). Resolves when it has shown (about 1.2s, skippable). */
  announce(text: string, tone?: 'info' | 'good' | 'bad'): Promise<void>;
  dispose(): void;
}

export type AudioCue =
  | 'uiHover' | 'uiClick' | 'uiBack'
  | 'select' | 'deselect' | 'illegal'
  | 'moveLand' | 'moveSea' | 'capture' | 'castle' | 'promote'
  | 'check' | 'checkmate' | 'draw' | 'gameStart'
  | 'clockLow' | 'weird'
  // Phase 3
  | `power:${PowerKind}`
  | 'dieRoll' | 'dieBanana' | 'dieLucky'
  | 'cardDraw' | 'cardPlay' | 'joker'
  | 'duelCall' | 'duelThrow' | 'duelWin' | 'duelLose' | 'bonk'
  | 'wheelSpin' | 'wheelStop' | `chaos:${WheelOutcome}`
  | 'stun' | 'freeze' | 'block' | 'revive' | 'slip' | 'recharge'
  // Phase 4
  | 'step' | 'shove' | 'tag' | 'splash' | 'sinkWarn' | 'sink' | 'anchor'
  | 'pickup' | 'drop' | 'treasureHome' | 'score' | 'endTurn'
  | `voice:${Side}:${PieceKind}`
  | `emote:${EmoteKind}`;

export interface AudioEngine {
  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): Promise<void>;
  play(cue: AudioCue, opts?: { pan?: number; rate?: number }): void;
  setMusic(track: 'title' | 'game' | 'tense' | 'none'): void;
  setVolumes(music: number, sfx: number): void;
}
