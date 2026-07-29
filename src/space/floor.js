import {
  Mesh,
  VertexData,
  StandardMaterial,
  RawTexture,
  Texture,
  Constants,
  Color3,
  Color4,
} from '@babylonjs/core';
import { noise2, fbm2, clamp01 } from './noise.js';
import { smoothstep } from '../core/scratch.js';
import { isLite } from '../core/quality.js';

/**
 * The luminous gas sea the ship skims across — the deformable "ground" of the
 * demo. A player-following grid patch, CPU-displaced from the GasField every
 * frame with freshly recomputed normals (so trenches self-shadow) and per-vertex
 * glow (so wakes read as hot, disturbed gas).
 *
 * Two meshes share one geometry:
 *   base  — lit, gives 3D form + self-shadowing of trenches/berms.
 *   glow  — additive, unlit; per-vertex hot colour paints the trails.
 */
export class GasFloor {
  /** @param {import('@babylonjs/core').Scene} scene @param {import('../field/gasfield.js').GasField} field */
  constructor(scene, field, settings) {
    this.scene = scene;
    this.field = field;
    this.settings = settings;
    this.M = isLite() ? 96 : 160; // grid resolution (verts per side)
    this.baseY = 0;

    const M = this.M;
    const half = field.worldSize * 0.5;
    const step = field.worldSize / (M - 1);
    const vcount = M * M;

    this.positions = new Float32Array(vcount * 3);
    this.normals = new Float32Array(vcount * 3);
    this.colors = new Float32Array(vcount * 4);
    this.uvs = new Float32Array(vcount * 2);
    const indices = new Uint32Array((M - 1) * (M - 1) * 6);

    // Local grid (centered on origin; mesh.position follows the ship).
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
        indices[t++] = a; indices[t++] = c; indices[t++] = b;
        indices[t++] = b; indices[t++] = c; indices[t++] = d;
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
    this.base = base;

    // Lit material for form + self-shadow.
    const bmat = new StandardMaterial('gasFloorMat', scene);
    bmat.diffuseColor = new Color3(0.05, 0.11, 0.16);
    bmat.emissiveColor = new Color3(0.015, 0.03, 0.06);
    bmat.specularColor = new Color3(0.1, 0.16, 0.22);
    bmat.specularPower = 24;
    bmat.bumpTexture = makeDetailNormal(scene, 512);
    bmat.bumpTexture.uScale = bmat.bumpTexture.vScale = 42;
    bmat.bumpTexture.level = 0.7;
    base.material = bmat;
    base.useVertexColors = false;
    this.baseMat = bmat;

    // Additive glow overlay sharing the same geometry.
    const glow = base.clone('gasFloorGlow');
    glow.material = null;
    const gmat = new StandardMaterial('gasGlowMat', scene);
    gmat.disableLighting = true;
    gmat.emissiveColor = new Color3(1, 1, 1);
    gmat.diffuseColor = new Color3(0, 0, 0);
    gmat.specularColor = new Color3(0, 0, 0);
    gmat.alphaMode = Constants.ALPHA_ADD;
    glow.material = gmat;
    glow.useVertexColors = true;
    glow.isPickable = false;
    glow.alwaysSelectAsActiveMesh = true;
    this.glow = glow;
    this.glowMat = gmat;

    // Glow colour ramp endpoints.
    this.coolGlow = new Color3(0.12, 0.5, 0.95); // cyan wake
    this.hotGlow = new Color3(0.85, 0.55, 1.0); // magenta-white crest
  }

  /** Base undulation of the undisturbed gas sea, sampled in world space. */
  _baseHeight(wx, wz) {
    const s = 0.0016;
    let h = fbm2(wx * s, wz * s, 4) * 26;
    h += noise2(wx * s * 4.2 + 10, wz * s * 4.2) * 6;
    return h;
  }

  update(dt, shipPos) {
    const field = this.field;
    const M = this.M;
    const half = field.worldSize * 0.5;
    const step = field.worldSize / (M - 1);

    // Snap follow position to texel so the surface doesn't swim.
    const t = field.texel;
    const cx = Math.round(shipPos.x / t) * t;
    const cz = Math.round(shipPos.z / t) * t;
    this.base.position.set(cx, this.baseY, cz);
    this.glow.position.set(cx, this.baseY, cz);

    const amp = 30 * this.settings.trailDepth;
    const pos = this.positions;
    const col = this.colors;
    const depth = field.depth, berm = field.berm, glow = field.glow, ice = field.ice;
    const N = field.N;

    const cool = this.coolGlow, hot = this.hotGlow;

    for (let z = 0; z < M; z++) {
      for (let x = 0; x < M; x++) {
        const vi = z * M + x;
        const wx = cx - half + x * step;
        const wz = cz - half + z * step;

        // Nearest-texel field sample (window-relative).
        const idx = field.worldIndex(wx, wz);
        let d = 0, b = 0, g = 0, ic = 0;
        if (idx >= 0) {
          d = depth[idx]; b = berm[idx]; g = glow[idx]; ic = ice[idx];
        }

        const yBase = this._baseHeight(wx, wz);
        pos[vi * 3 + 1] = yBase + (b - d) * amp;

        // Glow colour: cyan cool wake -> hot magenta crest, plus icy tint.
        const heat = clamp01(g);
        const mix = smoothstep(0.0, 1.0, heat);
        let r = cool.r + (hot.r - cool.r) * mix;
        let gg = cool.g + (hot.g - cool.g) * mix;
        let bb = cool.b + (hot.b - cool.b) * mix;
        // Berm rims catch light and glow a touch.
        const rim = clamp01(b * 0.6);
        const lum = heat * 1.4 + rim * 0.5;
        // Ice shifts toward a cold white-blue sparkle.
        r = (r * lum) * (1 - ic) + ic * (0.7 + heat) * 0.9;
        gg = (gg * lum) * (1 - ic) + ic * (0.85 + heat) * 0.95;
        bb = (bb * lum) * (1 - ic) + ic * (1.0);
        col[vi * 4] = r;
        col[vi * 4 + 1] = gg;
        col[vi * 4 + 2] = bb;
      }
    }

    VertexData.ComputeNormals(pos, this.indices, this.normals);
    this.base.updateVerticesData('position', pos, false, false);
    this.base.updateVerticesData('normal', this.normals, false, false);
    this.base.updateVerticesData('color', col, false, false);
  }
}

/** Tiling detail normal map baked from noise (CPU). */
function makeDetailNormal(scene, size) {
  const data = new Uint8Array(size * size * 4);
  const s = 0.06;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hx1 = fbm2((x + 1) * s, y * s, 4);
      const hx0 = fbm2((x - 1) * s, y * s, 4);
      const hy1 = fbm2(x * s, (y + 1) * s, 4);
      const hy0 = fbm2(x * s, (y - 1) * s, 4);
      let nx = (hx0 - hx1) * 2.2;
      let ny = (hy0 - hy1) * 2.2;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new RawTexture(
    data, size, size,
    Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.name = 'gasDetailNormal';
  return tex;
}
