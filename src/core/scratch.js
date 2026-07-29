import { Vector3, Vector2, Quaternion, Matrix, Color3, Color4 } from '@babylonjs/core';

/**
 * Module-scope scratch instances. The render loop must not allocate.
 * Grab one of these, use it immediately, do not hold a reference across frames.
 */
export const v3a = new Vector3();
export const v3b = new Vector3();
export const v3c = new Vector3();
export const v3d = new Vector3();
export const v3e = new Vector3();
export const v2a = new Vector2();
export const v2b = new Vector2();
export const qa = new Quaternion();
export const qb = new Quaternion();
export const mA = new Matrix();
export const mB = new Matrix();
export const c3a = new Color3();
export const c4a = new Color4();

/** Clamp helper (no allocation). */
export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Framerate-independent exponential smoothing. rate ~ how fast it converges. */
export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Linear interpolate scalars. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smoothstep 0..1. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic hash -> [0,1). Good enough for jitter/seeding, no allocation. */
export function hash11(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
