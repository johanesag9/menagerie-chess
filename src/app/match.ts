/**
 * Match: wires core, world, cast, ui and audio into one playable game.
 *
 * Flow of a move: core emits `moved` -> core pauses (clocks stop, a bot reply is held) ->
 * the Director plays the animation, then the check / turn / result moments in order -> core resumes.
 * Normal and Crazy add powers, cards, the die, duels and the wheel: same idea, one Director task per event
 * (animations in `modes.ts`), and questions to the player (lucky bonus, duel, throws) are tasks too.
 */
import gsap from 'gsap';
import { isArenaMode } from '../contracts/types';
import type { OnlineClient } from '../contracts/net';
import type {
  ActionInput, ArenaController, AudioEngine, Cast, DuelInfo, EmoteKind, GameController, GameOptions, GameOver, ModeState, MoveResult, PendingAction,
  PieceId, PieceState, PieceStatusKind, Settings, Side, Square, Ui, World,
} from '../contracts/types';
import { ArenaMatch } from './arena';
import { Director } from './director';
import { OnlineFlow } from './online';
import { switchable, type Switchable } from './switch';
import { ModeShow } from './modes';
import { PieceBoard } from './pieces';

const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EMOTES: EmoteKind[] = ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'];

type Hold = 'anim' | 'menu';

export interface MatchDeps {
  game: GameController;
  /** Sumo and Raid. */
  arena: ArenaController;
  /** Online with a friend (Phase 5): its `game` and `arena` proxies stand in for the local controllers. */
  online: OnlineClient;
  world: World;
  cast: Cast;
  ui: Ui;
  audio: AudioEngine;
  /** The quality tier the world picked on its own (used when settings say "auto"). */
  autoQuality: World['quality'];
}

export class Match {
  readonly board: PieceBoard;
  private game: Switchable<GameController>;
  private arenaCtl: Switchable<ArenaController>;
  private onlineFlow: OnlineFlow;
  private world: World;
  private cast: Cast;
  private ui: Ui;
  private audio: AudioEngine;
  private director: Director;

  private options: GameOptions | null = null;
  private active = false;
  private introPlayed = false;
  private holds = new Set<Hold>();
  private selected: Square | null = null;
  private targets: Square[] = [];
  private hovered: string | null = null;
  private promoting = false;
  private appliedQuality: World['quality'];
  // Normal and Crazy
  private show: ModeShow;
  private aim: PendingAction | null = null;
  private duel: DuelInfo | null = null;
  private statuses = new Map<PieceId, PieceStatusKind>();
  private reduced = false;
  // Sumo and Raid: `party` is on while one runs; clicks and UI events go to `arena` then.
  private arena: ArenaMatch;
  private party = false;

  constructor(private deps: MatchDeps) {
    ({ world: this.world, cast: this.cast, ui: this.ui, audio: this.audio } = deps);
    // Local controllers by default; an online game swaps both to the online proxies.
    this.game = switchable([deps.game, deps.online.game]);
    this.arenaCtl = switchable([deps.arena, deps.online.arena]);
    this.appliedQuality = deps.world.quality;
    const s = this.ui.settings;
    this.board = new PieceBoard(this.world, this.cast, { land: s.landSkin, sea: s.seaSkin });
    this.director = new Director({
      busy: () => this.hold('anim', true),
      idle: () => {
        // Safety net: once everything has played, the animals stand exactly where core says (core is still paused here).
        if (this.active) {
          if (this.party) this.arena.syncBoard();
          else this.board.sync(this.game.pieces, true);
        }
        this.hold('anim', false);
      },
    });
    this.show = new ModeShow({
      board: this.board, world: this.world, cast: this.cast, ui: this.ui, audio: this.audio, reducedMotion: () => this.reduced,
      squareOf: (id) => this.arenaCtl.state.pieces.find((p) => p.id === id)?.square,
    });
    this.arena = new ArenaMatch({
      arena: this.arenaCtl, board: this.board, director: this.director, show: this.show,
      world: this.world, cast: this.cast, ui: this.ui, audio: this.audio,
      isActive: () => this.active, reducedMotion: () => this.reduced,
      playStart: (pieces) => this.playStart(pieces),
      playGameOver: (over, pieces) => this.playGameOver(over, pieces),
    });

    this.ui.setSkinCatalog('land', this.cast.listSkins('land'));
    this.ui.setSkinCatalog('sea', this.cast.listSkins('sea'));
    this.applySettings(s);

    // The board as a backdrop for the title: the starting position, idling.
    this.board.sync(this.game.pieces, false);
    this.world.onFrame((dt, t) => this.board.update(dt, t));

    this.onlineFlow = new OnlineFlow({
      online: deps.online, ui: this.ui,
      begin: (o) => this.beginOnline(o),
      end: () => this.useLocal(),
      resync: (over) => this.resync(over),
      emote: (side, emote) => this.arena.emote(side, emote),
      isParty: () => this.party,
    });

    this.listenGame();
    this.listenWorld();
    this.listenCast();
    this.listenUi();
  }

  /** Start (or restart) a game. Shows the error and goes back to setup when core rejects the options. */
  start(options: GameOptions): void {
    if (options.opponent.type === 'online') {
      void this.onlineFlow.create(options);
      return;
    }
    this.onlineFlow.leave();
    this.useLocal();
    try {
      if (isArenaMode(options.mode)) {
        this.party = true;
        this.options = options;
        this.game.pause();
        this.arena.start(options);
        this.applyHolds();
        return;
      }
      if (this.party) this.arena.stop();
      this.party = false;
      this.game.newGame(options); // sets this.options via `gameStarted`
      this.applyHolds();
    } catch (err) {
      this.ui.showError(err instanceof Error ? err.message : String(err));
      this.ui.show('setup');
    }
  }

  /** On load: join from a `?room=` invite link, if there is one. */
  joinFromUrl(): Promise<void> {
    return this.onlineFlow.joinFromUrl();
  }

  private useLocal(): void {
    this.game.use(this.deps.game);
    this.arenaCtl.use(this.deps.arena);
    this.applyHolds();
  }

  /** An online game starts (or a rejoin): run it on the online proxies, before the mirror's first events. */
  private beginOnline(options: GameOptions): void {
    this.director.cancel();
    this.clearSelection();
    this.game.use(this.deps.online.game);
    this.arenaCtl.use(this.deps.online.arena);
    const party = isArenaMode(options.mode);
    if (this.party && !party) this.arena.stop();
    this.party = party;
    this.options = options;
    if (party) this.arena.prepare();
    this.applyHolds();
  }

  /** Online rejoin: the game jumped ahead with no events; redraw it all. */
  private resync(over: GameOver | null): void {
    if (this.party) this.arena.resync();
    else {
      this.ui.setModeState(this.modes ? this.game.modeState : null);
      this.ui.setTurn(this.game.turn);
      this.redraw(this.game.pieces);
      void this.world.faceSide(this.homeSide, false);
      over ??= this.game.isOver();
    }
    // A rejoin into a finished game: its gameOver went by unseen, so go straight to the result (and Rematch).
    if (over) this.director.push(async () => this.ui.showResult(over));
  }

  // ---------- who plays ----------

  /** The side this screen doesn't play: the bot's, or the friend's online. Null in local games. */
  private get remote(): Side | null {
    const o = this.options?.opponent;
    return o?.type === 'bot' ? o.botSide : o?.type === 'online' ? other(o.you) : null;
  }

  /** The side at the bottom of the screen: you vs the bot, Land in local games. */
  private get homeSide(): Side {
    const bot = this.remote;
    return bot ? other(bot) : 'land';
  }

  private get modes(): boolean {
    return this.game.mode !== 'classic';
  }

  private canPlay(): boolean {
    if (!(this.active && !this.game.isOver() && this.game.turn !== this.remote && !this.director.busy && !this.promoting)) return false;
    if (!this.modes) return true;
    // A lucky 6 waits for the bonus; everything else waits for an action.
    return this.game.modeState?.phase === (this.aim?.type === 'bonus' ? 'bonus' : 'action');
  }

  private pieceAt(sq: Square): PieceState | undefined {
    return this.game.pieces.find((p) => p.square === sq);
  }

  // ---------- pause bookkeeping ----------

  private hold(reason: Hold, on: boolean): void {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.applyHolds();
  }

  /** The controller not in use stays paused; the one in use follows the holds. */
  private applyHolds(): void {
    const [live, idle] = this.party ? [this.arenaCtl, this.game] : [this.game, this.arenaCtl];
    idle.pause();
    if (this.holds.size) live.pause();
    else live.resume();
  }

  // ---------- core -> everyone ----------

  private listenGame(): void {
    const g = this.game;
    g.on('gameStarted', ({ options, pieces }) => {
      // Core fires this (and turnChanged) from inside newGame, so take the options from here.
      this.options = options;
      this.director.cancel();
      this.clearSelection();
      this.duel = null;
      this.statuses.clear();
      for (const a of this.board.all()) a.setStatus(null);
      if ((options.mode ?? 'classic') === 'classic') {
        this.ui.setModeState(null);
        this.world.setSquareEffects([]);
      }
      this.director.push(() => this.playStart(pieces));
    });
    g.on('moved', (m) => {
      this.clearSelection();
      this.world.setHighlights({ selected: null, legal: [], captures: [], lastMove: [m.from, m.to], check: null });
      this.director.push(() => this.playMove(m));
    });
    g.on('check', ({ side, kingSquare }) => {
      this.director.push(() => {
        this.world.setHighlights({ check: kingSquare });
        // On checkmate the result card says it all; a banner on top would clash.
        if (!this.game.isOver()) this.ui.showCheck(side);
        const king = this.pieceAt(kingSquare);
        if (king) this.board.get(king.id)?.emote('shock');
      });
    });
    g.on('turnChanged', ({ turn }) => {
      this.director.push(async () => {
        this.ui.setTurn(turn);
        // Local games: swing the camera round to whoever moves next.
        if (!this.remote && this.game.history.length && !this.game.isOver()) await this.world.faceSide(turn);
      });
    });
    g.on('gameOver', (over) => this.director.push(() => this.playGameOver(over)));
    g.on('weirdEvent', (e) => {
      this.director.push(() => {
        this.ui.showWeirdEvent(e);
        void this.world.playWeirdEvent(e);
      });
    });
    g.on('clock', ({ landMs, seaMs, running }) => this.ui.setClocks(landMs, seaMs, running));
    g.on('botThinking', ({ thinking }) => this.ui.setBotThinking(thinking));
    g.on('undone', ({ pieces }) => this.redraw(pieces));
    this.listenModes();
    g.on('emote', ({ side, emote }) => {
      this.ui.showEmote(side, emote);
      const king = this.game.pieces.find((p) => p.side === side && p.kind === 'k');
      if (king) this.board.get(king.id)?.emote(emote);
    });
  }

  /** Board, move list and mode HUD straight from core's state (after an undo or an online rejoin). */
  private redraw(pieces: PieceState[]): void {
    this.director.cancel();
    this.cast.skipAll();
    this.clearSelection();
    this.board.sync(pieces, true);
    const history = this.game.history;
    this.ui.resetMoves();
    if (this.modes) {
      // The log has every line in order; moves come from history.
      let i = 0;
      for (const r of this.game.log) {
        if (r.kind === 'move') {
          const m = history[i++];
          if (m) this.ui.addMove(m);
        } else this.ui.addLog(r);
      }
      if (this.game.modeState) this.director.push(() => this.applyModeState(this.game.modeState!));
    } else for (const m of history) this.ui.addMove(m);
    const last = history[history.length - 1];
    this.world.setHighlights({ selected: null, legal: [], captures: [], check: null, lastMove: last ? [last.from, last.to] : null });
  }

  // ---------- Normal and Crazy ----------

  private listenModes(): void {
    const g = this.game;
    const push = (fn: () => unknown) => this.director.push(fn);
    g.on('modeState', (s) => push(() => this.applyModeState(s)));
    g.on('powerUsed', (r) => {
      this.clearSelection();
      this.world.setHighlights({ lastMove: null, check: null });
      push(() => this.show.power(r));
    });
    g.on('cardPlayed', (r) => {
      this.clearSelection();
      this.world.setHighlights({ lastMove: null, check: null });
      push(() => this.show.card(r));
    });
    g.on('bonusUsed', (r) => {
      this.clearSelection();
      push(() => this.show.changes(r.changes));
    });
    g.on('dieRolled', (e) => push(() => this.ui.rollDie(e.side, e.value, e.effect)));
    g.on('cardDrawn', (e) => push(() => this.ui.showCardDrawn(e.side, e.card)));
    g.on('wheelSpun', (w) => {
      this.clearSelection();
      push(() => this.show.wheel(w));
    });
    g.on('logged', (r) => {
      if (r.kind !== 'move') push(() => this.ui.addLog(r));
    });
    g.on('duelOffered', (info) => {
      this.clearSelection();
      this.duel = info;
      push(() => this.offerDuel(info));
    });
    g.on('duelRound', (r) => push(() => this.ui.showDuelRound(r)));
    g.on('duelEnded', () => push(() => (this.duel = null)));
    g.on('bonked', ({ info }) => push(() => this.show.bonk(info)));
  }

  /** HUD, blocked squares and status looks from a snapshot; then any question the snapshot asks. */
  private async applyModeState(s: ModeState): Promise<void> {
    this.ui.setModeState(s);
    (this.ui as Partial<{ setPieces(p: PieceState[]): void }>).setPieces?.(this.game.pieces);
    this.world.setSquareEffects(s.squares);
    const want = new Map(s.statuses.map((x) => [x.pieceId, x.status]));
    for (const a of this.board.all()) {
      const next = want.get(a.id) ?? null;
      if ((this.statuses.get(a.id) ?? null) === next) continue;
      a.setStatus(next);
      if (next) this.statuses.set(a.id, next);
      else this.statuses.delete(a.id);
    }
    // Phase 'duel' arrives at the start of every throw round.
    if (s.phase === 'duel' && this.duel) await this.askThrows(this.duel);
    else if (s.phase === 'bonus') await this.askLucky();
  }

  private async offerDuel(info: DuelInfo): Promise<void> {
    this.show.faceOff(info);
    if (info.defender === this.remote) return; // the bot answers by itself once core resumes
    this.game.answerDuel(await this.ui.askDuel(info));
  }

  private async askThrows(info: DuelInfo): Promise<void> {
    const bot = this.remote;
    if (bot === info.defender) this.audio.play('duelCall');
    for (const side of [info.attacker, info.defender]) {
      if (side === bot) continue;
      this.game.throwHand(side, await this.ui.askThrow(side, { hotSeat: !bot }));
    }
  }

  /** A lucky 6 for a human side: pick a bonus (then aim it on the board) or skip. */
  private async askLucky(): Promise<void> {
    const g = this.game;
    if (g.modeState?.phase !== 'bonus' || g.turn === this.remote || g.isOver()) return;
    const can = (choice: 'recharge' | 'pawnStep') => g.targets({ type: 'bonus', choice, targets: [] }).squares.length > 0;
    const choice = await this.ui.askLucky(g.turn, { canRecharge: can('recharge'), canStep: can('pawnStep') });
    if (choice === 'skip') g.act({ type: 'bonus', choice: 'skip' });
    else this.startAim({ type: 'bonus', choice, targets: [] });
  }

  private startAim(pending: PendingAction): void {
    this.aim = pending;
    this.refreshAim();
  }

  /** Show the squares the half-built power, card or bonus can pick next; submit once nothing more is needed. */
  private refreshAim(): void {
    const aim = this.aim;
    if (!aim) return;
    const step = this.game.targets(aim);
    if (step.complete && !step.squares.length) return this.submitAim();
    if (!step.squares.length) {
      this.audio.play('illegal');
      this.ui.showError(step.prompt);
      return this.cancelAim();
    }
    this.targets = step.squares;
    this.world.setHighlights({ legal: [], captures: [], targets: step.squares, area: this.game.previewArea(aim) });
    this.ui.setPrompt(step.prompt);
  }

  private onAimSquare(sq: Square): void {
    const aim = this.aim!;
    if (!this.targets.includes(sq)) {
      this.audio.play('deselect');
      return this.cancelAim();
    }
    this.audio.play('select');
    this.aim = { ...aim, targets: [...aim.targets, sq] } as PendingAction;
    this.refreshAim();
  }

  private submitAim(): void {
    const input = this.aim as ActionInput;
    this.clearSelection();
    const r = this.game.act(input);
    if (!r.ok) {
      this.audio.play('illegal');
      this.ui.showError(r.reason);
    }
  }

  /** Back out of aiming. A lucky bonus asks again, since it still has to be taken or skipped. */
  private cancelAim(): void {
    const wasBonus = this.aim?.type === 'bonus';
    this.clearSelection();
    if (wasBonus) this.director.push(() => this.askLucky());
  }

  private async playCard(cardId: string): Promise<void> {
    const side = this.game.turn;
    const state = this.game.modeState;
    if (!this.canPlay() || this.aim?.type === 'bonus' || !state || !this.game.canPlayCard(side, cardId)) {
      this.audio.play('illegal');
      return;
    }
    this.clearSelection();
    const card = state[side].hand.find((c) => c.id === cardId);
    if (card?.suit === 'hearts') {
      this.promoting = true; // blocks board input while the picker is open
      let pieceId: PieceId | null;
      try {
        pieceId = await this.ui.askRevive(side, state[side].captured.filter((p) => p.kind !== 'k'));
      } finally {
        this.promoting = false;
      }
      if (!pieceId) return;
      return this.startAim({ type: 'card', cardId, pieceId, targets: [] });
    }
    this.startAim({ type: 'card', cardId, targets: [] });
  }

  // ---------- game moments ----------

  private async playStart(pieces: PieceState[]): Promise<void> {
    this.world.setHighlights({ selected: null, legal: [], captures: [], lastMove: null, check: null });
    this.board.sync(pieces, true);
    this.audio.play('gameStart');
    if (!this.introPlayed) {
      this.introPlayed = true;
      await this.world.faceSide(this.homeSide, false);
      await Promise.all([this.world.playIntro(), this.board.popsDone()]);
    } else {
      await Promise.all([this.world.faceSide(this.homeSide), this.board.popsDone()]);
    }
  }

  private async playMove(m: MoveResult): Promise<void> {
    this.ui.addMove(m);
    const actor = this.board.get(m.pieceId);
    if (!actor) {
      this.board.sync(this.game.pieces, true);
      return;
    }
    // Work out world points at the moment each move starts: Weird Mode may tilt or hop the board meanwhile.
    const to = () => this.board.point(m.to);
    const victim = m.captured && this.board.get(m.captured.id);
    if (victim) {
      this.audio.play(`voice:${m.side}:${m.kind}`);
      await actor.attack(victim);
      this.board.forget(victim.id);
      void victim.defeat(actor).then(() => victim.dispose());
      await actor.moveTo(to());
    } else if (m.rookMove) {
      const rook = this.board.get(m.rookMove.pieceId);
      this.audio.play('castle');
      await Promise.all([actor.moveTo(to()), rook?.moveTo(this.board.point(m.rookMove.to))]);
    } else {
      await actor.moveTo(to());
    }
    // Crazy banana peel: slip one more square.
    if (m.slide) await this.show.slip(actor, this.board.point(m.slide.to));
    if (m.promotion && m.promotedId) {
      this.board.remove(m.pieceId);
      const fresh = this.board.spawn({ id: m.promotedId, side: m.side, kind: m.promotion, square: m.slide?.to ?? m.to }, true);
      this.audio.play('promote');
      await this.board.popsDone();
      void fresh.celebrate();
    }
  }

  private async playGameOver(over: GameOver, pieces = this.game.pieces): Promise<void> {
    this.clearSelection();
    this.world.setHighlights({ selected: null, legal: [], captures: [] });
    const king = (s: Side) => pieces.find((p) => p.side === s && p.kind === 'k');
    if (over.winner) {
      const loser = king(other(over.winner));
      if (loser) {
        if (over.reason === 'checkmate') void this.world.focusOn(this.board.point(loser.square), 0.8);
        this.board.get(loser.id)?.emote(over.reason === 'checkmate' ? 'shock' : 'sleepy');
      }
      const winners = this.board.all().filter((a) => a.side === over.winner);
      winners.forEach((a, i) => gsap.delayedCall(0.15 + i * 0.04, () => void a.celebrate()));
      await wait(1600);
    } else {
      for (const s of ['land', 'sea'] as const) {
        const k = king(s);
        if (k) this.board.get(k.id)?.emote('shock');
      }
      await wait(1000);
    }
    this.ui.showResult(over);
  }

  // ---------- input ----------

  private listenWorld(): void {
    this.world.on('squareClicked', ({ square, boardSquare }) => {
      if (this.party) this.arena.onSquare(this.arena.prefer(square, boardSquare));
      else this.onSquare(this.prefer(square, boardSquare));
    });
    this.world.on('squareHovered', ({ square, boardSquare }) => {
      if (this.party) this.arena.onHover(square && this.arena.prefer(square, boardSquare));
      else this.onHover(square && this.prefer(square, boardSquare));
    });
  }

  /**
   * A tall animal can stand in front of a square. With a piece selected, a click that lands on the board
   * inside a legal target counts as that move, even when an animal's silhouette covers the spot.
   */
  private prefer(square: Square, boardSquare?: Square | null): Square {
    if (boardSquare && boardSquare !== square && this.targets.includes(boardSquare) && !this.targets.includes(square)) return boardSquare;
    return square;
  }

  private onSquare(sq: Square): void {
    if (!this.active) return;
    // Any click during an animation skips it.
    if (this.director.busy) {
      this.board.finishPops();
      this.cast.skipAll();
      return;
    }
    if (!this.canPlay()) return;
    if (this.aim) return this.onAimSquare(sq);
    const turn = this.game.turn;
    const piece = this.pieceAt(sq);

    if (this.selected) {
      if (this.targets.includes(sq)) return void this.tryMove(this.selected, sq);
      if (piece?.square === this.selected) {
        this.audio.play('deselect');
        return this.clearSelection();
      }
      if (piece?.side === turn) return this.select(piece);
      this.audio.play('illegal');
      return this.clearSelection();
    }
    if (piece?.side === turn) this.select(piece);
    else if (piece) this.audio.play('illegal');
  }

  private select(p: PieceState): void {
    this.clearSelection(false);
    this.selected = p.square;
    this.targets = this.game.legalTargets(p.square);
    const captures = this.targets.filter((t) => {
      const there = this.pieceAt(t);
      // En passant: a pawn moving diagonally onto an empty square also captures.
      return there ? there.side !== p.side : p.kind === 'p' && t[0] !== p.square[0];
    });
    this.world.setHighlights({ selected: p.square, legal: this.targets.filter((t) => !captures.includes(t)), captures });
    this.board.get(p.id)?.setSelected(true);
    if (this.modes) this.ui.setSelection({ pieceId: p.id, side: p.side, kind: p.kind, power: this.game.powerInfo(p.id) });
    this.audio.play('select');
    this.audio.play(`voice:${p.side}:${p.kind}`);
  }

  private clearSelection(highlights = true): void {
    if (this.selected) {
      const p = this.pieceAt(this.selected);
      if (p) this.board.get(p.id)?.setSelected(false);
    }
    this.selected = null;
    this.targets = [];
    if (this.aim) {
      this.aim = null;
      this.ui.setPrompt(null);
    }
    this.ui.setSelection(null);
    if (highlights) this.world.setHighlights({ selected: null, legal: [], captures: [], targets: [], area: [] });
  }

  private async tryMove(from: Square, to: Square): Promise<void> {
    let promotion: Parameters<GameController['move']>[0]['promotion'];
    if (this.game.needsPromotion(from, to)) {
      this.promoting = true;
      try {
        promotion = await this.ui.askPromotion(this.game.turn);
      } finally {
        this.promoting = false;
      }
    }
    // act(), not move(): in Crazy a capture can wait on a duel, which move() would report as null.
    const r = this.game.act({ type: 'move', from, to, ...(promotion ? { promotion } : {}) });
    if (!r.ok) {
      this.audio.play('illegal');
      this.clearSelection();
    }
  }

  private onHover(sq: Square | null): void {
    const p = sq && this.canPlay() ? this.pieceAt(sq) : undefined;
    const id = p && p.side === this.game.turn ? p.id : null;
    if (id !== this.hovered) {
      if (this.hovered) this.board.get(this.hovered)?.setHovered(false);
      if (id) this.board.get(id)?.setHovered(true);
      this.hovered = id;
    }
    const pointer = !!id || (!!sq && this.targets.includes(sq));
    this.world.renderer.domElement.style.cursor = pointer ? 'pointer' : '';
  }

  // ---------- cast moments: sound, shake, punch-in ----------

  private listenCast(): void {
    const pan = (x: number) => Math.max(-1, Math.min(1, x / 4));
    const sideOf = (id: string): Side => (id.startsWith('land') ? 'land' : 'sea');
    this.cast.on('land', ({ id, at }) => this.audio.play(sideOf(id) === 'land' ? 'moveLand' : 'moveSea', { pan: pan(at.x) }));
    this.cast.on('splash', ({ at, intensity }) => {
      this.world.splash(at, intensity >= 1);
      this.audio.play('splash', { pan: pan(at.x) });
    });
    this.cast.on('stomp', ({ intensity }) => this.world.shake(0.3 * intensity));
    this.cast.on('impact', ({ at, intensity }) => {
      this.audio.play('capture', { pan: pan(at.x) });
      this.world.shake(0.15 + 0.35 * intensity);
      void this.world.focusOn(at, 0.35 + 0.4 * intensity);
    });
  }

  // ---------- ui -> game ----------

  private listenUi(): void {
    const ui = this.ui;
    ui.on('rematch', () => this.options && this.start(this.options));
    ui.on('undo', () => !this.party && this.game.undo());
    ui.on('resign', () => (this.party ? this.arena.resign() : this.game.resign(this.remote ? other(this.remote) : this.game.turn)));
    ui.on('endTurn', () => this.party && this.arena.endTurn());
    ui.on('emote', ({ emote }) => {
      // Online: the room sends it back to both screens.
      if (this.onlineFlow.active) return this.deps.online.sendEmote(emote);
      if (this.party) {
        const bot = this.arena.isBot ? this.arena.remote : null;
        this.arena.emote(bot ? other(bot) : this.arenaCtl.state.turn, emote);
        if (bot && Math.random() < 0.4) {
          const reply = EMOTES[Math.floor(Math.random() * EMOTES.length)];
          setTimeout(() => this.active && this.party && this.arena.emote(bot, reply), 800 + Math.random() * 700);
        }
        return;
      }
      const side = this.remote ? other(this.remote) : this.game.turn;
      this.game.sendEmote(side, emote);
      // The bot sometimes answers.
      const bot = this.options?.opponent.type === 'bot' ? this.remote : null;
      if (bot && Math.random() < 0.4) {
        const reply = EMOTES[Math.floor(Math.random() * EMOTES.length)];
        setTimeout(() => this.active && this.game.sendEmote(bot, reply), 800 + Math.random() * 700);
      }
    });
    ui.on('settingsChanged', (s) => this.applySettings(s));
    ui.on('powerRequested', ({ pieceId }) => {
      if (this.party) return this.arena.requestPower(pieceId);
      const p = this.game.pieces.find((x) => x.id === pieceId);
      if (!p || !this.canPlay() || this.aim?.type === 'bonus' || !this.game.powerInfo(pieceId).available) {
        this.audio.play('illegal');
        return;
      }
      const square = this.selected;
      this.clearSelection(false);
      this.selected = square;
      this.world.setHighlights({ selected: p.square });
      this.board.get(p.id)?.setSelected(true);
      this.startAim({ type: 'power', pieceId, targets: [] });
    });
    ui.on('cardRequested', ({ cardId }) => !this.party && void this.playCard(cardId));
    ui.on('cancelAction', () => (this.party ? this.arena.clearSelection() : this.cancelAim()));
    ui.on('screenChanged', ({ screen }) => {
      if (screen === 'title' || screen === 'setup') {
        this.active = false;
        // Leaving an online game on purpose resigns it (the invite overlay sits on setup, so only a real change counts).
        if (this.onlineFlow.active && this.options?.opponent.type === 'online') this.onlineFlow.leave();
      }
      if (screen === 'game') this.active = true;
      this.hold('menu', screen !== 'game');
      // The pause menu freezes the diorama and every animal mid-move.
      const frozen = screen === 'pause';
      this.world.setPaused(frozen);
      if (frozen) gsap.globalTimeline.pause();
      else gsap.globalTimeline.resume();
      if (screen !== 'game') {
        this.clearSelection();
        this.arena.clearSelection();
      }
    });
  }

  private applySettings(s: Settings): void {
    const q = s.quality === 'auto' ? this.deps.autoQuality : s.quality;
    if (q !== this.appliedQuality) {
      this.appliedQuality = q;
      this.world.setQuality(q);
    }
    this.world.setCoordinatesVisible(s.showCoordinates);
    this.world.setReducedMotion(s.reducedMotion);
    this.cast.setReducedMotion(s.reducedMotion);
    this.reduced = s.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.board?.setSkin('land', s.landSkin);
    this.board?.setSkin('sea', s.seaSkin);
  }
}
