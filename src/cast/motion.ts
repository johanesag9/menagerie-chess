import gsap from 'gsap';

/**
 * Impact look: 'clean' = a small white flash and sparkles, short hit-stop.
 * 'cartoon' = a big comic burst, speed lines and a longer hit-stop. Provisional default until Johanes picks.
 */
export type Look = 'clean' | 'cartoon';

/**
 * Module-wide motion settings. Reduced motion: shorter moves, no spins or flips, no camera-shake hooks
 * (stomp/impact events still fire but with intensity 0), fewer particles, no hit-stop.
 * `stopUntil` is the end of the current hit-stop (global timeline seconds).
 */
export const motion = { reduced: false, look: 'cartoon' as Look, stopUntil: 0 };

export function setReducedMotion(on: boolean): void {
  motion.reduced = on;
}

export function setLook(look: Look): void {
  motion.look = look;
}

/** How long an impact freezes the pieces involved (0 under reduced motion). */
export function hitStop(scale = 1): number {
  if (motion.reduced) return 0;
  return (motion.look === 'cartoon' ? 0.08 : 0.045) * scale;
}

/** Start a hit-stop now: the next hit, push, defeat or move holds still until it ends. */
export function freeze(dur: number): void {
  if (dur <= 0) return;
  motion.stopUntil = Math.max(motion.stopUntil, gsap.globalTimeline.time() + dur);
}

/** Seconds left in the current hit-stop. */
export function frozenLeft(): number {
  return Math.max(0, Math.min(0.2, motion.stopUntil - gsap.globalTimeline.time()));
}
