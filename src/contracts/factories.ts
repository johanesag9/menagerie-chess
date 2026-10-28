/**
 * Each stream exports exactly one factory from its folder's index.ts with these signatures.
 * Integration (src/main.ts, orchestrator-owned) wires them together.
 */
import type { OnlineClient } from './net';
import type { ArenaController, AudioEngine, Cast, CastOptions, GameController, Ui, World, WorldOptions } from './types';

/** src/core/index.ts */
export type CreateGame = () => GameController;
/** src/core/index.ts (Phase 4): Sumo and Raid. */
export type CreateArena = () => ArenaController;
/** src/world/index.ts */
export type CreateWorld = (opts: WorldOptions) => Promise<World>;
/** src/cast/index.ts */
export type CreateCast = (opts: CastOptions) => Cast;
/** src/ui/index.ts */
export type CreateUi = (root: HTMLElement, audio: AudioEngine) => Ui;
/** src/audio/index.ts */
export type CreateAudio = () => AudioEngine;
/** src/net/index.ts (Phase 5): online play. `base` = the server's URL (default: VITE_ONLINE_URL, else http://localhost:8787 in dev). */
export type CreateOnline = (opts?: { base?: string }) => OnlineClient;
