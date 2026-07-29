/** Shared, mutable settings. The overlay writes here; systems read here. */
export function createSettings() {
  return {
    // post
    bloom: true,
    tonemap: true,
    chroma: true,
    dof: false,
    grain: true,
    sharpen: true,
    fxaa: true,
    vignette: true,

    // systems
    lensing: true,
    nebula: true,
    trail: true,
    asteroids: true,
    dust: true,

    // art params
    exposure: 1.05,
    bloomIntensity: 0.62,
    lensMass: 1.0,
    nebulaDensity: 1.0,
    trailDepth: 1.0,
    refill: 1.0,
    shipSpeed: 1.0,

    _dirty: false,
  };
}
