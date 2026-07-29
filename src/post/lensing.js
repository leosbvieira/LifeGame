import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Vector3, Viewport } from '@babylonjs/core/Maths/math.js';
import { v3a, v3b, v3c, v3d, v3e, clamp } from '../core/scratch.js';

// --- Gravitational-lensing screen-space warp (WGSL) ---------------------------
// The one hand-written shader in the project. Bends the background around the
// black hole's screen position into an Einstein-ring pile-up, punches an event
// horizon, and adds a photon ring. Uses textureSampleLevel so the conditional
// sampling is legal in non-uniform control flow.
ShaderStore.ShadersStoreWGSL['voidLensingFragmentShader'] = /* wgsl */ `
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

uniform bhCenter: vec2f;
uniform bhParams: vec4f;   // x=radius(uv,height), y=strength, z=aspect, w=onScreen

varying vUV: vec2f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let aspect = uniforms.bhParams.z;
  let R = uniforms.bhParams.x;
  let strength = uniforms.bhParams.y;
  let on = uniforms.bhParams.w;

  var base = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);

  // Aspect-corrected offset so the ring stays circular.
  var d = input.vUV - uniforms.bhCenter;
  d.x = d.x * aspect;
  let dist = length(d);

  let influence = R * 7.0;
  if (on > 0.5 && dist < influence && R > 0.0001) {
    let dir = d / max(dist, 1e-5);

    // Deflection grows sharply toward the horizon (~ R^2 / dist^2).
    let bend = strength * R * R / max(dist * dist, 1e-6);
    let bendc = min(bend, influence);

    var suv = input.vUV;
    suv.x = suv.x - (dir.x / aspect) * bendc;
    suv.y = suv.y - dir.y * bendc;
    suv = clamp(suv, vec2f(0.001), vec2f(0.999));

    var col = textureSampleLevel(textureSampler, textureSamplerSampler, suv, 0.0);

    // Event-horizon shadow.
    let horizon = smoothstep(R * 0.96, R * 1.02, dist);
    col = col * horizon;

    // Photon ring: bright thin band just outside the horizon.
    let ringD = (dist - R * 1.05) / (R * 0.05);
    let ring = exp(-ringD * ringD);
    col = col + vec4f(1.0, 0.86, 0.62, 0.0) * ring * 1.6;

    // Blue-white light pile-up further out (lensed background magnification).
    let pileD = (dist - R * 1.7) / (R * 0.55);
    let pileup = exp(-pileD * pileD);
    col = col + vec4f(0.28, 0.5, 0.95, 0.0) * pileup * 0.22;

    // Fade the whole effect out at the edge of influence.
    let edge = smoothstep(influence, influence * 0.72, dist);
    base = mix(base, col, edge);
  }

  fragmentOutputs.color = base;
}
`;

/**
 * Wraps the lensing post-process. Call update() each frame with the black hole
 * and camera so the warp tracks its screen position.
 */
export class LensingPass {
  constructor(scene, camera, settings, blackHole) {
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;
    this.blackHole = blackHole;
    this.viewport = new Viewport(0, 0, 1, 1);

    let pp;
    try {
      pp = new PostProcess(
        'voidLensing',
        'voidLensing',
        {
          uniforms: ['bhCenter', 'bhParams'],
          samplers: [],
          size: 1.0,
          camera,
          samplingMode: Texture.BILINEAR_SAMPLINGMODE,
          engine: scene.getEngine(),
          reusable: false,
          shaderLanguage: ShaderLanguage.WGSL,
        }
      );
    } catch (e) {
      console.warn('Lensing pass unavailable, continuing without it:', e);
      this.pp = null;
      return;
    }
    this.pp = pp;

    // Uniform values, updated each frame.
    this._cx = 0.5;
    this._cy = 0.5;
    this._r = 0.05;
    this._on = 0;

    pp.onApply = (effect) => {
      effect.setFloat2('bhCenter', this._cx, this._cy);
      const eng = scene.getEngine();
      const aspect = eng.getRenderWidth() / Math.max(1, eng.getRenderHeight());
      effect.setFloat4('bhParams', this._r, this.settings.lensMass * 0.9, aspect, this._on);
    };
  }

  setEnabled(on) {
    if (!this.pp) return;
    if (on && this.camera && this.pp._camera == null) this.camera.attachPostProcess(this.pp);
    if (!on && this.camera) this.camera.detachPostProcess(this.pp);
  }

  update() {
    if (!this.pp) return;
    const cam = this.camera;
    const eng = this.scene.getEngine();
    const center = this.blackHole.worldCenter;

    // In front of the camera?
    cam.getDirectionToRef(Vector3.Forward(), v3a); // world forward
    v3b.copyFrom(center).subtractInPlace(cam.position);
    const facing = Vector3.Dot(v3a, v3b.normalizeToRef(v3c));

    if (facing < 0.05) {
      this._on = 0;
      return;
    }

    // Project center -> normalized screen uv.
    Vector3.ProjectToRef(center, IDENTITY, cam.getTransformationMatrix(), this.viewport, v3d);
    const u = v3d.x;
    const v = 1 - v3d.y; // post vUV origin is bottom-left

    // Apparent radius: project a point one horizon-radius "up" from center.
    cam.getDirectionToRef(Vector3.Up(), v3a);
    v3e.copyFrom(center).addInPlace(v3a.scaleInPlace(this.blackHole.radius));
    Vector3.ProjectToRef(v3e, IDENTITY, cam.getTransformationMatrix(), this.viewport, v3d);
    const rUv = Math.abs(1 - v3d.y - v);

    if (u < -0.4 || u > 1.4 || v < -0.4 || v > 1.4) {
      this._on = 0;
      return;
    }

    this._cx = u;
    this._cy = v;
    this._r = clamp(rUv, 0.006, 0.4);
    this._on = this.settings.lensing ? 1 : 0;
  }
}

import { Matrix } from '@babylonjs/core/Maths/math.js';
const IDENTITY = Matrix.Identity();
