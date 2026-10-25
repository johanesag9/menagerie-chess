import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

export interface StageOptions {
  cameraPos: [number, number, number];
  target: [number, number, number];
  fov?: number;
  exposure?: number;
  envIntensity?: number;
  bloom?: { strength: number; radius: number; threshold: number };
  tiltShift?: number; // blur amount, 0 = off
  vignette?: number;
  autoRotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
}

export type FrameFn = (dt: number, t: number) => void;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  isPhone: boolean;
  onFrame(fn: FrameFn): void;
  shake(intensity: number): void;
  start(): void;
}

export function createStage(opts: StageOptions): Stage {
  const container = document.getElementById('app')!;
  const isPhone = Math.min(window.innerWidth, window.innerHeight) < 600 || matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isPhone ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = opts.envIntensity ?? 0.35;

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 38, window.innerWidth / window.innerHeight, 0.1, 400);
  const target = new THREE.Vector3(...opts.target);
  const basePos = new THREE.Vector3(...opts.cameraPos);
  const fitCamera = () => {
    // Portrait screens: pull back so the whole board stays in view.
    const aspect = window.innerWidth / window.innerHeight;
    const k = aspect < 1 ? 1 + (1 - aspect) * 2.0 : 1;
    camera.position.copy(target).add(basePos.clone().sub(target).multiplyScalar(k));
  };
  fitCamera();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = opts.minDistance ?? 7;
  controls.maxDistance = (opts.maxDistance ?? 30) * (window.innerWidth < window.innerHeight ? 1.8 : 1);
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.autoRotate = true;
  controls.autoRotateSpeed = opts.autoRotateSpeed ?? 0.35;
  let idleTimer = 0;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    clearTimeout(idleTimer);
  });
  controls.addEventListener('end', () => {
    idleTimer = window.setTimeout(() => (controls.autoRotate = true), 6000);
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (opts.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), opts.bloom.strength, opts.bloom.radius, opts.bloom.threshold);
    composer.addPass(bloom);
  }
  let hTilt: ShaderPass | null = null;
  let vTilt: ShaderPass | null = null;
  if (opts.tiltShift) {
    hTilt = new ShaderPass(HorizontalTiltShiftShader);
    vTilt = new ShaderPass(VerticalTiltShiftShader);
    for (const p of [hTilt, vTilt]) {
      p.uniforms.r.value = 0.52;
      composer.addPass(p);
    }
  }
  composer.addPass(new OutputPass());
  if (opts.vignette) {
    const v = new ShaderPass(VignetteShader);
    v.uniforms.offset.value = 1.0;
    v.uniforms.darkness.value = opts.vignette;
    composer.addPass(v);
  }

  const setTilt = () => {
    if (!hTilt || !vTilt) return;
    const w = window.innerWidth * renderer.getPixelRatio();
    const h = window.innerHeight * renderer.getPixelRatio();
    hTilt.uniforms.h.value = opts.tiltShift! / w;
    vTilt.uniforms.v.value = opts.tiltShift! / h;
  };
  setTilt();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom?.resolution.set(window.innerWidth, window.innerHeight);
    setTilt();
  });

  const frameFns: FrameFn[] = [];
  let shakeAmt = 0;
  const shakeOffset = new THREE.Vector3();
  const timer = new THREE.Timer();

  return {
    renderer, scene, camera, controls, isPhone,
    onFrame: (fn) => frameFns.push(fn),
    shake: (i) => (shakeAmt = Math.max(shakeAmt, i)),
    start() {
      renderer.setAnimationLoop((now) => {
        timer.update(now);
        const dt = Math.min(timer.getDelta(), 1 / 20);
        const t = timer.getElapsed();
        for (const fn of frameFns) fn(dt, t);
        camera.position.sub(shakeOffset);
        controls.update(dt);
        shakeAmt *= Math.pow(0.02, dt);
        shakeOffset.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
        camera.position.add(shakeOffset);
        composer.render(dt);
      });
    },
  };
}

/** Big inverted sphere with a 3-stop vertical gradient. */
export function gradientSky(top: string, mid: string, bottom: string, radius = 180, midPoint = 0.12): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      mid: { value: new THREE.Color(mid) },
      bottom: { value: new THREE.Color(bottom) },
      midPoint: { value: midPoint },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform float midPoint;
      varying vec3 vPos;
      void main() {
        float h = vPos.y;
        vec3 c = h > midPoint ? mix(mid, top, smoothstep(midPoint, 0.75, h)) : mix(bottom, mid, smoothstep(-0.35, midPoint, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

export function sun(color: string, intensity: number, pos: [number, number, number], shadowSize = 12, mapSize = 2048): THREE.DirectionalLight {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos);
  l.castShadow = true;
  l.shadow.mapSize.set(mapSize, mapSize);
  const c = l.shadow.camera;
  c.left = -shadowSize; c.right = shadowSize; c.top = shadowSize; c.bottom = -shadowSize;
  c.near = 1; c.far = 80;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = 4;
  return l;
}
