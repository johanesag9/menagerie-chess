import type { EventSource, Unsubscribe } from './types';

/** Tiny typed event emitter every stream can use to implement EventSource. */
export class Emitter<M> implements EventSource<M> {
  private handlers = new Map<keyof M, Set<(payload: never) => void>>();

  on<K extends keyof M>(name: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => set!.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    this.handlers.get(name)?.forEach((fn) => (fn as (p: M[K]) => void)(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
