/**
 * One controller whose target can change: the local game or the online proxy. Match keeps a single reference and
 * its listeners; only the active target's events get through.
 */
import { Emitter } from '../contracts/emitter';
import type { EventSource } from '../contracts/types';

type Pausable = { pause(): void };
export type Switchable<T> = T & { use(target: T): void; readonly current: T };

export function switchable<T extends EventSource<object> & Pausable>(targets: T[]): Switchable<T> {
  let current = targets[0];
  const events = new Emitter<Record<string, unknown>>();
  const hooked = new Set<string>();
  // Subscribe to an event on every target the first time someone listens to it.
  const hook = (name: string) => {
    if (hooked.has(name)) return;
    hooked.add(name);
    for (const t of targets) {
      (t as unknown as EventSource<Record<string, unknown>>).on(name, (p) => {
        if (t === current) events.emit(name, p);
      });
    }
  };
  return new Proxy({} as Switchable<T>, {
    get(_, prop) {
      if (prop === 'on') return (name: string, fn: (p: unknown) => void) => (hook(name), events.on(name, fn));
      if (prop === 'use') {
        return (t: T) => {
          if (t === current) return;
          current.pause(); // the one we leave stays frozen (no clocks, no bot)
          current = t;
        };
      }
      if (prop === 'current') return current;
      const v = Reflect.get(current as object, prop, current);
      return typeof v === 'function' ? v.bind(current) : v;
    },
  });
}
