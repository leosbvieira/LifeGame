import {
  MeshBuilder,
  TransformNode,
  StandardMaterial,
  PBRMetallicRoughnessMaterial,
  RawTexture,
  Texture,
  Constants,
  Color3,
  Vector3,
} from '@babylonjs/core';
import { fbm2, clamp01 } from './noise.js';

/**
 * A ringed gas giant hanging in the sky. Procedural banded body + a ring system
 * with radial density bands and a Cassini-style division. Purely visual scale —
 * it lives far away and never interacts with the deformation field.
 *
 * Returns { group } (a TransformNode you can position/tilt).
 */
export function buildSaturn(scene, opts = {}) {
  const radius = opts.radius ?? 780;
  const group = new TransformNode('saturnGroup', scene);
  group.position.copyFrom(opts.position ?? new Vector3(7200, 2600, 12000));
  group.rotation.z = -0.42; // axial tilt

  // --- Planet body ---
  const planet = MeshBuilder.CreateSphere('saturn', { diameter: radius * 2, segments: 48 }, scene);
  planet.parent = group;
  const bandTex = makeBandTexture(scene, 1024, 512);
  const pmat = new StandardMaterial('saturnMat', scene);
  pmat.diffuseTexture = bandTex;
  pmat.emissiveTexture = bandTex;
  pmat.emissiveColor = new Color3(0.16, 0.14, 0.1); // gentle self-glow so night side isn't dead
  pmat.specularColor = new Color3(0.05, 0.05, 0.04);
  pmat.specularPower = 8;
  planet.material = pmat;
  planet.isPickable = false;
  pmat.freeze();
  planet.freezeWorldMatrix();

  // --- Ring system ---
  const ring = MeshBuilder.CreateDisc('saturnRing', { radius: radius * 2.35, tessellation: 96 }, scene);
  ring.parent = group;
  ring.rotation.x = Math.PI / 2; // lie in equatorial plane
  const ringTex = makeRingTexture(scene, 1024, radius * 2.35);
  const rmat = new StandardMaterial('ringMat', scene);
  rmat.diffuseTexture = ringTex;
  rmat.emissiveTexture = ringTex;
  rmat.emissiveColor = new Color3(0.5, 0.46, 0.4);
  rmat.diffuseTexture.hasAlpha = true;
  rmat.useAlphaFromDiffuseTexture = true;
  rmat.opacityTexture = ringTex;
  rmat.backFaceCulling = false;
  rmat.disableLighting = false;
  rmat.specularColor = new Color3(0, 0, 0);
  ring.material = rmat;
  ring.isPickable = false;
  ring.visibility = 1;
  rmat.freeze();
  ring.freezeWorldMatrix();

  return { group, planet, ring };
}

/** Equirect banded texture: horizontal cream/tan bands with turbulent swirl. */
function makeBandTexture(scene, w, h) {
  const data = new Uint8Array(w * h * 4);
  // Saturn palette stops (cream, tan, gold, pale).
  const stops = [
    [0.86, 0.78, 0.6],
    [0.78, 0.66, 0.44],
    [0.9, 0.84, 0.68],
    [0.72, 0.6, 0.4],
    [0.82, 0.74, 0.56],
  ];
  for (let y = 0; y < h; y++) {
    const v = y / h; // 0 top .. 1 bottom (latitude)
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // Turbulence warps the latitude used for band lookup.
      const turb = fbm2(u * 6.0, v * 14.0, 4) * 0.06;
      let lat = v + turb;
      const bandF = lat * (stops.length - 1);
      const bi = Math.min(stops.length - 2, Math.max(0, Math.floor(bandF)));
      const bf = clamp01(bandF - bi);
      // Sharpen band edges a little.
      const bfs = bf * bf * (3 - 2 * bf);
      const c0 = stops[bi];
      const c1 = stops[bi + 1];
      let r = c0[0] + (c1[0] - c0[0]) * bfs;
      let g = c0[1] + (c1[1] - c0[1]) * bfs;
      let b = c0[2] + (c1[2] - c0[2]) * bfs;
      // Fine storm detail.
      const storm = fbm2(u * 30 + 4, v * 40, 4) * 0.08;
      r = clamp01(r + storm);
      g = clamp01(g + storm * 0.9);
      b = clamp01(b + storm * 0.7);
      const i = (y * w + x) * 4;
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new RawTexture(
    data, w, h,
    Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE
  );
  tex.name = 'saturnBands';
  return tex;
}

/** Radial ring texture mapped on a disc. Alpha encodes gaps + Cassini division. */
function makeRingTexture(scene, size, outer) {
  const data = new Uint8Array(size * size * 4);
  const innerFrac = 0.56; // inner edge as fraction of outer radius
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2; // 0..1 at disc edge
      const i = (y * size + x) * 4;

      if (r < innerFrac || r > 0.995) {
        data[i + 3] = 0;
        continue;
      }
      // Normalized position across the ring band.
      const t = (r - innerFrac) / (0.995 - innerFrac);

      // Density bands: layered sinusoids give the ringlet structure.
      let dens =
        0.5 +
        0.28 * Math.sin(t * 60) +
        0.16 * Math.sin(t * 150 + 1.3) +
        0.1 * Math.sin(t * 320 + 0.5);
      dens = clamp01(dens);

      // Cassini division: a dark gap around t~0.62.
      const cassini = 1 - Math.exp(-Math.pow((t - 0.62) / 0.03, 2));
      // Encke-ish thinner gap.
      const encke = 1 - Math.exp(-Math.pow((t - 0.85) / 0.012, 2)) * 0.9;
      let alpha = dens * cassini * encke;
      // Fade at very inner/outer edges.
      alpha *= clamp01((t) / 0.06) * clamp01((1 - t) / 0.06);

      // Ice colour: pale tan, slightly cooler in denser bands.
      const warm = 0.78 + 0.18 * dens;
      data[i] = clamp01(warm) * 255;
      data[i + 1] = clamp01(warm * 0.95) * 255;
      data[i + 2] = clamp01(warm * 0.82) * 255;
      data[i + 3] = clamp01(alpha) * 255;
    }
  }
  const tex = new RawTexture(
    data, size, size,
    Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE
  );
  tex.name = 'saturnRingTex';
  tex.hasAlpha = true;
  return tex;
}
