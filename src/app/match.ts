/**
 * Match: wires core, world, cast, ui and audio into one playable game.
 *
 * Flow of a move: core emits `moved` -> core pauses (clocks stop, a bot reply is held) ->
 * the Director plays the animation, then the check / turn / result moments in order -> core resumes.
 */
import gsap from 'gsap';
import type {
  AudioEngine, Cast, EmoteKind, GameController, GameOptions, GameOver, MoveResult, PieceState, Settings, Side, Square, Ui, World,
} from '../contracts/types';
import { Director } from './director';
import { PieceBoard } from './pieces';

const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EMOTES: EmoteKind[] = ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'];

type Hold = 'anim' | 'menu';

export interface MatchDeps {
  game: GameController;
  world: World;
  cast: Cast;
  ui: Ui;
  audio: AudioEngine;
  /** The quality tier the world picked on its own (used when settings say "auto"). */
  autoQuality: World['quality'];
}

export class Match {
  readonly board: PieceBoard;
  private game: GameController;
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

  constructor(private deps: MatchDeps) {
    ({ game: this.game, world: this.world, cast: this.cast, ui: this.ui, audio: this.audio } = deps);
    this.appliedQuality = deps.world.quality;
    const s = this.ui.settings;
    this.board = new PieceBoard(this.world, this.cast, { land: s.landSkin, sea: s.seaSkin });
    this.director = new Director({ busy: () => this.hold('anim', true), idle: () => this.hold('anim', false) });

    this.ui.setSkinCatalog('land', this.cast.listSkins('land'));
    this.ui.setSkinCatalog('sea', this.cast.listSkins('sea'));
    this.applySettings(s);

    // The board as a backdrop for the title: the starting position, idling.
    this.board.sync(this.game.pieces, false);
    this.world.onFrame((dt, t) => this.board.update(dt, t));

    this.listenGame();
    this.listenWorld();
    this.listenCast();
    this.listenUi();
  }

  /** Start (or restart) a game. Shows the error and goes back to setup when core rejects the options. */
  start(options: GameOptions): void {
    try {
      this.game.newGame(options); // sets this.options via `gameStarted`
    } catch (err) {
      this.ui.showError(err instanceof Error ? err.message : String(err));
      this.ui.show('setup');
    }
  }

  // ---------- who plays ----------

  private get vsBot(): Side | null {
    const o = this.options?.opponent;
    return o?.type === 'bot' ? o.botSide : null;
  }

  /** The side at the bottom of the screen: you vs the bot, Land in local games. */
  private get homeSide(): Side {
    const bot = this.vsBot;
    return bot ? other(bot) : 'land';
  }

  private canPlay(): boolean {
    return this.active && !this.game.isOver() && this.game.turn !== this.vsBot && !this.director.busy && !this.promoting;
  }

  private pieceAt(sq: Square): PieceState | undefined {
    return this.game.pieces.find((p) => p.square === sq);
  }

  // ---------- pause bookkeeping ----------

  private hold(reason: Hold, on: boolean): void {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (this.holds.size) this.game.pause();
    else this.game.resume();
  }

  // ---------- core -> everyone ----------

  private listenGame(): void {
    const g = this.game;
    g.on('gameStarted', ({ options, pieces }) => {
      // Core fires this (and turnChanged) from inside newGame, so take the options from here.
      this.options = options;
      this.director.cancel();
      this.clearSelection();
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
        if (!this.vsBot && this.game.history.length && !this.game.isOver()) await this.world.faceSide(turn);
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
    g.on('undone', ({ pieces }) => {
      this.director.cancel();
      this.cast.skipAll();
      this.clearSelection();
      this.board.sync(pieces, true);
      const history = this.game.history;
      this.ui.resetMoves();
      for (const m of history) this.ui.addMove(m);
      const last = history[history.length - 1];
      this.world.setHighlights({ selected: null, legal: [], captures: [], check: null, lastMove: last ? [last.from, last.to] : null });
    });
    g.on('emote', ({ side, emote }) => {
      this.ui.showEmote(side, emote);
      const king = this.game.pieces.find((p) => p.side === side && p.kind === 'k');
      if (king) this.board.get(king.id)?.emote(emote);
    });
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
    if (m.promotion && m.promotedId) {
      this.board.remove(m.pieceId);
      const fresh = this.board.spawn({ id: m.promotedId, side: m.side, kind: m.promotion, square: m.to }, true);
      this.audio.play('promote');
      await this.board.popsDone();
      void fresh.celebrate();
    }
  }

  private async playGameOver(over: GameOver): Promise<void> {
    this.clearSelection();
    this.world.setHighlights({ selected: null, legal: [], captures: [] });
    const pieces = this.game.pieces;
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
    this.world.on('squareClicked', ({ square, boardSquare }) => this.onSquare(this.prefer(square, boardSquare)));
    this.world.on('squareHovered', ({ square, boardSquare }) => this.onHover(square && this.prefer(square, boardSquare)));
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
    if (highlights) this.world.setHighlights({ selected: null, legal: [], captures: [] });
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
    if (!this.game.move({ from, to, promotion })) {
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
    ui.on('undo', () => this.game.undo());
    ui.on('resign', () => this.game.resign(this.vsBot ? other(this.vsBot) : this.game.turn));
    ui.on('emote', ({ emote }) => {
      const side = this.vsBot ? other(this.vsBot) : this.game.turn;
      this.game.sendEmote(side, emote);
      // The bot sometimes answers.
      const bot = this.vsBot;
      if (bot && Math.random() < 0.4) {
        const reply = EMOTES[Math.floor(Math.random() * EMOTES.length)];
        setTimeout(() => this.active && this.game.sendEmote(bot, reply), 800 + Math.random() * 700);
      }
    });
    ui.on('settingsChanged', (s) => this.applySettings(s));
    ui.on('screenChanged', ({ screen }) => {
      if (screen === 'title' || screen === 'setup') this.active = false;
      if (screen === 'game') this.active = true;
      this.hold('menu', screen !== 'game');
      // The pause menu freezes the diorama and every animal mid-move.
      const frozen = screen === 'pause';
      this.world.setPaused(frozen);
      if (frozen) gsap.globalTimeline.pause();
      else gsap.globalTimeline.resume();
      if (screen !== 'game') this.clearSelection();
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
    this.board?.setSkin('land', s.landSkin);
    this.board?.setSkin('sea', s.seaSkin);
  }
}
