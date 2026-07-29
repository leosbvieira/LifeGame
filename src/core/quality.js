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
