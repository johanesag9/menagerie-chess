/**
 * Online with a friend (Phase 5): the room flow around the Match. Creating a room and the invite, joining from a
 * `?room=` link, the online HUD (connection, presence, turn timer, rematch), and leaving.
 * The game itself runs through the online proxies, so the Match plays it like a local game.
 */
import type { GameOptions, GameOver, Side, Ui } from '../contracts/types';
import type { OnlineClient, OnlineHud } from '../contracts/net';
import { tokenKey } from '../net/client';

export interface OnlineFlowDeps {
  online: OnlineClient;
  ui: Ui;
  /** Point the Match at the online proxies for this game (called before the mirror's first events). */
  begin: (options: GameOptions) => void;
  /** Back to the local controllers. */
  end: () => void;
  /** The mirror jumped ahead silently (a rejoin): redraw everything from its state; `over` = it had already ended. */
  resync: (over: GameOver | null) => void;
  /** Party modes: show an emote (chess modes get it from the game proxy's own `emote` event). */
  emote: (side: Side, emote: Parameters<OnlineClient['sendEmote']>[0]) => void;
  isParty: () => boolean;
}

const fresh = (): OnlineHud => ({ connection: 'connecting', opponent: 'waiting', graceEndsAt: null, timer: null, rematch: 'none' });

export class OnlineFlow {
  /** True from creating or joining a room until leaving it. */
  active = false;
  private hud = fresh();
  private you: Side | null = null;

  constructor(private d: OnlineFlowDeps) {
    const { online, ui } = d;
    online.on('started', ({ options, you }) => {
      this.you = you;
      this.hud = { ...this.hud, rematch: 'none', timer: null };
      d.begin(options);
      ui.setGameInfo(options);
      ui.show('game'); // closes the invite (and plays friendJoined)
      this.push();
    });
    online.on('resync', ({ over }) => d.resync(over ?? null));
    online.on('connection', ({ state }) => this.set({ connection: state }));
    online.on('presence', ({ opponent, graceEndsAt }) => this.set({ opponent, graceEndsAt }));
    online.on('timer', ({ side, endsAt }) => this.set({ timer: side && endsAt !== null ? { side, endsAt } : null }));
    online.on('rematch', ({ side }) => this.set({ rematch: side === this.you ? 'youAsked' : 'theyAsked' }));
    online.on('emote', ({ side, emote }) => {
      if (d.isParty()) d.emote(side, emote);
    });
    online.on('auto', ({ side, why }) => {
      const mine = side === this.you;
      if (mine) ui.closeQuestion?.(); // the room answered for me; the proxies drop the stale default
      const text = why === 'left' ? 'Your friend left' : mine ? "Time's up!" : 'Friend ran out of time';
      void ui.announce(text, mine ? 'bad' : 'info');
    });
    online.on('rejected', ({ reason }) => ui.showError(reason));
    online.on('error', ({ reason }) => ui.showError(reason));

    ui.on('cancelInvite', () => this.leave());
    ui.on('rematchOnline', () => online.askRematch());
  }

  /** Setup's Start with "Friend online": make a room and show the invite. */
  async create(options: GameOptions): Promise<void> {
    const { online, ui } = this.d;
    this.leave();
    this.active = true;
    this.hud = fresh();
    try {
      const { room, link, you } = await online.createRoom(options);
      this.you = you;
      setRoomParam(room);
      ui.showInvite({ link, mode: options.mode ?? 'classic', you });
    } catch (err) {
      this.active = false;
      ui.showError(`Couldn't make a link: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** On load: a `?room=` link joins (or rejoins with the stored token). */
  async joinFromUrl(): Promise<void> {
    const room = new URLSearchParams(location.search).get('room');
    if (!room) return;
    const { online, ui } = this.d;
    const info = await online.roomInfo(room).catch(() => null);
    const rejoin = !!info && info.openSide === null && hasToken(room);
    const ok = rejoin || (await ui.askJoin(info?.openSide ? { mode: info.mode, you: info.openSide } : null));
    if (!ok) return setRoomParam(null);
    this.active = true;
    this.hud = fresh();
    try {
      const { you } = await online.join(room);
      this.you = you;
    } catch (err) {
      this.active = false;
      setRoomParam(null);
      ui.showError(`Couldn't join: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Leave for good (resigns a running game) and go back to local play. */
  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.d.online.leave();
    setRoomParam(null);
    this.d.ui.setOnline(null);
    this.d.end();
  }

  private set(patch: Partial<OnlineHud>): void {
    this.hud = { ...this.hud, ...patch };
    this.push();
  }

  private push(): void {
    if (this.active) this.d.ui.setOnline(this.hud);
  }
}

function hasToken(room: string): boolean {
  try {
    return !!localStorage.getItem(tokenKey(room));
  } catch {
    return false;
  }
}

/** Keep `?room=` in the address bar while in a room, so a reload rejoins. */
function setRoomParam(room: string | null): void {
  const url = new URL(location.href);
  if (room) url.searchParams.set('room', room);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}
