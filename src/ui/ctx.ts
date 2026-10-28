import type { ArenaState, AudioEngine, GameOptions, Screen, Settings, Side, UiEventMap } from '../contracts/types';
import type { SkinCatalog } from './config';
import type { KeyValueStore } from './settings';

/** What every screen can reach. Implemented by the Ui in index.ts. */
export interface UiCtx {
  readonly audio: AudioEngine;
  readonly store: KeyValueStore | null;
  readonly settings: Settings;
  /** Options of the game in progress (from setup, or setGameInfo). */
  readonly gameInfo: GameOptions | null;
  /** Phase 4: the latest party-mode snapshot (null outside Sumo and Raid). */
  readonly arenaState: ArenaState | null;
  emit<K extends keyof UiEventMap>(name: K, payload: UiEventMap[K]): void;
  show(screen: Screen): void;
  /** Leave settings/customize to wherever they were opened from. */
  back(): void;
  updateSettings(patch: Partial<Settings>): void;
  skins(side: Side): SkinCatalog;
  /** Start a new game from setup: resets the HUD and switches to it. */
  startGame(options: GameOptions): void;
}

/** A screen's view: its root element plus optional hooks. */
export interface View {
  el: HTMLElement;
  /** Called each time the screen becomes visible. */
  onShow?(): void;
  /** The element to focus when shown. */
  focusTarget?(): HTMLElement | null;
}
