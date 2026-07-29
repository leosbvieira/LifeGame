import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
import { isLite } from './quality.js';

/**
 * Boot the WebGPU engine. WebGPU only — no WebGL fallback by design.
 * Returns null (after showing the fatal message) if WebGPU is unavailable.
 * @param {HTMLCanvasElement} canvas
 */
export async function bootEngine(canvas) {
  if (!navigator.gpu) {
    document.getElementById('fatal').style.display = 'flex';
    document.getElementById('loader').style.display = 'none';
    return null;
  }

  const engine = new WebGPUEngine(canvas, {
    antialias: !isLite(), // MSAA is unstable on headless SwiftShader
    stencil: true,
    powerPreference: 'high-performance',
    // We drive our own AA/TAA via the post pipeline; keep the swapchain clean.
    adaptToDeviceRatio: false,
  });

  try {
    await engine.initAsync();
  } catch (err) {
    console.error('WebGPU init failed', err);
    document.getElementById('fatal').style.display = 'flex';
    document.getElementById('loader').style.display = 'none';
    return null;
  }

  // Render at native resolution but cap DPR so 4K panels don't melt the budget.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  engine.setHardwareScalingLevel(1 / dpr);

  window.addEventListener('resize', () => engine.resize());

  return engine;
}
