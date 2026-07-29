import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { LensingPass } from './lensing.js';
import { isLite } from '../core/quality.js';

/**
 * Full post chain. Order (Babylon default pipeline internally): scene ->
 * lensing warp -> DoF -> bloom -> chromatic aberration -> image processing
 * (ACES tonemap + vignette + exposure) -> grain -> FXAA -> sharpen.
 *
 * TAA is intentionally omitted (FXAA instead) — see DECISIONS.md. Every stage
 * is individually toggleable from the overlay for A/B comparison.
 */
export class PostChain {
  constructor(scene, camera, settings, world) {
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;

    // Lensing runs first so bloom/tonemap grade the photon ring it adds.
    this.lensing = new LensingPass(scene, camera, settings, world.blackHole);
    this.lensing.setEnabled(settings.lensing);

    const lite = isLite();
    const dp = new DefaultRenderingPipeline('void', !lite /* HDR */, scene, [camera]);
    this.dp = dp;

    dp.bloomEnabled = true;
    dp.bloomThreshold = 0.72;
    dp.bloomWeight = settings.bloomIntensity;
    dp.bloomKernel = lite ? 32 : 96;
    dp.bloomScale = lite ? 0.4 : 0.6;

    dp.fxaaEnabled = settings.fxaa;

    dp.chromaticAberrationEnabled = settings.chroma && !lite;
    dp.chromaticAberration.aberrationAmount = 14;
    dp.chromaticAberration.radialIntensity = 0.7;

    dp.grainEnabled = settings.grain;
    dp.grain.intensity = 7;
    dp.grain.animated = true;

    dp.sharpenEnabled = settings.sharpen;
    dp.sharpen.edgeAmount = 0.25;

    dp.depthOfFieldEnabled = settings.dof;
    dp.depthOfFieldBlurLevel = 1; // medium
    dp.depthOfField.focalLength = 160;
    dp.depthOfField.fStop = 2.4;
    dp.depthOfField.focusDistance = 22000;

    // Image processing: ACES tonemap, exposure, vignette, gentle contrast.
    dp.imageProcessingEnabled = true;
    const ip = dp.imageProcessing;
    ip.toneMappingEnabled = settings.tonemap;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = settings.exposure;
    ip.contrast = 1.12;
    ip.vignetteEnabled = settings.vignette;
    ip.vignetteWeight = 2.4;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor.set(0.02, 0.02, 0.06, 0);

    this._dofPulse = 0;
  }

  /** Push a short DoF/vignette pulse (e.g. on warp) for cinematic punch. */
  update(dt, ship) {
    const s = this.settings;
    const dp = this.dp;

    if (s._dirty) {
      dp.bloomEnabled = s.bloom;
      dp.bloomWeight = s.bloomIntensity;
      dp.fxaaEnabled = s.fxaa;
      dp.chromaticAberrationEnabled = s.chroma;
      dp.grainEnabled = s.grain;
      dp.sharpenEnabled = s.sharpen;
      dp.depthOfFieldEnabled = s.dof;
      const ip = dp.imageProcessing;
      ip.toneMappingEnabled = s.tonemap;
      ip.vignetteEnabled = s.vignette;
      ip.exposure = s.exposure;
      this.lensing.setEnabled(s.lensing);
      s._dirty = false;
    }

    // Speed-reactive chromatic aberration for the sense of velocity.
    if (dp.chromaticAberrationEnabled && ship) {
      dp.chromaticAberration.aberrationAmount = 10 + ship.speed01 * 34;
    }

    this.lensing.update();
  }
}
