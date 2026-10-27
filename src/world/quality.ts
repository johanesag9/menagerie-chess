/** Quality tiers: what each tier turns on, and auto-detection. */
import type { QualityTier } from '../contracts/types';

export interface QualityProfile {
  /** Cap for devicePixelRatio. */
  maxPixelRatio: number;
  shadowMapSize: number;
  tiltShift: boolean;
  bloom: boolean;
  /** MSAA samples for the post-processing target (0 = none). */
  msaa: number;
  /** Share of the grass/flower instances that are drawn (0..1). */
  propDensity: number;
  /** Extra props (birds, buckets, shells, more clouds...). */
  extraProps: boolean;
}

export const PROFILES: Record<QualityTier, QualityProfile> = {
  high: { maxPixelRatio: 2, shadowMapSize: 2048, tiltShift: true, bloom: true, msaa: 4, propDensity: 1, extraProps: true },
  low: { maxPixelRatio: 1.5, shadowMapSize: 1024, tiltShift: false, bloom: false, msaa: 0, propDensity: 0.35, extraProps: false },
};

export interface DeviceInfo {
  /** Smallest side of the screen, CSS px. */
  minScreenSide: number;
  coarsePointer: boolean;
  userAgent: string;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** Unmasked GPU renderer string, when available. */
  gpu?: string;
}

/** GPUs that struggle with post-processing and soft shadows. */
const WEAK_GPU = /(swiftshader|llvmpipe|software|microsoft basic|intel\(r\) hd graphics [2-5]\d{2}\b|intel hd graphics [2-5]\d{2}\b|mali-[4t]|adreno \(tm\) [3-5]\d{2}|powervr)/i;
const MOBILE_UA = /android|iphone|ipad|ipod|mobile/i;

export function detectQuality(d: DeviceInfo): QualityTier {
  const phoneSized = d.minScreenSide < 600;
  const mobile = MOBILE_UA.test(d.userAgent) || (d.coarsePointer && d.minScreenSide < 900);
  if (phoneSized || mobile) return 'low';
  if (d.gpu && WEAK_GPU.test(d.gpu)) return 'low';
  if (d.deviceMemory !== undefined && d.deviceMemory < 4) return 'low';
  if (d.hardwareConcurrency !== undefined && d.hardwareConcurrency <= 2) return 'low';
  return 'high';
}

/** Reads the real device. Pass a WebGL context to also check the GPU name. */
export function readDeviceInfo(gl?: WebGLRenderingContext | WebGL2RenderingContext): DeviceInfo {
  let gpu: string | undefined;
  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    } catch {
      gpu = undefined;
    }
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    minScreenSide: Math.min(screen.width, screen.height, window.innerWidth || Infinity, window.innerHeight || Infinity),
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    userAgent: navigator.userAgent,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    gpu,
  };
}
