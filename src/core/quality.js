/**
 * "Lite" mode (URL ?lite) drastically reduces cost so the software SwiftShader
 * renderer can capture screenshots in CI without crashing. It has NO effect on
 * the real GPU demo — production quality is the default path.
 */
export function isLite() {
  return typeof globalThis !== 'undefined' && globalThis.__LITE__ === true;
}

/** Environment-only bisection mode (URL ?min): sky + bodies + lensing, no
 *  floor/shadows/particles. Used to isolate crashes under SwiftShader. */
export function isMin() {
  return typeof globalThis !== 'undefined' && globalThis.__MIN__ === true;
}

/** WebGL capture mode (URL ?gl): boot a WebGL2 engine instead of WebGPU purely
 *  so headless CI can composite a screenshot (WebGPU canvases are not captured
 *  here). The WGSL lensing pass is skipped. NO effect on the shipped WebGPU demo. */
export function isGL() {
  return typeof globalThis !== 'undefined' && globalThis.__GL__ === true;
}
