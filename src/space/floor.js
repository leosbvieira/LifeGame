import {
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
} from '@babylonjs/core';
import { noise2, fbm2, clamp01 } from './noise.js';
import { smoothstep } from '../core/scratch.js';
import { isLite } from '../core/quality.js';

/**
 * The luminous gas sea the ship skims across — the deformable "ground" of the
 * demo. A single player-following grid patch, CPU-displaced from the GasField
 * every frame with freshly recomputed normals.
 *
 * Shading is baked into per-vertex colours on the CPU and the mesh is drawn
 * UNLIT (disableLighting): this makes the sea reliably self-luminous — the whole
 * point of a glowing gas sea — while still reading as a formed 3D surface,
 * because we fold a directional N·L term (form + trench self-shadow) into the
 * colour ourselves, then add self-lit hot wakes on top so they glow even inside
 * trenches. One mesh, one draw, no fragile shared-geometry tricks.
 */
export class GasFloor {
  /** @param {import('@babylonjs/core').Scene} scene @param {import('../field/gasfield.js').GasField} field */
  constructor(scene, field, settings) {
    this.scene = scene;
    this.field = field;
    this.settings = settings;
    this.M = isLite() ? 96 : 168; // grid resolution (verts per side)
    this.baseY = 0;
    this._time = 0;

    const M = this.M;
    const half = field.worldSize * 0.5;
    const step = field.worldSize / (M - 1);
    const vcount = M * M;

    this.positions = new Float32Array(vcount * 3);
    this.normals = new Float32Array(vcount * 3);
    this.colors = new Float32Array(vcount * 4);
    this.uvs = new Float32Array(vcount * 2);
    const indices = new Uint32Array((M - 1) * (M - 1) * 6);

    for (let z = 0; z < M; z++) {
      for (let x = 0; x < M; x++) {
        const i = z * M + x;
        this.positions[i * 3] = -half + x * step;
        this.positions[i * 3 + 1] = 0;
        this.positions[i * 3 + 2] = -half + z * step;
        this.uvs[i * 2] = x / (M - 1);
        this.uvs[i * 2 + 1] = z / (M - 1);
        this.normals[i * 3 + 1] = 1;
        this.colors[i * 4 + 3] = 1;
      }
    }
    let t = 0;
    for (let z = 0; z < M - 1; z++) {
      for (let x = 0; x < M - 1; x++) {
        const a = z * M + x;
        const b = a + 1;
        const c = a + M;
        const d = c + 1;
        indices[t++] = a; indices[t++] = b; indices[t++] = c;
        indices[t++] = b; indices[t++] = d; indices[t++] = c;
      }
    }
    this.indices = indices;

    const vd = new VertexData();
    vd.positions = this.positions;
    vd.indices = indices;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.colors = this.colors;

    const base = new Mesh('gasFloor', scene);
    vd.applyToMesh(base, true); // updatable
    base.isPickable = false;
    base.alwaysSelectAsActiveMesh = true;
    base.useVertexColors = true;
    this.base = base;
    // Kept for the overlay "trail" toggle (it enables/disables this mesh).
    this.glow = base;

    // Lit mesh: the per-vertex colour is the albedo (bright, so the sea reads as
    // a luminous gas sea), shaded by the scene key + fill lights for real form.
    // A small emissive floor keeps shadowed gas from going dead-black.
    const bmat = new StandardMaterial('gasFloorMat', scene);
    bmat.diffuseColor = new Color3(1, 1, 1); // modulated by vertex colour
    bmat.emissiveColor = new Color3(0.06, 0.10, 0.18);
    bmat.specularColor = new Color3(0.06, 0.10, 0.16);
    bmat.specularPower = 64;
    base.material = bmat;
    this.baseMat = bmat;

    // Wake colour ramp endpoints.
    this.coolGlow = new Color3(0.12, 0.5, 0.95); // cyan wake
    this.hotGlow = new Color3(0.9, 0.55, 1.0); // magenta-white crest
  }

  /** Base undulation of the undisturbed gas sea, sampled in world space.
   *  A slow traveling swell (driven by this._time) keeps the sea alive. */
  _baseHeight(wx, wz) {
    const s = 0.0016;
    const tm = this._time;
    let h = fbm2(wx * s, wz * s, 4) * 26;
    h += noise2(wx * s * 4.2 + 10, wz * s * 4.2) * 6;
    // Gentle drifting swells so the gas breathes rather than sitting frozen.
    h += Math.sin(wx * 0.006 + tm * 0.55) * 3.5;
    h += Math.sin(wz * 0.0045 - tm * 0.42) * 3.0;
    h += Math.sin((wx + wz) * 0.011 + tm * 0.8) * 1.8;
    return h;
  }

  update(dt, shipPos) {
    const field = this.field;
    const M = this.M;
    const half = field.worldSize * 0.5;
    const step = field.worldSize / (M - 1);
    this._time += dt;

    // Snap follow position to texel so the surface doesn't swim.
    const t = field.texel;
    const cx = Math.round(shipPos.x / t) * t;
    const cz = Math.round(shipPos.z / t) * t;
    this.base.position.set(cx, this.baseY, cz);

    const amp = 30 * this.settings.trailDepth;
    const pos = this.positions;
    const col = this.colors;
    const nrm = this.normals;
    const depth = field.depth, berm = field.berm, glow = field.glow, ice = field.ice;

    const cool = this.coolGlow, hot = this.hotGlow;

    // Pass 1: displacement.
    for (let z = 0; z < M; z++) {
      for (let x = 0; x < M; x++) {
        const vi = z * M + x;
        const wx = cx - half + x * step;
        const wz = cz - half + z * step;
        const idx = field.worldIndex(wx, wz);
        let d = 0, b = 0;
        if (idx >= 0) { d = depth[idx]; b = berm[idx]; }
        pos[vi * 3 + 1] = this._baseHeight(wx, wz) + (b - d) * amp;
      }
    }

    // Normals from the new heights (drives baked shading + self-shadow feel).
    VertexData.ComputeNormals(pos, this.indices, nrm);

    // Pass 2: colour = baked-lit base glow + self-lit hot wake + ice frost.
    for (let z = 0; z < M; z++) {
      for (let x = 0; x < M; x++) {
        const vi = z * M + x;
        const wx = cx - half + x * step;
        const wz = cz - half + z * step;
        const idx = field.worldIndex(wx, wz);
        let g = 0, ic = 0, b = 0;
        if (idx >= 0) { g = glow[idx]; ic = ice[idx]; b = berm[idx]; }

        // Living-sea base glow (albedo): regional nebula colour that drifts
        // teal -> blue -> violet across the field, so the sea isn't monochrome.
        const bn = fbm2(wx * 0.0011 + 7, wz * 0.0011, 3) * 0.5 + 0.5;
        const bn2 = fbm2(wx * 0.004 - 3, wz * 0.004, 2) * 0.5 + 0.5;
        const k = fbm2(wx * 0.0007 - 12, wz * 0.0007 + 5, 2) * 0.5 + 0.5;
        let pr, pg, pb;
        if (k < 0.5) {
          const tt = k * 2; // teal -> blue
          pr = 0.07 + (0.16 - 0.07) * tt;
          pg = 0.44 + (0.26 - 0.44) * tt;
          pb = 0.52 + (0.78 - 0.52) * tt;
        } else {
          const tt = (k - 0.5) * 2; // blue -> violet
          pr = 0.16 + (0.42 - 0.16) * tt;
          pg = 0.26 + (0.16 - 0.26) * tt;
          pb = 0.78 + (0.66 - 0.78) * tt;
        }
        const cloud = 0.6 + 0.5 * bn2;
        const bright = (0.72 + 0.5 * bn) * cloud;
        let r = pr * bright;
        let gg = pg * bright;
        let bb = pb * bright;

        // Self-lit hot wake (added AFTER shade so it glows inside trenches).
        const heat = clamp01(g);
        const mix = smoothstep(0.0, 1.0, heat);
        const rim = clamp01(b * 0.6);
        const lum = heat * 1.05 + rim * 0.5;
        r += (cool.r + (hot.r - cool.r) * mix) * lum;
        gg += (cool.g + (hot.g - cool.g) * mix) * lum;
        bb += (cool.b + (hot.b - cool.b) * mix) * lum;

        // Ice frosts toward cold white-blue.
        r = r * (1 - ic) + ic * (0.75 + heat * 0.5);
        gg = gg * (1 - ic) + ic * (0.88 + heat * 0.4);
        bb = bb * (1 - ic) + ic * 1.0;

        col[vi * 4] = r;
        col[vi * 4 + 1] = gg;
        col[vi * 4 + 2] = bb;
      }
    }

    this.base.updateVerticesData('position', pos, false, false);
    this.base.updateVerticesData('normal', nrm, false, false);
    this.base.updateVerticesData('color', col, false, false);
  }
}
