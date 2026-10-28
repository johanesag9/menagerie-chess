/**
 * ArenaMatch: Sumo and Raid (the party modes), and Sandcastle King and Stepping Stones (Phase 6 board games), on the 3D board.
 *
 * Same idea as `Match`: every core event becomes one Director task, core stays paused while tasks play, and the
 * `state` snapshot is the source of truth for the HUD, statuses, blocks, sunk squares and treasures.
 * `Match` owns the shared pieces (board, director, camera, settings) and forwards clicks and UI events here
 * while a party game is on.
 */
import { isBoardMode } from '../contracts/types';
import type {
  ArenaAction, ArenaController, ArenaEventMap, ArenaPieceOptions, ArenaState, AudioEngine, Cast, DuelInfo, GameOptions, GameOver,
  PieceActor, PieceId, PieceKind, PieceState, PieceStatusKind, ShapeOption, Side, Square, Ui, World,
} from '../contracts/types';
import type { Director } from './director';
import type { ModeShow } from './modes';
import type { PieceBoard } from './pieces';

const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const NAME: Record<Side, string> = { land: 'Land', sea: 'Sea' };

/** Sandcastle King traits for the draft cards (GAME_SPEC "Board-game modes"). The same for both sides. */
const TRAITS: Record<PieceKind, { name: string; line: string }> = {
  p: { name: 'Digger', line: 'After a dig, it may dig once more.' },
  n: { name: 'Leaper', line: 'It may move with a knight hop instead of a step.' },
  b: { name: 'Climber', line: 'It may go up 2 levels in one step.' },
  r: { name: 'Builder', line: 'A build adds 2 levels.' },
  q: { name: 'Shover', line: 'Instead of moving, it may push a neighbouring enemy.' },
  k: { name: 'Zoomer', line: 'Its move may be 2 steps.' },
};

export interface ArenaMatchDeps {
  arena: ArenaController;
  board: PieceBoard;
  director: Director;
  show: ModeShow;
  world: World;
  cast: Cast;
  ui: Ui;
  audio: AudioEngine;
  /** True while the game screen is up. */
  isActive: () => boolean;
  reducedMotion: () => boolean;
  playStart: (pieces: PieceState[]) => Promise<void>;
  playGameOver: (over: GameOver, pieces: PieceState[]) => Promise<void>;
}

export class ArenaMatch {
  private options: GameOptions | null = null;
  private selected: PieceState | null = null;
  private opts: ArenaPieceOptions | null = null;
  private aim: { pieceId: PieceId; targets: Square[] } | null = null;
  /** Squares a click does something on right now. */
  private targets: Square[] = [];
  private hovered: PieceId | null = null;
  private previewing: Square | null = null;
  private duel: DuelInfo | null = null;
  private asking = false;
  private firstTurn = true;
  private statuses = new Map<PieceId, PieceStatusKind>();
  private carrying = new Map<PieceId, Side>();
  // Phase 6: shaping (build/dig, raise/sink) and the castle draft.
  private shapeDir: 'up' | 'down' = 'up';
  private shapes: ShapeOption[] = [];
  private draftAsked = -1;

  constructor(private d: ArenaMatchDeps) {
    this.listen();
  }

  private get arena() { return this.d.arena; }
  private get state(): ArenaState { return this.d.arena.state; }

  start(options: GameOptions): void {
    this.firstTurn = true;
    this.arena.newGame(options); // `started` sets this.options
  }

  /** Leaving the party modes (a chess game starts): put the island back the way chess expects it. */
  stop(): void {
    this.options = null;
    this.clearSelection();
    this.arena.pause();
    const { world, ui } = this.d;
    world.setSunk([], []);
    world.setTreasures([]);
    world.setIslandMode?.(false);
    world.setLevels?.({}, { instant: true });
    world.setFlag?.(null);
    world.setFresh?.([]);
    ui.setShapeMode?.(null);
    this.shapes = [];
    this.d.show.levels = {};
    this.d.show.sunk.clear();
    ui.setArenaState(null);
    for (const a of this.d.board.all()) a.setCarrying(null);
    this.carrying.clear();
    this.statuses.clear();
  }

  // ---------- who plays ----------

  get vsBot(): Side | null {
    const o = this.options?.opponent;
    return o?.type === 'bot' ? o.botSide : null;
  }

  private canPlay(): boolean {
    const s = this.state;
    return this.d.isActive() && s.phase === 'action' && s.turn !== this.vsBot && !this.d.director.busy && !this.asking;
  }

  private pieceAt(sq: Square): PieceState | undefined {
    return this.state.pieces.find((p) => p.square === sq);
  }

  /** Director idle: animals stand exactly where core says; fresh ones get their status and treasure back. */
  syncBoard(): void {
    const { board } = this.d;
    const before = new Set(board.all());
    board.sync(this.state.pieces, true);
    const status = new Map(this.state.statuses.map((x) => [x.pieceId, x.status]));
    const carried = this.carriedBy(this.state);
    for (const a of board.all()) {
      if (before.has(a)) continue;
      a.setStatus(status.get(a.id) ?? null);
      a.setCarrying(carried.get(a.id) ?? null);
    }
    // Board games: once everything has played, show what the side to move can build/dig or raise/sink.
    this.refreshShape();
  }

  // ---------- core -> everyone ----------

  private listen(): void {
    const a = this.arena;
    const { ui, world, show } = this.d;
    const push = (fn: () => unknown) => this.d.director.push(fn);

    a.on('started', ({ options, state }) => {
      this.options = options;
      this.d.director.cancel();
      this.clearSelection();
      this.duel = null;
      this.statuses.clear();
      this.carrying.clear();
      for (const x of this.d.board.all()) {
        x.setStatus(null);
        x.setCarrying(null);
      }
      ui.setModeState(null);
      ui.setArenaState(state);
      world.setSquareEffects([]);
      world.setSunk(state.sunk, state.sinkingNext);
      world.setIslandMode?.(state.mode === 'sumo');
      show.treasures = state.treasures;
      world.setTreasures(state.treasures);
      show.levels = { ...(state.levels ?? {}) };
      show.sunk = new Set(state.sunk);
      world.setLevels?.(show.levels, { instant: true });
      world.setFlag?.(null);
      world.setFresh?.(state.fresh ?? []);
      ui.setShapeMode?.(null);
      this.shapes = [];
      this.shapeDir = 'up';
      this.draftAsked = -1;
      push(() => this.d.playStart(state.pieces));
    });
    a.on('state', (s) => push(() => this.applyState(s)));
    a.on('rolled', ({ side, value, ap }) => push(() => ui.rollDie(side, value, 'none', { ap })));
    a.on('acted', (e) => {
      this.shapes = [];
      this.clearSelection();
      world.setHighlights({ lastMove: null, check: null });
      push(() => this.playActed(e));
    });
    a.on('sank', (e) => {
      this.clearSelection();
      push(() => this.playSank(e));
    });
    a.on('wheelSpun', (w) => {
      this.clearSelection();
      push(() => show.wheel(w));
    });
    a.on('tide', (e) => {
      this.clearSelection();
      push(() => this.playTide(e));
    });
    a.on('crowned', ({ crowned }) => push(() => this.playCrowned(crowned)));
    a.on('logged', (r) => push(() => ui.addLog(r)));
    a.on('duelOffered', (info) => {
      this.clearSelection();
      this.duel = info;
      push(() => this.offerDuel(info));
    });
    a.on('duelRound', (r) => push(() => ui.showDuelRound(r)));
    a.on('duelEnded', () => push(() => (this.duel = null)));
    a.on('bonked', ({ info }) => push(() => show.bonk(info)));
    a.on('turnChanged', ({ turn }) => {
      const first = this.firstTurn;
      this.firstTurn = false;
      push(async () => {
        ui.setTurn(turn);
        // Local games: swing the camera round to whoever plays next.
        if (!this.vsBot && !first && this.state.phase !== 'over') await world.faceSide(turn);
      });
    });
    a.on('gameOver', (over) => {
      this.clearSelection();
      push(() => this.d.playGameOver(over, this.state.pieces));
    });
    a.on('botThinking', ({ thinking }) => ui.setBotThinking(thinking));
  }

  private carriedBy(s: ArenaState): Map<PieceId, Side> {
    return new Map(s.treasures.flatMap((t) => (t.carrier ? [[t.carrier, t.owner] as const] : [])));
  }

  /** HUD, blocks, sunk squares, statuses and treasures from a snapshot; then a throw round if one is starting. */
  private async applyState(s: ArenaState): Promise<void> {
    const { ui, world, board, show } = this.d;
    ui.setArenaState(s);
    (ui as Partial<{ setPieces(p: PieceState[]): void }>).setPieces?.(s.pieces);
    world.setSquareEffects(s.squares);
    world.setSunk(s.sunk, s.sinkingNext);
    const status = new Map(s.statuses.map((x) => [x.pieceId, x.status]));
    const carried = this.carriedBy(s);
    for (const a of board.all()) {
      const next = status.get(a.id) ?? null;
      if ((this.statuses.get(a.id) ?? null) !== next) {
        a.setStatus(next);
        if (next) this.statuses.set(a.id, next);
        else this.statuses.delete(a.id);
      }
      const holds = carried.get(a.id) ?? null;
      if ((this.carrying.get(a.id) ?? null) !== holds) {
        a.setCarrying(holds);
        if (holds) this.carrying.set(a.id, holds);
        else this.carrying.delete(a.id);
      }
    }
    show.treasures = s.treasures;
    world.setTreasures(s.treasures);
    if (isBoardMode(s.mode)) {
      show.levels = { ...(s.levels ?? {}) };
      show.sunk = new Set(s.sunk);
      world.setLevels?.(show.levels);
      world.setFresh?.(s.fresh ?? []);
    }
    if (s.phase === 'duel' && this.duel) await this.askThrows(this.duel);
    if (s.phase === 'draft') await this.askDraft(s);
  }

  // ---------- game moments ----------

  private async playActed(e: ArenaEventMap['acted']): Promise<void> {
    const { show, board, audio } = this.d;
    const act = e.action;
    // Keep the carry map in step with what the animations do (the next snapshot confirms it).
    const done = () => {
      this.carrying = this.carriedBy({ ...this.state, treasures: show.treasures });
    };
    if (act.type === 'shape') {
      await this.playShape(e.side, act);
      await show.changes(e.changes);
      return done();
    }
    if (act.type === 'power' && e.power) {
      await show.power({ side: e.side, pieceId: act.pieceId, power: e.power, targets: act.targets, changes: e.changes, check: false });
      return done();
    }
    if (act.type === 'hit') {
      const attacker = board.get(act.pieceId);
      const victimId = e.changes.flatMap((c) =>
        (c.type === 'move' && c.from === act.target) || (c.type === 'fall' && c.square === act.target) ? [c.pieceId] : [],
      )[0];
      const victim = victimId ? board.get(victimId) : undefined;
      if (attacker && victim) {
        const home = board.pointOf(attacker);
        audio.play(this.state.mode === 'raid' ? 'tag' : 'shove');
        await attacker.attack(victim);
        await Promise.all([attacker.moveTo(home()), show.changes(e.changes)]);
        return done();
      }
    }
    await show.changes(e.changes);
    done();
  }

  private async playSank(e: ArenaEventMap['sank']): Promise<void> {
    const { world, ui, audio, show } = this.d;
    audio.play('sink');
    world.setSunk(e.sunk, e.sinkingNext);
    const banner = ui.announce('The island sinks!', 'bad');
    await wait(this.d.reducedMotion() ? 200 : 700);
    await show.changes(e.changes);
    await banner;
  }

  // ---------- Phase 6: board games ----------

  /** The animal's build/dig (castle) or raise/sink (stones) gesture; the square itself changes in `show.changes`. */
  private async playShape(side: Side, act: Extract<ArenaAction, { type: 'shape' }>): Promise<void> {
    const { board } = this.d;
    const stones = this.state.mode === 'stones';
    // Stones has no shaping animal: the nearest animal of that side does it.
    const id = act.pieceId ?? this.nearest(side, act.square);
    const worker = id ? board.get(id) : undefined;
    if (!worker?.work) return;
    const target = board.point(act.square);
    worker.lookAt(target);
    await worker.work(act.dir === 'up' ? 'build' : 'dig', target, stones ? { water: true } : undefined);
  }

  private nearest(side: Side, sq: Square): PieceId | undefined {
    const at = (x: Square) => [x.charCodeAt(0), Number(x[1])] as const;
    const [tf, tr] = at(sq);
    let best: PieceId | undefined;
    let bestD = Infinity;
    for (const p of this.state.pieces) {
      if (p.side !== side) continue;
      const [pf, pr] = at(p.square);
      const dist = Math.max(Math.abs(pf - tf), Math.abs(pr - tr));
      if (dist < bestD) [best, bestD] = [p.id, dist];
    }
    return best;
  }

  private async playTide(e: ArenaEventMap['tide']): Promise<void> {
    const { world, ui, show, audio } = this.d;
    const squares: Square[] = [];
    for (const c of e.changes) {
      if (c.type !== 'level') continue;
      if (c.to) show.levels[c.square] = c.to;
      else delete show.levels[c.square];
      squares.push(c.square);
    }
    if (!squares.length) return;
    audio.play('tideWear');
    world.setLevels?.({ ...show.levels }, { tide: true });
    await Promise.all([ui.announce('The tide wears the beach down', 'info'), show.ride(squares)]);
  }

  private async playCrowned(crowned: ArenaState['crowned']): Promise<void> {
    const { world, ui, audio, board } = this.d;
    world.setFlag?.(crowned ? { square: crowned.square, side: crowned.side } : null);
    if (!crowned) return;
    audio.play('flag');
    void board.get(crowned.pieceId)?.celebrate();
    const bot = this.vsBot;
    const tone = bot ? (crowned.side === bot ? 'bad' : 'good') : 'info';
    await ui.announce(`${NAME[crowned.side]} holds a castle!`, tone);
  }

  /** Castle draft: ask the human side to pick (the bot picks by itself when core resumes). */
  private async askDraft(s: ArenaState): Promise<void> {
    const draft = s.draft;
    if (!draft || !this.d.ui.askDraft || s.turn === this.vsBot || !this.d.isActive()) return;
    const n = draft.picks.land.length + draft.picks.sea.length;
    if (this.draftAsked === n || this.asking) return;
    this.draftAsked = n;
    this.asking = true;
    try {
      const kind = await this.d.ui.askDraft(s.turn, { picks: draft.picks, size: draft.size, traits: TRAITS, hotSeat: !this.vsBot });
      const r = this.arena.act({ type: 'pick', kind });
      if (!r.ok) {
        this.draftAsked = -1;
        this.d.ui.showError(r.reason);
      }
    } finally {
      this.asking = false;
    }
  }

  /** While the side to move shapes: highlight what it can raise/build or sink/dig, and show the toggle. */
  private refreshShape(): void {
    const s = this.state;
    const shaping = isBoardMode(s.mode) && (s.stage === 'shape' || s.stage === 'more') && this.canPlay();
    this.shapes = shaping ? this.arena.shapeOptions?.() ?? [] : [];
    if (!this.shapes.length) {
      this.d.ui.setShapeMode?.(null);
      if (isBoardMode(s.mode) && !this.selected && !this.aim) this.d.world.setHighlights({ targets: [] });
      return;
    }
    const canUp = this.shapes.some((o) => o.up);
    const canDown = this.shapes.some((o) => o.down);
    if (this.shapeDir === 'up' && !canUp) this.shapeDir = 'down';
    if (this.shapeDir === 'down' && !canDown) this.shapeDir = 'up';
    const upBy = Math.max(1, ...this.shapes.map((o) => o.upBy ?? 1));
    this.d.ui.setShapeMode?.({ dir: this.shapeDir, canUp, canDown, mode: s.mode as 'castle' | 'stones', upBy });
    if (!this.selected && !this.aim) {
      const mover = s.mode === 'castle' && s.mover ? this.pieceSquare(s.mover) ?? null : null;
      this.d.world.setHighlights({ selected: mover, targets: this.shapeTargets() });
    }
  }

  private pieceSquare(id: PieceId): Square | undefined {
    return this.state.pieces.find((p) => p.id === id)?.square;
  }

  private shapeTargets(): Square[] {
    return this.shapes.filter((o) => (this.shapeDir === 'up' ? o.up : o.down)).map((o) => o.square);
  }

  /** The Build/Dig (Raise/Sink) toggle. */
  setShapeDir(dir: 'up' | 'down'): void {
    this.shapeDir = dir;
    this.refreshShape();
  }

  private shapeAt(sq: Square): boolean {
    const o = this.shapes.find((x) => x.square === sq);
    if (!o) return false;
    // Use the toggle's direction; a square that only allows the other one still works.
    const dir = (this.shapeDir === 'up' ? o.up : o.down) ? this.shapeDir : o.up ? 'up' : 'down';
    const s = this.state;
    this.submit({ type: 'shape', pieceId: s.mode === 'castle' ? s.mover ?? null : null, square: sq, dir });
    return true;
  }

  private async offerDuel(info: DuelInfo): Promise<void> {
    this.d.show.faceOff(info);
    if (info.defender === this.vsBot) return; // the bot answers by itself once core resumes
    this.asking = true;
    try {
      this.arena.answerDuel(await this.d.ui.askDuel(info));
    } finally {
      this.asking = false;
    }
  }

  private async askThrows(info: DuelInfo): Promise<void> {
    const bot = this.vsBot;
    if (bot === info.defender) this.d.audio.play('duelCall');
    for (const side of [info.attacker, info.defender]) {
      if (side === bot) continue;
      this.arena.throwHand(side, await this.d.ui.askThrow(side, { hotSeat: !bot }));
    }
  }

  // ---------- input (forwarded by Match) ----------

  /** A tall animal can stand in front of a square: prefer the board square when it is a target. */
  prefer(square: Square, boardSquare?: Square | null): Square {
    if (boardSquare && boardSquare !== square && this.targets.includes(boardSquare) && !this.targets.includes(square)) return boardSquare;
    return square;
  }

  onSquare(sq: Square): void {
    if (!this.d.isActive()) return;
    if (this.d.director.busy) {
      this.d.board.finishPops();
      this.d.cast.skipAll();
      return;
    }
    if (!this.canPlay()) return;
    if (this.aim) return this.onAimSquare(sq);
    // Build/dig or raise/sink, unless the selected animal can step or push there.
    if (!(this.opts && (this.opts.steps.includes(sq) || this.opts.hits.includes(sq))) && this.shapeAt(sq)) return;
    const turn = this.state.turn;
    const piece = this.pieceAt(sq);
    const sel = this.selected;
    if (sel && this.opts) {
      if (this.opts.steps.includes(sq)) return this.submit({ type: 'step', pieceId: sel.id, to: sq });
      if (this.opts.hits.includes(sq)) return this.submit({ type: 'hit', pieceId: sel.id, target: sq });
      if (this.opts.throws?.includes(sq)) return this.submit({ type: 'throw', pieceId: sel.id, to: sq });
      if (piece?.id === sel.id) {
        this.d.audio.play('deselect');
        return this.clearSelection();
      }
      if (piece?.side === turn) return this.select(piece);
      this.d.audio.play('illegal');
      return this.clearSelection();
    }
    if (piece?.side === turn) this.select(piece);
    else if (piece) this.d.audio.play('illegal');
  }

  onHover(sq: Square | null): void {
    const { board, world } = this.d;
    const p = sq && this.canPlay() ? this.pieceAt(sq) : undefined;
    const id = p && p.side === this.state.turn ? p.id : null;
    if (id !== this.hovered) {
      if (this.hovered) board.get(this.hovered)?.setHovered(false);
      if (id) board.get(id)?.setHovered(true);
      this.hovered = id;
    }
    const target = sq && (this.targets.includes(sq) || this.shapes.some((o) => o.square === sq));
    world.renderer.domElement.style.cursor = id || target ? 'pointer' : '';
    // Hovering a shove or tag shows the line it moves and who would fall in.
    const hit = sq && this.selected && !this.aim && this.opts?.hits.includes(sq) ? sq : null;
    if (hit === this.previewing) return;
    this.previewing = hit;
    if (!hit || !this.selected) return world.setHighlights({ area: [] });
    const { area, falls } = this.arena.previewArea({ pieceId: this.selected.id, hit });
    world.setHighlights({ area: [...area, ...falls] });
  }

  private select(p: PieceState): void {
    this.clearSelection(false);
    const o = this.arena.pieceOptions(p.id);
    this.selected = p;
    this.opts = o;
    // Raid carrier: teammates it can throw to show as aim targets.
    this.targets = [...o.steps, ...o.hits, ...(o.throws ?? [])];
    this.d.world.setHighlights({ selected: p.square, legal: o.steps, captures: o.hits, targets: o.throws ?? [], area: [] });
    this.d.board.get(p.id)?.setSelected(true);
    this.d.ui.setSelection({ pieceId: p.id, side: p.side, kind: p.kind, power: o.power });
    this.d.audio.play('select');
    this.d.audio.play(`voice:${p.side}:${p.kind}`);
  }

  clearSelection(highlights = true): void {
    if (this.selected) this.d.board.get(this.selected.id)?.setSelected(false);
    this.selected = null;
    this.opts = null;
    this.targets = [];
    this.previewing = null;
    if (this.aim) {
      this.aim = null;
      this.d.ui.setPrompt(null);
    }
    this.d.ui.setSelection(null);
    if (highlights) this.d.world.setHighlights({ selected: null, legal: [], captures: [], targets: [], area: [] });
    if (highlights && this.shapes.length) this.d.world.setHighlights({ targets: this.shapeTargets() });
  }

  private submit(action: ArenaAction): void {
    this.shapes = [];
    this.clearSelection();
    const r = this.arena.act(action);
    if (!r.ok) {
      this.d.audio.play('illegal');
      this.d.ui.showError(r.reason);
    }
  }

  /** The HUD's power button for the selected animal. */
  requestPower(pieceId: PieceId): void {
    const p = this.state.pieces.find((x) => x.id === pieceId);
    if (!p || !this.canPlay() || !this.arena.pieceOptions(pieceId).power.available) {
      this.d.audio.play('illegal');
      return;
    }
    this.clearSelection(false);
    this.selected = p;
    this.d.world.setHighlights({ selected: p.square, legal: [], captures: [] });
    this.d.board.get(p.id)?.setSelected(true);
    this.aim = { pieceId, targets: [] };
    this.refreshAim();
  }

  private refreshAim(): void {
    const aim = this.aim;
    if (!aim) return;
    const step = this.arena.targets(aim);
    if (step.complete && !step.squares.length) return this.submit({ type: 'power', pieceId: aim.pieceId, targets: aim.targets });
    if (!step.squares.length) {
      this.d.audio.play('illegal');
      this.d.ui.showError(step.prompt);
      return this.clearSelection();
    }
    this.targets = step.squares;
    this.d.world.setHighlights({ legal: [], captures: [], targets: step.squares, area: this.arena.previewArea(aim).area });
    this.d.ui.setPrompt(step.prompt);
  }

  private onAimSquare(sq: Square): void {
    const aim = this.aim!;
    if (!this.targets.includes(sq)) {
      this.d.audio.play('deselect');
      return this.clearSelection();
    }
    this.d.audio.play('select');
    this.aim = { ...aim, targets: [...aim.targets, sq] };
    this.refreshAim();
  }

  endTurn(): void {
    if (!this.canPlay()) {
      this.d.audio.play('illegal');
      return;
    }
    this.clearSelection();
    this.d.audio.play('endTurn');
    const r = this.arena.act({ type: 'endTurn' });
    if (!r.ok) this.d.ui.showError(r.reason);
  }

  resign(): void {
    this.arena.resign(this.vsBot ? other(this.vsBot) : this.state.turn);
  }

  /** Party modes have no emote channel in core: show it here. */
  emote(side: Side, emote: Parameters<PieceActor['emote']>[0]): void {
    this.d.ui.showEmote(side, emote);
    const king = this.state.pieces.find((p) => p.side === side && p.kind === 'k');
    if (king) this.d.board.get(king.id)?.emote(emote);
  }
}
