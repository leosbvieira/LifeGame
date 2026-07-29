import {
  MeshBuilder,
  TransformNode,
  StandardMaterial,
  RawTexture,
  Texture,
  Constants,
  Color3,
  Vector3,
} from '@babylonjs/core';
import { fbm2, clamp01 } from './noise.js';

/**
 * Supermassive black hole: a black event horizon, a hot accretion disk, and a
 * thin photon ring. The gravitational-lensing warp itself is a screen-space post
 * pass (see post/lensing.js) driven by this object's world center + radius.
 *
 * Returns { group, horizon, disk, worldCenter, radius, spin }.
 */
export function buildBlackHole(scene, opts = {}) {
  const radius = opts.radius ?? 620;
  const group = new TransformNode('bhGroup', scene);
  group.position.copyFrom(opts.position ?? new Vector3(-9400, 2100, 7600));
  group.rotation.x = 0.28; // tilt the disk toward camera so we see the ellipse

  // --- Event horizon: pure black sphere ---
  const horizon = MeshBuilder.CreateSphere('horizon', { diameter: radius * 2, segments: 40 }, scene);
  horizon.parent = group;
  const hmat = new StandardMaterial('horizonMat', scene);
  hmat.diffuseColor = new Color3(0, 0, 0);
  hmat.specularColor = new Color3(0, 0, 0);
  hmat.emissiveColor = new Color3(0, 0, 0);
  hmat.disableLighting = true;
  horizon.material = hmat;
  horizon.isPickable = false;
  horizon.applyFog = false;
  hmat.freeze();

  // --- Accretion disk ---
  const disk = MeshBuilder.CreateDisc('accretion', { radius: radius * 3.4, tessellation: 128 }, scene);
  disk.parent = group;
  disk.rotation.x = Math.PI / 2;
  const diskTex = makeDiskTexture(scene, 1024, radius);
  const dmat = new StandardMaterial('diskMat', scene);
  dmat.diffuseTexture = diskTex;
  dmat.emissiveTexture = diskTex;
  dmat.emissiveColor = new Color3(1, 1, 1);
  dmat.opacityTexture = diskTex;
  dmat.diffuseTexture.hasAlpha = true;
  dmat.disableLighting = true;
  dmat.backFaceCulling = false;
  dmat.alphaMode = Constants.ALPHA_ADD;
  dmat.specularColor = new Color3(0, 0, 0);
  disk.material = dmat;
  disk.isPickable = false;
  disk.applyFog = false;
  dmat.freeze();

  // --- Photon ring: thin bright torus just outside the horizon ---
  const photon = MeshBuilder.CreateTorus('photonRing', { diameter: radius * 2.32, thickness: radius * 0.05, tessellation: 96 }, scene);
  photon.parent = group;
  const pmat = new StandardMaterial('photonMat', scene);
  pmat.emissiveColor = new Color3(1.0, 0.86, 0.6);
  pmat.diffuseColor = new Color3(0, 0, 0);
  pmat.disableLighting = true;
  pmat.alphaMode = Constants.ALPHA_ADD;
  pmat.alpha = 0.95;
  photon.material = pmat;
  photon.isPickable = false;
  photon.applyFog = false;
  pmat.freeze();

  const worldCenter = new Vector3();

  return {
    group,
    horizon,
    disk,
    photon,
    radius,
    spin: 0,
    /** Update world center + slow disk rotation. */
    update(dt) {
      this.spin += dt * 0.12;
      disk.rotation.y = this.spin;
      group.getWorldMatrix().getTranslationToRef(worldCenter);
      this.worldCenter = worldCenter;
    },
    worldCenter,
  };
}

/** Radial accretion-disk texture: white-hot inner edge -> orange -> red, with
 *  swirling streaks and a Doppler-style angular brightness asymmetry. */
function makeDiskTexture(scene, size, bhRadius) {
  const data = new Uint8Array(size * size * 4);
  const innerFrac = 0.34; // inner edge (relative to disc's own radius)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const ang = Math.atan2(dy, dx);
      const i = (y * size + x) * 4;

      if (r < innerFrac || r > 0.998) {
        data[i + 3] = 0;
        continue;
      }
      const t = (r - innerFrac) / (0.998 - innerFrac); // 0 inner .. 1 outer

      // Temperature ramp: hot (blue-white) inside -> orange -> deep red.
      let cr, cg, cb;
      if (t < 0.28) {
        const k = t / 0.28;
        cr = 0.9 + 0.1 * (1 - k);
        cg = 0.92 - 0.2 * k;
        cb = 1.0 - 0.55 * k;
      } else {
        const k = (t - 0.28) / 0.72;
        cr = 1.0;
        cg = 0.72 - 0.5 * k;
        cb = 0.45 - 0.42 * k;
      }

      // Spiral streaks: sample turbulence in polar coords, sheared by radius.
      const swirl = ang * 3 + t * 22;
      const streak = fbm2(Math.cos(swirl) * 2 + t * 8, Math.sin(swirl) * 2, 4);
      let bright = 0.55 + 0.7 * streak;

      // Brightness falls off toward the outer edge.
      bright *= Math.pow(1 - t, 0.6) + 0.15;

      // Doppler beaming: one side brighter (approaching material).
      const doppler = 0.6 + 0.8 * clamp01(Math.cos(ang - 0.6) * 0.5 + 0.5);
      bright *= doppler;

      // Inner rim is extremely hot.
      bright += Math.exp(-Math.pow((t - 0.02) / 0.05, 2)) * 1.3;

      let alpha = clamp01(bright);
      // Soft inner + outer falloff for a clean silhouette.
      alpha *= clamp01(t / 0.05) * clamp01((1 - t) / 0.12);

      data[i] = clamp01(cr * bright) * 255;
      data[i + 1] = clamp01(cg * bright) * 255;
      data[i + 2] = clamp01(cb * bright) * 255;
      data[i + 3] = clamp01(alpha) * 255;
    }
  }
  const tex = new RawTexture(
    data, size, size,
    Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE
  );
  tex.name = 'accretionTex';
  tex.hasAlpha = true;
  return tex;
}
