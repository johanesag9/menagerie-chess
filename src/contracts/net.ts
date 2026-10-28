/**
 * Phase 5 (2026-10-28): online play with a friend by invite link. See GAME_SPEC.md "Online play".
 *
 * How it works:
 * - A Cloudflare Worker (`server/`) gives each match a room (a Durable Object). The room runs core for that match and
 *   checks every input. It never trusts a browser.
 * - Both browsers run their own copy of core (a "mirror") with the same options and seed. The room broadcasts every
 *   accepted input in order, and each mirror applies it. Same seed + same inputs = the same game everywhere, so the
 *   3D board, HUD and animations run exactly as in a local game.
 * - Duel throws stay secret: the room holds the first throw until the second one arrives, then broadcasts both.
 * - Known limit (fine for friends): a player with dev tools could read the seed and predict dice and cards.
 *
 * Wire: JSON over one WebSocket per player. HTTP for creating and looking up rooms:
 * - POST `${base}/rooms` body `CreateRoomRequest` -> `CreateRoomResponse`
 * - GET  `${base}/rooms/:room` -> `RoomInfo` (404 when unknown or expired)
 * - WS   `${base}/rooms/:room/ws` -> `ClientMsg` up, `ServerMsg` down
 */
import type {
  ActionInput, ArenaAction, ArenaController, EmoteKind, EventSource, GameController, GameOptions, Hand, PlayMode, Side,
} from './types';

// ---------- inputs: everything that changes the game ----------

/** One input to core. Applied in the same order on the room's core and on every mirror. */
export type NetInput =
  /** Chess modes (Classic, Normal, Crazy): a move, power, card or lucky bonus, exactly as `GameController.act`. */
  | { k: 'act'; side: Side; input: ActionInput }
  /** Party modes (Sumo, Raid): exactly as `ArenaController.act` (endTurn included). */
  | { k: 'arena'; side: Side; action: ArenaAction }
  /** The defender's duel answer (`answerDuel`). */
  | { k: 'duel'; side: Side; call: boolean }
  /** A secret throw (`throwHand`). The room broadcasts a round's two throws together, attacker first. */
  | { k: 'throw'; side: Side; hand: Hand }
  | { k: 'resign'; side: Side };

/** An input as the room broadcasts it. `auto`: the room made it for an absent or slow player (the HUD says so). */
export interface SentInput {
  input: NetInput;
  auto?: 'timeout' | 'left';
}

// ---------- rooms ----------

export type RoomStatus = 'waiting' | 'playing' | 'over';
export type Presence = 'waiting' | 'here' | 'away' | 'left';

export interface CreateRoomRequest {
  /** `opponent` must be `{ type: 'online', you }`. The room picks the seed and forces `time` untimed and `weirdMode` off. */
  options: GameOptions;
}

export interface CreateRoomResponse {
  room: string;
  /** Rejoin token for the creator (keep it in localStorage, per room). */
  token: string;
  you: Side;
}

export interface RoomInfo {
  room: string;
  mode: PlayMode;
  /** The side a new joiner gets (the creator's other side), or null when the room is full. */
  openSide: Side | null;
  status: RoomStatus;
}

// ---------- messages ----------

export type ClientMsg =
  /** First message on every connection. `token` null = a new player taking the open side. `have` = inputs this mirror has applied (rejoin catch-up). */
  | { t: 'join'; token: string | null; have: number }
  /** `id` is echoed in `reject`. The room checks the side, the turn and legality with its own core. */
  | { t: 'input'; id: number; input: NetInput }
  /** My screen finished playing everything so far (the Director went idle). Starts my turn timer. */
  | { t: 'idle'; have: number }
  | { t: 'emote'; emote: EmoteKind }
  /** Ask for (or accept) a rematch. When both asked, the room starts a new game with sides swapped. */
  | { t: 'rematch' }
  /** Leaving on purpose (back to the title): counts as resigning if a game is on. */
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: Side; token: string; info: RoomInfo; opponent: Presence }
  /** A game starts (or the current one, on rejoin). `game` counts rematches from 0. Mirrors call newGame(options) with this seed. */
  | { t: 'start'; game: number; options: GameOptions }
  /** Inputs `from`, `from + 1`, ... of the current game, to apply in order. Also the catch-up after a rejoin. */
  | { t: 'inputs'; from: number; list: SentInput[] }
  | { t: 'reject'; id: number; reason: string }
  /** `msLeft`: until an away opponent forfeits (null unless away). */
  | { t: 'presence'; opponent: Presence; msLeft: number | null }
  /** The running turn timer: whose clock and the ms left when sent (null = no timer running). */
  | { t: 'timer'; side: Side | null; msLeft: number | null }
  | { t: 'emote'; side: Side; emote: EmoteKind }
  | { t: 'rematch'; side: Side }
  | { t: 'error'; reason: string }
  | { t: 'pong' };

// ---------- the browser side (src/net) ----------

export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface OnlineEventMap {
  connection: { state: Connection };
  presence: { opponent: Presence; graceEndsAt: number | null };
  /** A game began in the room (also after a rematch). The `game`/`arena` proxies now run it. */
  started: { game: number; options: GameOptions; you: Side };
  /**
   * The mirror jumped ahead without its usual events (a rejoin caught up silently). Integration redraws everything
   * from the controller's current state.
   */
  resync: { game: number };
  /** `endsAt` is local time (performance.now() based) when the turn timer runs out, or null. */
  timer: { side: Side | null; endsAt: number | null };
  emote: { side: Side; emote: EmoteKind };
  rematch: { side: Side };
  /** The room made an input for a player (time ran out, or they left). Fires just before the mirror applies it. */
  auto: { side: Side; why: 'timeout' | 'left' };
  /** The room refused one of my inputs (it should not happen; show the reason and redraw). */
  rejected: { reason: string };
  error: { reason: string };
}

/**
 * The online client. `game` and `arena` are stable proxies with the exact local interfaces: reads come from the
 * mirror; `act`, `move`, `answerDuel`, `throwHand`, `resign` send an input to the room instead (the change shows when
 * the room broadcasts it back); `newGame` and `undo` are ignored; `pause` does nothing to the game; `resume` tells the
 * room this screen is idle. Events are the mirror's events.
 */
export interface OnlineClient extends EventSource<OnlineEventMap> {
  readonly game: GameController;
  readonly arena: ArenaController;
  readonly you: Side | null;
  readonly room: string | null;
  readonly connection: Connection;
  /** Creates a room and joins it. `link` is the invite URL to share (`${location.origin}/?room=${room}`). */
  createRoom(options: GameOptions): Promise<{ room: string; link: string; you: Side }>;
  roomInfo(room: string): Promise<RoomInfo | null>;
  /** Joins (or rejoins, with the stored token) and resolves on `welcome`. */
  join(room: string): Promise<{ you: Side; info: RoomInfo }>;
  sendEmote(emote: EmoteKind): void;
  askRematch(): void;
  /** Leave the room for good (resigns a running game) and close the socket. */
  leave(): void;
  dispose(): void;
}

// ---------- the HUD (src/ui) ----------

/** What the game screen shows about an online match. */
export interface OnlineHud {
  connection: Connection;
  opponent: Presence;
  /** Local time (performance.now() based) when an away opponent forfeits, else null. */
  graceEndsAt: number | null;
  /** The turn timer, local time; null when none is running. */
  timer: { side: Side; endsAt: number } | null;
  rematch: 'none' | 'youAsked' | 'theyAsked';
}
