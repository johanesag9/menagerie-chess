/**
 * createUi: every screen as DOM over the canvas. Vanilla TS, CSS transitions via the Web Animations API.
 *
 * Who plays which sound: the UI plays its own control sounds (hover/click/back), `clockLow`,
 * and the cues for what it shows (`check`, `weird`, `checkmate`/`draw` on the result, `emote:*`).
 * Board sounds (moves, captures, select, voices) belong to integration, timed with the animations.
 * The UI also picks the music for the screen: `title` on menus, `game`/`tense` in play.
 */
import './styles.css';
import type {
  ActionRecord, AudioEngine, DieEffect, DieValue, EmoteKind, Hand, ModeState, PieceId, SelectionInfo, GameOptions, GameOver, MoveResult, PieceKind, Screen, Settings, Side, Ui, UiEventMap, WeirdEvent,
} from '../contracts/types';
import type { CreateUi } from '../contracts/factories';
import { Emitter } from '../contracts/emitter';
import { FALLBACK_SKINS, type SkinCatalog } from './config';
import type { UiCtx, View } from './ctx';
import { focusables, h } from './dom';
import { Hud } from './screens/hud';
import { customizeScreen, settingsScreen } from './screens/options';
import { PromotionPicker, ResultView, pauseScreen } from './screens/overlays';
import { setupScreen } from './screens/setup';
import { titleScreen } from './screens/title';
import { defaultSettings, loadSettings, saveSettings, type KeyValueStore } from './settings';

export { GAME_NAME } from './config';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';

/** Screens drawn over the game (the HUD stays visible underneath). */
const OVERLAYS: Screen[] = ['pause', 'result'];

function safeStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The Ui implementation. Beyond the `Ui` contract it has a few extras integration can use
 * (see REPORT.md "Contract requests"): setSkinCatalog, setGameInfo, showError.
 */
export class MenagerieUi extends Emitter<UiEventMap> implements Ui, UiCtx {
  readonly store = safeStorage();
  private _settings: Settings;
  private _gameInfo: GameOptions | null = null;
  private root: HTMLElement;
  private layer: HTMLElement;
  private views: Record<Screen, View>;
  private hud: Hud;
  private result: ResultView;
  private promo: PromotionPicker;
  private errorEl: HTMLElement;
  private current: Screen | null = null;
  /** Where settings/customize return to. */
  private returnTo: Screen = 'title';
  private inGame = false;
  private catalog: Partial<Record<Side, SkinCatalog>> = {};
  private lastHover: Element | null = null;
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement, readonly audio: AudioEngine) {
    super();
    this.root = root;
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this._settings = loadSettings(this.store, defaultSettings(prefersReduced));
    audio.setVolumes(this._settings.musicVolume, this._settings.sfxVolume);

    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      document.head.append(h('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }), h('link', { rel: 'stylesheet', href: FONT_HREF }));
    }

    this.layer = h('div', { class: 'mc-ui' });
    this.hud = new Hud(this);
    this.hud.onTrack = (t) => {
      if (this.current === 'game' || this.current === 'pause') audio.setMusic(t);
    };
    this.result = new ResultView(this);
    this.promo = new PromotionPicker(this);
    this.views = {
      title: titleScreen(this),
      setup: setupScreen(this),
      game: { el: this.hud.el },
      customize: customizeScreen(this),
      settings: settingsScreen(this),
      pause: pauseScreen(this, () => this.hud.moveCount),
      result: this.result,
    };
    this.errorEl = h('div', { class: 'mc-error', role: 'alert', hidden: true });
    for (const v of Object.values(this.views)) {
      v.el.hidden = true;
      this.layer.append(v.el);
    }
    this.layer.append(this.promo.el, this.errorEl);
    this.applyMotion();
    root.append(this.layer);
    this.listen();
    this.show('title');
  }

  // ---------- UiCtx ----------

  get settings(): Settings {
    return this._settings;
  }

  get gameInfo(): GameOptions | null {
    return this._gameInfo;
  }

  updateSettings(patch: Partial<Settings>): void {
    this._settings = { ...this._settings, ...patch };
    saveSettings(this.store, this._settings);
    this.audio.setVolumes(this._settings.musicVolume, this._settings.sfxVolume);
    this.applyMotion();
    this.emit('settingsChanged', { ...this._settings });
  }

  skins(side: Side): SkinCatalog {
    return this.catalog[side] ?? FALLBACK_SKINS[side];
  }

  startGame(options: GameOptions): void {
    this.setGameInfo(options);
    this.show('game');
    this.emit('startGame', options);
  }

  back(): void {
    this.show(this.returnTo);
  }

  // ---------- Ui contract ----------

  show(screen: Screen): void {
    const from = this.current;
    if (screen === from) return;
    if (screen === 'settings' || screen === 'customize') {
      if (from !== 'settings' && from !== 'customize') this.returnTo = from === 'game' ? 'pause' : (from ?? 'title');
    }
    if (screen === 'title' || screen === 'setup') this.inGame = false;
    if (screen === 'game') this.inGame = true;
    // Rematch / new game from the result screen: start clean.
    if (screen === 'game' && from === 'result') this.hud.reset(this._gameInfo);

    this.current = screen;
    const hudVisible = this.inGame && (screen === 'game' || OVERLAYS.includes(screen) || screen === 'settings' || screen === 'customize');
    this.root.dataset.screen = screen;
    this.layer.classList.toggle('is-ingame', this.inGame);
    this.layer.classList.toggle('is-overlay', screen !== 'game' && hudVisible);

    for (const [name, v] of Object.entries(this.views) as [Screen, View][]) {
      const want = name === screen || (name === 'game' && hudVisible);
      if (want && v.el.hidden) this.enter(v, name === 'game' && screen !== 'game');
      else if (!want && !v.el.hidden) this.leave(v);
      if (name === 'game') v.el.toggleAttribute('inert', screen !== 'game');
    }
    if (screen !== 'game') this.hud.hideTransient();
    const view = this.views[screen];
    view.onShow?.();
    // Focus the screen's main control (not for the HUD: keep focus on the canvas side).
    if (screen !== 'game') requestAnimationFrame(() => (view.focusTarget?.() ?? focusables(view.el)[0])?.focus({ preventScroll: true }));
    else if (from && OVERLAYS.includes(from)) (document.activeElement as HTMLElement | null)?.blur?.();

    this.audio.setMusic(this.inGame && screen !== 'result' ? this.hud.track : 'title');
    this.emit('screenChanged', { screen });
  }

  setTurn(turn: Side): void {
    this.hud.setTurn(turn);
  }

  setClocks(landMs: number | null, seaMs: number | null, running: Side | null): void {
    this.hud.setClocks(landMs, seaMs, running);
  }

  addMove(move: MoveResult): void {
    this.hud.addMove(move);
  }

  resetMoves(): void {
    this.hud.resetMoves();
  }

  setBotThinking(thinking: boolean): void {
    this.hud.setBotThinking(thinking);
  }

  showCheck(side: Side): void {
    this.hud.showCheck(side);
  }

  showWeirdEvent(e: WeirdEvent): void {
    this.hud.showWeirdEvent(e);
  }

  askPromotion(side: Side): Promise<Exclude<PieceKind, 'p' | 'k'>> {
    return this.promo.ask(side);
  }

  showResult(result: GameOver): void {
    this.result.set(result);
    this.show('result');
  }

  showEmote(side: Side, emote: EmoteKind): void {
    this.hud.showEmote(side, emote);
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
    this.hud.dispose();
    this.promo.dispose();
    this.layer.remove();
    this.clear();
  }

  // ---------- Extras (contract requests) ----------

  /** Real skin list from the cast: `ui.setSkinCatalog('land', cast.listSkins('land'))`. */
  setSkinCatalog(side: Side, catalog: SkinCatalog): void {
    this.catalog[side] = catalog;
    if (this.current === 'customize') this.views.customize.onShow?.();
  }

  /** Tell the HUD about a game the UI's setup screen didn't start. Also resets the HUD. */
  setGameInfo(options: GameOptions): void {
    this._gameInfo = options;
    this.hud.reset(options);
  }

  /** A friendly error line, e.g. when core rejects a FEN. */
  showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
    this.errorEl.classList.remove('is-on');
    void this.errorEl.offsetWidth;
    this.errorEl.classList.add('is-on');
    this.audio.play('illegal');
    window.clearTimeout(Number(this.errorEl.dataset.t ?? 0));
    this.errorEl.dataset.t = String(window.setTimeout(() => (this.errorEl.hidden = true), 4000));
  }

  // ---------- Phase 3 stubs (orchestrator, so main typechecks). The ui session replaces these. ----------
  setModeState(_state: ModeState | null): void {}
  addLog(_record: ActionRecord): void {}
  setSelection(_sel: SelectionInfo | null): void {}
  setPrompt(_text: string | null): void {}
  rollDie(_side: Side, _value: DieValue, _effect: DieEffect): Promise<void> { return Promise.resolve(); }
  askLucky(): Promise<'recharge' | 'pawnStep' | 'skip'> { return Promise.resolve('skip'); }
  showCardDrawn(): Promise<void> { return Promise.resolve(); }
  showCardPlayed(): Promise<void> { return Promise.resolve(); }
  askRevive(): Promise<PieceId | null> { return Promise.resolve(null); }
  askDuel(): Promise<boolean> { return Promise.resolve(false); }
  askThrow(): Promise<Hand> { return Promise.resolve('rock'); }
  showDuelRound(): Promise<void> { return Promise.resolve(); }
  spinWheel(): Promise<void> { return Promise.resolve(); }

  // ---------- internals ----------

  private get motion(): 'full' | 'reduced' {
    return this._settings.reducedMotion ? 'reduced' : 'full';
  }

  private applyMotion(): void {
    this.layer.dataset.motion = this.motion;
  }

  private enter(v: View, under = false): void {
    v.el.hidden = false;
    v.el.classList.remove('is-leaving');
    v.el.getAnimations().forEach((a) => a.cancel());
    if (under) return; // the HUD just stays put under an overlay
    const card = v.el.querySelector<HTMLElement>('.mc-panel, .mc-title__inner') ?? v.el;
    if (this.motion === 'reduced') {
      v.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
      return;
    }
    v.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    if (card !== v.el) {
      card.animate(
        [{ transform: 'translateY(24px) scale(0.94)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(.2,1.35,.4,1)' },
      );
    }
    if (v === this.views.game) {
      v.el.querySelectorAll<HTMLElement>('.mc-hud__bar').forEach((bar, i) =>
        bar.animate([{ transform: `translateY(${i ? 30 : -30}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,1.25,.4,1)', delay: 80 }));
    }
  }

  private leave(v: View): void {
    v.el.classList.add('is-leaving');
    const ms = this.motion === 'reduced' ? 100 : 160;
    v.el.animate([{ opacity: 1 }, { opacity: 0, transform: this.motion === 'reduced' ? 'none' : 'translateY(8px)' }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
    // A timer, not onfinish: background tabs can stall animations, and a stuck screen would block clicks.
    window.setTimeout(() => {
      if (!v.el.classList.contains('is-leaving')) return;
      v.el.hidden = true;
      v.el.classList.remove('is-leaving');
      v.el.getAnimations().forEach((a) => a.cancel());
    }, ms + 20);
  }

  private listen(): void {
    const on = <K extends keyof DocumentEventMap>(target: Document | HTMLElement, name: K, fn: (e: DocumentEventMap[K]) => void, capture = false) => {
      target.addEventListener(name, fn as EventListener, capture);
      this.cleanup.push(() => target.removeEventListener(name, fn as EventListener, capture));
    };

    // Browsers only allow sound after a gesture: unlock on the first one.
    const unlock = () => void this.audio.unlock();
    on(document, 'pointerdown', unlock, true);
    on(document, 'keydown', unlock, true);

    // UI sounds for every control, via data-sfx.
    on(this.layer, 'pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const t = (e.target as Element).closest('button:not([disabled]), summary, input[type=range]');
      if (t && t !== this.lastHover) this.audio.play('uiHover');
      this.lastHover = t;
    });
    on(this.layer, 'click', (e) => {
      const t = (e.target as Element).closest<HTMLElement>('[data-sfx]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      const s = t.dataset.sfx;
      if (s === 'click') this.audio.play('uiClick');
      else if (s === 'back') this.audio.play('uiBack');
    });

    on(document, 'keydown', (e) => {
      if (this.promo.open) return this.trap(e, this.promo.el);
      const cur = this.current;
      if (e.key === 'Escape') {
        const to: Partial<Record<Screen, Screen>> = { game: 'pause', pause: 'game', setup: 'title', settings: this.returnTo, customize: this.returnTo };
        const next = cur ? to[cur] : undefined;
        if (next) {
          e.preventDefault();
          this.audio.play(cur === 'game' ? 'uiClick' : 'uiBack');
          this.show(next);
        }
        return;
      }
      if (cur && cur !== 'game') this.trap(e, this.views[cur].el);
    });
  }

  /** Keep Tab inside the open screen. */
  private trap(e: KeyboardEvent, el: HTMLElement): void {
    if (e.key !== 'Tab') return;
    const f = focusables(el);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!el.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export const createUi: CreateUi = (root, audio) => new MenagerieUi(root, audio);
