/**
 * Phase 5: online play with a friend by invite link. See GAME_SPEC.md "Online play" and src/contracts/net.ts.
 */
import type { CreateOnline } from '../contracts/factories';
import { createArena, createGame } from '../core/index';
import { OnlineClientImpl, type ClientDeps } from './client';
import { httpTransport } from './transport';

/** The room server: `VITE_ONLINE_URL` when set, else wrangler dev on this machine's host (port 8787). */
export function defaultBase(): string {
  const env = import.meta.env?.VITE_ONLINE_URL as string | undefined;
  if (env) return env;
  const host = typeof location === 'undefined' ? 'localhost' : location.hostname || 'localhost';
  return `http://${host}:8787`;
}

export const createOnline: CreateOnline = (opts) =>
  new OnlineClientImpl({ transport: httpTransport(opts?.base ?? defaultBase()), createGame, createArena });

/** For the demo and tests: any transport (the fake server's, or a wrapped real one) and storage. */
export function createOnlineWith(deps: Partial<ClientDeps> & Pick<ClientDeps, 'transport'>): OnlineClientImpl {
  return new OnlineClientImpl({ createGame, createArena, ...deps });
}

export { FakeServer } from './fakeServer';
export { ControlledTransport, httpTransport } from './transport';
