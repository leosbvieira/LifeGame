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
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.twoSidedLighting = false;
  skybox.material = mat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;
  skybox.applyFog = false;
  mat.freeze();

  return { skybox, cubeTexture: tex };
}

/** Bake 6 RGBA faces of nebula. Returns [ +X,-X,+Y,-Y,+Z,-Z ] Uint8Arrays. */
function generateNebulaCube(size) {
  const faces = [];
  // Palette: three colored cloud systems + faint galactic dust.
  const cA = [0.55, 0.18, 0.62]; // magenta-violet
  const cB = [0.12, 0.42, 0.6]; // teal
  const cC = [0.68, 0.5, 0.24]; // dusty gold
  const base = [0.012, 0.014, 0.028]; // near-black deep space

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

        // Sample three cloud systems at different offsets/frequencies.
        const s = 1.7;
        let d1 = fbm3(dx * s + 11, dy * s, dz * s, 5);
        let d2 = fbm3(dx * s * 1.4 - 5, dy * s * 1.4 + 3, dz * s * 1.4, 5);
        let fil = ridged3(dx * 3.1, dy * 3.1 + 20, dz * 3.1, 4);

        d1 = clamp01(d1 * 1.4 + 0.15);
        d2 = clamp01(d2 * 1.5 - 0.05);
        fil = clamp01(fil * 1.2 - 0.35);

        // Galactic band: brighter dust along a great circle (y near a tilted plane).
        const band = Math.exp(-Math.pow((dy * 0.8 + dx * 0.25) * 2.4, 2)) * 0.35;

        let r = base[0], g = base[1], bl = base[2];
        r += cA[0] * d1 * 0.7 + cB[0] * d2 * 0.55 + cC[0] * fil * 0.9 + band * 0.5;
        g += cA[1] * d1 * 0.7 + cB[1] * d2 * 0.55 + cC[1] * fil * 0.9 + band * 0.42;
        bl += cA[2] * d1 * 0.7 + cB[2] * d2 * 0.55 + cC[2] * fil * 0.9 + band * 0.6;

        // Subtle vignette toward deep black so clouds float in void.
        const dens = clamp01(d1 * 0.5 + d2 * 0.4 + fil * 0.5 + band);
        r *= 0.4 + 0.6 * dens + 0.15;
        g *= 0.4 + 0.6 * dens + 0.15;
        bl *= 0.4 + 0.6 * dens + 0.15;

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
