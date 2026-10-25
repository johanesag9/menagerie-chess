/**
 * Shared contracts between the four build streams (core, world, cast, ui/audio).
 * Owned by the orchestrator. Sessions read these; they do not edit them.
 * Need a change? Note it in your session report and the orchestrator updates it.
 */
import type { Object3D, Vector3 } from 'three';

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
  check: boolean;
  fenAfter: string;
}

export type GameOverReason =
  | 'checkmate' | 'stalemate' | 'threefold' | 'fiftyMove' | 'insufficient'
  | 'resign' | 'timeout' | 'agreement';

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
  opponent: Opponent;
  time: TimeControl;
  weirdMode: boolean;
  /** Start from a custom position. Default = standard start. */
  fen?: string;
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
  | 'tideSwap'      // cosmetic: board colours swap land/sea theme briefly
  | 'disco';        // cosmetic: lights go party mode for one turn

export interface WeirdEvent {
  kind: WeirdEventKind;
  /** Squares the effect focuses on, if any. */
  squares?: Square[];
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
}

// ---------- Session B: world ----------

export type QualityTier = 'high' | 'low';

export interface WorldEventMap {
  squareClicked: { square: Square };
  squareHovered: { square: Square | null };
}

export interface HighlightSet {
  selected?: Square | null;
  legal?: Square[];
  captures?: Square[];
  lastMove?: [Square, Square] | null;
  check?: Square | null;
}

export interface World extends EventSource<WorldEventMap> {
  readonly quality: QualityTier;
  /** Centre of a square on the board surface, in world space. */
  squareToWorld(square: Square): Vector3;
  /** Size of one square in world units (pieces scale to this). */
  readonly squareSize: number;
  /** Root that pieces get added to. */
  readonly pieceLayer: Object3D;
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
  dispose(): void;
}

export interface WorldOptions {
  container: HTMLElement;
  quality?: QualityTier; // default: auto-detect
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
  /** Travel animation in the animal's own style. Resolves on arrival. */
  moveTo(target: Vector3, opts?: { duration?: number }): Promise<void>;
  /** Attack lunge toward a victim. Resolves at the moment of impact. */
  attack(victim: PieceActor): Promise<void>;
  /** Defeat animation (slapstick, never gory). Resolves when it has left the board. */
  defeat(by: PieceActor): Promise<void>;
  /** Happy reaction (won the game, made a great capture). Promotion is handled by integration: it disposes the pawn and creates a new actor. */
  celebrate(): Promise<void>;
  emote(e: EmoteKind): void;
  setSkin(skin: SkinChoice): void;
  dispose(): void;
}

export interface Cast {
  createPiece(state: PieceState, skin?: SkinChoice): PieceActor;
  /** Skins the UI can offer, per side. */
  listSkins(side: Side): { palettes: { id: string; name: string; swatch: string }[]; accessories: { id: string; name: string }[] };
  /** Display names, e.g. ('sea','n') -> 'Seahorse'. */
  displayName(side: Side, kind: PieceKind): string;
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
  dispose(): void;
}

export type AudioCue =
  | 'uiHover' | 'uiClick' | 'uiBack'
  | 'select' | 'deselect' | 'illegal'
  | 'moveLand' | 'moveSea' | 'capture' | 'castle' | 'promote'
  | 'check' | 'checkmate' | 'draw' | 'gameStart'
  | 'clockLow' | 'weird'
  | `voice:${Side}:${PieceKind}`
  | `emote:${EmoteKind}`;

export interface AudioEngine {
  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): Promise<void>;
  play(cue: AudioCue, opts?: { pan?: number; rate?: number }): void;
  setMusic(track: 'title' | 'game' | 'tense' | 'none'): void;
  setVolumes(music: number, sfx: number): void;
}
