/**
 * Renderer, post-processing and canvas sizing.
 * High tier: MSAA HDR target -> light bloom -> tilt-shift -> ACES output.
 * Low tier: direct render (canvas MSAA, renderer tone mapping), no post passes.
 * The vignette is a CSS overlay, so it costs no GPU time on either tier.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import type { QualityTier } from '../contracts/types';
import { PROFILES, type QualityProfile } from './quality';

/** Blur strength of the tilt-shift, in pixels at the screen edges. */
const TILT_AMOUNT = 2.6;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly wrapper: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private hTilt: ShaderPass | null = null;
  private vTilt: ShaderPass | null = null;
  private profile: QualityProfile;
  quality: QualityTier;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  /** Lowered automatically if frames are slow (never raised again). */
  private ratioCap: number;
  private slowFrames = 0;
  private sampledFrames = 0;
  private resizeObserver: ResizeObserver;
  private revealed = false;
  onResize: (w: number, h: number) => void = () => {};

  constructor(
    private container: HTMLElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    quality: QualityTier | ((gl: WebGL2RenderingContext) => QualityTier),
  ) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'world-stage';
    Object.assign(this.wrapper.style, {
      position: 'absolute', inset: '0', overflow: 'hidden', opacity: '0',
      transition: 'opacity 700ms ease', touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.renderer.info.autoReset = false; // the composer renders several passes per frame
    this.quality = typeof quality === 'function' ? quality(this.renderer.getContext() as WebGL2RenderingContext) : quality;
    this.profile = PROFILES[this.quality];
    this.ratioCap = this.profile.maxPixelRatio;
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    this.wrapper.appendChild(this.canvas);

    // Soft warm vignette, done in CSS.
    const vignette = document.createElement('div');
    Object.assign(vignette.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none',
      background: 'radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(70,35,20,0.32) 100%)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.wrapper.appendChild(vignette);
    container.appendChild(this.wrapper);

    this.applyProfile();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** False while the container has no size (hidden tab, display:none). */
  get hasSize(): boolean {
    return this.width > 0 && this.height > 0;
  }

  get aspect(): number {
    return this.hasSize ? this.width / this.height : 1;
  }

  get info() {
    return { pixelRatio: this.pixelRatio, width: this.width, height: this.height, ...this.renderer.info.render };
  }

  setQuality(q: QualityTier): void {
    if (q === this.quality) return;
    this.quality = q;
    this.profile = PROFILES[q];
    this.ratioCap = this.profile.maxPixelRatio;
    this.applyProfile();
    this.resize(true);
  }

  private applyProfile(): void {
    const p = this.profile;
    const needsComposer = p.bloom || p.tiltShift;
    if (needsComposer && !this.composer) {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: p.msaa });
      this.composer = new EffectComposer(this.renderer, rt);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.4, 1.35);
      this.composer.addPass(this.bloom);
      this.hTilt = new ShaderPass(HorizontalTiltShiftShader);
      this.vTilt = new ShaderPass(VerticalTiltShiftShader);
      this.hTilt.uniforms.r.value = 0.5;
      this.vTilt.uniforms.r.value = 0.5;
      this.composer.addPass(this.hTilt);
      this.composer.addPass(this.vTilt);
      this.composer.addPass(new OutputPass());
    }
    if (this.composer) {
      this.bloom!.enabled = p.bloom;
      this.hTilt!.enabled = p.tiltShift;
      this.vTilt!.enabled = p.tiltShift;
    }
  }

  private get useComposer(): boolean {
    return !!this.composer && (this.profile.bloom || this.profile.tiltShift);
  }

  resize(force = false): void {
    const w = Math.floor(this.container.clientWidth);
    const h = Math.floor(this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.ratioCap);
    if (!force && w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    if (!this.hasSize) return; // Never size GL buffers to zero.
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.bloom!.resolution.set(w * pr * 0.5, h * pr * 0.5);
      this.hTilt!.uniforms.h.value = TILT_AMOUNT / (w * pr);
      this.vTilt!.uniforms.v.value = TILT_AMOUNT / (h * pr);
    }
    this.onResize(w, h);
  }

  /** Watches frame times and lowers the pixel ratio if the GPU can't keep up. */
  trackFrame(dt: number): void {
    if (!this.revealed || dt > 0.1) return;
    this.sampledFrames++;
    if (dt > 1 / 48) this.slowFrames++;
    if (this.sampledFrames < 120) return;
    if (this.slowFrames > 80 && this.ratioCap > 1) {
      this.ratioCap = Math.max(1, Math.min(this.ratioCap, this.pixelRatio) - 0.25);
      this.resize(true);
    }
    this.sampledFrames = 0;
    this.slowFrames = 0;
  }

  render(dt: number): boolean {
    if (!this.hasSize) return false;
    this.renderer.info.reset();
    if (this.useComposer) this.composer!.render(dt);
    else this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** Fade the canvas in. Called after the first good frame. */
  reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    requestAnimationFrame(() => (this.wrapper.style.opacity = '1'));
  }

  get isRevealed(): boolean {
    return this.revealed;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    if (this.composer) {
      for (const p of this.composer.passes) p.dispose();
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.wrapper.remove();
  }
}
