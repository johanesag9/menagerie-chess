/**
 * Reduced motion, module-wide. When on: shorter moves, no spins or flips, no camera-shake hooks
 * (stomp/impact events still fire but with intensity 0), fewer particles.
 */
export const motion = { reduced: false };

export function setReducedMotion(on: boolean): void {
  motion.reduced = on;
}
