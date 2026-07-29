import {
  RawCubeTexture,
  Constants,
  Texture,
  StandardMaterial,
  MeshBuilder,
  Color3,
} from '@babylonjs/core';
import { fbm3, ridged3, clamp01 } from './noise.js';

/**
 * Deep-space nebula background baked on the CPU into a cube texture, drawn on a
 * skybox mesh (SKYBOX_MODE). Low-frequency, so a small face size is plenty — the
 * crisp point-stars come from the PointsCloudSystem layer, not this.
 *
 * Returns { skybox, cubeTexture }.
 */
export function buildSkybox(scene, faceSize = 256) {
  const cube = generateNebulaCube(faceSize);

  const tex = new RawCubeTexture(
    scene,
    cube,
    faceSize,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true, // generate mipmaps
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  tex.coordinatesMode = Texture.SKYBOX_MODE;
  tex.gammaSpace = false; // treat as linear HDR-ish

  const skybox = MeshBuilder.CreateBox('nebulaSky', { size: 20000 }, scene);
  const mat = new StandardMaterial('nebulaMat', scene);
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  mat.reflectionTexture = tex;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  // Skybox recipe: the reflection texture IS the output. A non-zero emissive
  // here would add a flat white wash over the whole sky (blow-out).
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.twoSidedLighting = false;
  skybox.material = mat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;
  skybox.applyFog = false;
  mat.freeze();

  return { skybox, cubeTexture: tex };
}

const sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Bake 6 RGBA faces of nebula. Returns [ +X,-X,+Y,-Y,+Z,-Z ] Uint8Arrays.
 *  Deep space: mostly black void with sparse coloured nebula regions and a
 *  faint galactic dust band — NOT uniform milky cloud. */
function generateNebulaCube(size) {
  const faces = [];
  // Palette: three colored cloud systems.
  const cA = [0.62, 0.16, 0.55]; // magenta-violet
  const cB = [0.10, 0.42, 0.64]; // teal-blue
  const cC = [0.70, 0.45, 0.18]; // dusty gold
  const base = [0.004, 0.006, 0.014]; // near-black deep space

  const dir = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    const buf = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const b = (2 * (y + 0.5)) / size - 1;
      for (let x = 0; x < size; x++) {
        const a = (2 * (x + 0.5)) / size - 1;
        faceDir(f, a, b, dir);
        const nx = dir[0], ny = dir[1], nz = dir[2];
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        const dx = nx * inv, dy = ny * inv, dz = nz * inv;

        // Large-scale mask that decides WHERE nebula exists at all (sparse).
        const region = fbm3(dx * 0.9 + 4, dy * 0.9 - 2, dz * 0.9, 4) * 0.5 + 0.5;
        const gate = sstep(0.52, 0.78, region); // most of the sky stays void

        // Detail clouds inside the regions.
        const s = 2.1;
        let d1 = fbm3(dx * s + 11, dy * s, dz * s, 5) * 0.5 + 0.5;
        let d2 = fbm3(dx * s * 1.5 - 5, dy * s * 1.5 + 3, dz * s * 1.5, 5) * 0.5 + 0.5;
        let fil = ridged3(dx * 3.4, dy * 3.4 + 20, dz * 3.4, 4);

        d1 = sstep(0.45, 0.95, d1) * gate;
        d2 = sstep(0.5, 1.0, d2) * gate;
        fil = sstep(0.3, 0.8, fil * 1.4) * gate;

        // Faint tilted galactic dust band.
        const bandV = dy * 0.82 + dx * 0.28;
        const band = Math.exp(-(bandV * bandV) * 7.0) * 0.16;

        let r = base[0] + cA[0] * d1 * 0.6 + cB[0] * d2 * 0.5 + cC[0] * fil * 0.8 + band * 0.5;
        let g = base[1] + cA[1] * d1 * 0.6 + cB[1] * d2 * 0.5 + cC[1] * fil * 0.8 + band * 0.42;
        let bl = base[2] + cA[2] * d1 * 0.6 + cB[2] * d2 * 0.5 + cC[2] * fil * 0.8 + band * 0.62;

        // Overall dim — keep peaks modest so it reads as distant nebula, and
        // let the deep void dominate.
        r *= 0.62; g *= 0.62; bl *= 0.62;

        const i = (y * size + x) * 4;
        buf[i] = clamp01(r) * 255;
        buf[i + 1] = clamp01(g) * 255;
        buf[i + 2] = clamp01(bl) * 255;
        buf[i + 3] = 255;
      }
    }
    faces.push(buf);
  }
  return faces;
}

/** Canonical cube face direction for face index f and in-face coords a,b in [-1,1]. */
function faceDir(f, a, b, out) {
  switch (f) {
    case 0: out[0] = 1; out[1] = -b; out[2] = -a; break; // +X
    case 1: out[0] = -1; out[1] = -b; out[2] = a; break; // -X
    case 2: out[0] = a; out[1] = 1; out[2] = b; break; // +Y
    case 3: out[0] = a; out[1] = -1; out[2] = -b; break; // -Y
    case 4: out[0] = a; out[1] = -b; out[2] = 1; break; // +Z
    case 5: out[0] = -a; out[1] = -b; out[2] = -1; break; // -Z
  }
}
