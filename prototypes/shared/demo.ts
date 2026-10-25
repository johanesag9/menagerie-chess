/** Plays a short scripted game on loop so each world prototype shows how moves and captures feel. */
import * as THREE from 'three';
import gsap from 'gsap';
import { Chess, type Move } from 'chess.js';
import { createAnimal, type Animal, type Kind, type Side } from './animals';
import type { Board } from './board';
import type { Stage } from './stage';

const SCRIPT = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Nxe5', 'Nxe5', 'd4', 'Nxc4', 'Qe2', 'd5', 'Qxc4', 'dxc4', 'O-O', 'Be6', 'Rd1', 'Qd5'];

const FACE: Record<Side, number> = { land: Math.PI, sea: 0 };

export interface DemoOptions {
  board: Board;
  stage: Stage;
  /** Seconds between moves. */
  gap?: number;
  onMove?: (side: Side, kind: Kind) => void;
}

export function runDemo({ board, stage, gap = 0.9, onMove }: DemoOptions) {
  let pieces = new Map<string, Animal>();
  const all = new Set<Animal>();
  const layer = board.pieceLayer;

  stage.onFrame((_dt, t) => all.forEach((a) => a.idle(t)));

  const place = (a: Animal, sq: string) => {
    a.root.position.copy(board.squareToLocal(sq));
    a.root.rotation.y = FACE[a.side];
  };

  async function setup() {
    const chess = new Chess();
    const tl = gsap.timeline();
    chess.board().flat().forEach((cell, i) => {
      if (!cell) return;
      const a = createAnimal(cell.color === 'w' ? 'land' : 'sea', cell.type as Kind);
      place(a, cell.square);
      a.root.scale.setScalar(0.001);
      layer.add(a.root);
      all.add(a);
      pieces.set(cell.square, a);
      const d = cell.color === 'w' ? 7 - Math.floor(i / 8) : Math.floor(i / 8);
      tl.to(a.root.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'elastic.out(1, 0.55)' }, 0.15 + d * 0.12 + (i % 8) * 0.035);
    });
    await tl;
  }

  async function teardown() {
    const tl = gsap.timeline();
    let i = 0;
    for (const a of all) {
      tl.to(a.root.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, ease: 'back.in(2)' }, i++ * 0.025);
    }
    await tl;
    for (const a of all) disposeAnimal(a);
    all.clear();
    pieces = new Map();
  }

  function disposeAnimal(a: Animal) {
    a.root.removeFromParent();
  }

  function turnTo(a: Animal, yaw: number, duration = 0.22) {
    const cur = a.root.rotation.y;
    let d = ((yaw - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return gsap.to(a.root.rotation, { y: cur + d, duration, ease: 'power2.out' });
  }

  function squash(a: Animal, amt = 0.22) {
    gsap.fromTo(a.root.scale, { x: 1 + amt * 0.6, y: 1 - amt, z: 1 + amt * 0.6 }, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', overwrite: true });
  }

  interface Travel { hops: number; height: number; duration: number; squashAmt: number; pitch?: number; wobble?: number; shake?: number; float?: boolean }

  function style(a: Animal, dist: number): Travel {
    const n = Math.max(1, Math.round(dist));
    if (a.side === 'land') {
      switch (a.kind) {
        case 'p': return { hops: n * 2, height: 0.2, duration: 0.32 * n + 0.2, squashAmt: 0.18 };
        case 'n': return { hops: 1, height: 1.3, duration: 0.85, squashAmt: 0.3, pitch: -0.45 };
        case 'b': return { hops: n, height: 0.45, duration: 0.3 * n + 0.15, squashAmt: 0.2 };
        case 'r': return { hops: n * 2, height: 0.07, duration: 0.3 * n + 0.2, squashAmt: 0.08, shake: 0.06 };
        default: return { hops: n * 2, height: 0.1, duration: 0.3 * n + 0.2, squashAmt: 0.12, wobble: 0.14 };
      }
    }
    switch (a.kind) {
      case 'p': return { hops: n * 5, height: 0.04, duration: 0.25 * n + 0.25, squashAmt: 0.08 };
      case 'n': return { hops: 1, height: 1.0, duration: 1.0, squashAmt: 0, float: true };
      case 'b': return { hops: 1, height: 0.5, duration: 0.3 * n + 0.35, squashAmt: 0, float: true };
      case 'r': return { hops: 1, height: 0.0, duration: 0.3 * n + 0.3, squashAmt: 0.06 };
      case 'q': return { hops: n * 2, height: 0.15, duration: 0.3 * n + 0.2, squashAmt: 0.15, wobble: 0.1 };
      default: return { hops: n * 3, height: 0.06, duration: 0.3 * n + 0.3, squashAmt: 0.2, wobble: 0.18 };
    }
  }

  async function travel(a: Animal, toSq: string, onImpact?: () => void) {
    const from = a.root.position.clone();
    const to = board.squareToLocal(toSq);
    const dir = to.clone().sub(from);
    const dist = Math.hypot(dir.x, dir.z);
    const s = style(a, dist);
    // Crabs face sideways while they walk forward.
    const yaw = Math.atan2(dir.x, dir.z) + (a.side === 'sea' && a.kind === 'p' ? Math.PI / 2 : 0);
    await turnTo(a, yaw);
    let lastHop = 0;
    let impacted = false;
    const p = { t: 0 };
    await gsap.to(p, {
      t: 1,
      duration: s.duration,
      ease: s.float ? 'sine.inOut' : 'power1.inOut',
      onUpdate: () => {
        const t = p.t;
        const h = Math.min(s.hops - 1e-6, t * s.hops);
        const hopIdx = Math.floor(h);
        const local = h - hopIdx;
        a.root.position.lerpVectors(from, to, t);
        a.root.position.y = from.y + Math.sin(local * Math.PI) * s.height;
        if (s.pitch) a.root.rotation.x = Math.sin(t * Math.PI) * s.pitch;
        if (s.wobble) a.root.rotation.z = Math.sin(t * s.hops * Math.PI) * s.wobble;
        if (hopIdx !== lastHop) {
          lastHop = hopIdx;
          if (s.squashAmt) squash(a, s.squashAmt * 0.6);
          if (s.shake) stage.shake(s.shake);
        }
        if (onImpact && !impacted && t > 0.72) {
          impacted = true;
          onImpact();
        }
      },
    });
    a.root.rotation.x = 0;
    a.root.rotation.z = 0;
    a.root.position.copy(to);
    if (s.squashAmt) squash(a, s.squashAmt);
    if (s.shake) stage.shake(s.shake * 1.6);
    turnTo(a, FACE[a.side], 0.4);
  }

  function knockOut(victim: Animal, attacker: Animal) {
    const away = victim.root.position.clone().sub(attacker.root.position).setY(0).normalize();
    if (!Number.isFinite(away.x)) away.set(0, 0, 1);
    burst(victim.root.position.clone().add(new THREE.Vector3(0, victim.height * 0.6, 0)));
    stage.shake(0.14);
    const tl = gsap.timeline({ onComplete: () => { all.delete(victim); disposeAnimal(victim); } });
    tl.to(victim.root.position, { x: `+=${away.x * 4}`, z: `+=${away.z * 4}`, duration: 1.1, ease: 'power1.out' }, 0)
      .to(victim.root.position, { y: '+=2.6', duration: 0.5, ease: 'power2.out' }, 0)
      .to(victim.root.position, { y: '-=1.2', duration: 0.6, ease: 'power2.in' }, 0.5)
      .to(victim.root.rotation, { x: away.z * 9, z: -away.x * 9, duration: 1.1, ease: 'none' }, 0)
      .to(victim.root.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, ease: 'back.in(2)' }, 0.8);
  }

  const starGeo = new THREE.OctahedronGeometry(0.07, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffcc33', emissiveIntensity: 2.2, toneMapped: false });
  function burst(at: THREE.Vector3) {
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(starGeo, starMat);
      s.position.copy(at);
      layer.add(s);
      const a = (i / 10) * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.5;
      gsap.to(s.position, { x: at.x + Math.cos(a) * r, y: at.y + 0.3 + Math.random() * 0.6, z: at.z + Math.sin(a) * r, duration: 0.6, ease: 'power2.out' });
      gsap.to(s.rotation, { x: 6, y: 4, duration: 0.6 });
      gsap.to(s.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.6, ease: 'power2.in', onComplete: () => s.removeFromParent() });
    }
  }

  async function play(m: Move) {
    const a = pieces.get(m.from)!;
    pieces.delete(m.from);
    onMove?.(a.side, a.kind);
    const victimSq = m.isEnPassant() ? m.to[0] + m.from[1] : m.to;
    const victim = m.captured ? pieces.get(victimSq) : undefined;
    if (victim) pieces.delete(victimSq);
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = m.from[1];
      const [rf, rt] = m.isKingsideCastle() ? ['h' + rank, 'f' + rank] : ['a' + rank, 'd' + rank];
      const rook = pieces.get(rf)!;
      pieces.delete(rf);
      pieces.set(rt, rook);
      pieces.set(m.to, a);
      await Promise.all([travel(a, m.to), new Promise<void>((r) => setTimeout(() => travel(rook, rt).then(r), 250))]);
      return;
    }
    pieces.set(m.to, a);
    await travel(a, m.to, victim ? () => knockOut(victim, a) : undefined);
  }

  const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

  // Compile every animal's shaders up front so the first pop-in doesn't stall.
  async function warmUp() {
    const tmp = new THREE.Group();
    for (const side of ['land', 'sea'] as const) for (const k of ['p', 'n', 'b', 'r', 'q', 'k'] as const) tmp.add(createAnimal(side, k).root);
    tmp.position.y = -50;
    stage.scene.add(tmp);
    await stage.renderer.compileAsync(stage.scene, stage.camera);
    tmp.removeFromParent();
  }

  (async function loop() {
    await warmUp();
    for (;;) {
      await setup();
      await wait(1.2);
      const chess = new Chess();
      for (const san of SCRIPT) {
        const m = chess.move(san);
        await play(m);
        await wait(gap);
      }
      await wait(2.5);
      await teardown();
      await wait(0.4);
    }
  })();
}
