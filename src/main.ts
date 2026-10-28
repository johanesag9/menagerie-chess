// Integration (orchestrator-owned): boots every stream and hands them to the Match.
import './app/app.css';
import { createAudio } from './audio';
import { createCast } from './cast';
import { createGame } from './core';
import { createUi } from './ui';
import { createWorld } from './world';
import { Match } from './app/match';
import type { GameOptions } from './contracts/types';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const stage = document.createElement('div');
  stage.className = 'mc-world';
  app.append(stage);

  // The UI comes up first, so the title shows while the world compiles its shaders.
  const audio = createAudio();
  const ui = createUi(app, audio);

  // A game can be started before the world is ready; hold it until then.
  let match: Match | null = null;
  let pending: GameOptions | null = null;
  ui.on('startGame', (o) => (match ? match.start(o) : (pending = o)));

  const q = ui.settings.quality;
  const world = await createWorld({ container: stage, quality: q === 'auto' ? undefined : q, autoIntro: false });
  const autoQuality = world.quality;
  const cast = createCast({ squareSize: world.squareSize, quality: world.quality });
  await cast.preload(world.renderer, world.scene, world.camera);

  match = new Match({ game: createGame(), world, cast, ui, audio, autoQuality });
  if (pending) match.start(pending);

  if (import.meta.env.DEV) Object.assign(window, { __mc: { match, world, cast, ui } });
  if (new URLSearchParams(location.search).has('stats')) showStats(world);
}

/** `?stats` in the URL: a small FPS / draw-call readout for performance checks. */
function showStats(world: { stats?: { fps: number; drawCalls: number; quality: string; pixelRatio: number } }): void {
  const el = document.createElement('div');
  el.className = 'mc-stats';
  document.body.append(el);
  setInterval(() => {
    const s = world.stats;
    if (s) el.textContent = `${s.fps} fps · ${s.drawCalls} calls · ${s.quality} · ${s.pixelRatio.toFixed(2)}x`;
  }, 500);
}

void boot();
