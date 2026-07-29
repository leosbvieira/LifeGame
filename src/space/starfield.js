import { PointsCloudSystem, Color4, Color3 } from '@babylonjs/core';
import { hash11 } from '../core/scratch.js';

/**
 * Procedural starfield as three PointsCloudSystem layers (dim / mid / bright)
 * so we get size variety without a custom shader. Stars sit on a large shell and
 * parent to the sky root so they read as infinitely distant.
 *
 * Returns an array of meshes to parent to the sky root.
 */
export async function buildStarfield(scene, radius = 42000) {
  const layers = [
    { count: 5200, size: 1.4, bright: 0.35 },
    { count: 1500, size: 2.6, bright: 0.7 },
    { count: 320, size: 4.4, bright: 1.0 },
  ];
  const meshes = [];
  let seed = 7.13;

  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const pcs = new PointsCloudSystem(`stars${li}`, L.size, scene);
    pcs.addPoints(L.count, (p, i) => {
      // Uniform points on a sphere.
      const u = hash11((seed += 1.7));
      const v = hash11((seed += 2.3));
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * (0.9 + 0.1 * hash11((seed += 0.9)));
      const sp = Math.sin(phi);
      p.position.set(r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta));

      // Star colour: mostly blue-white, a few warm/red giants.
      const t = hash11((seed += 3.1));
      const warm = hash11((seed += 1.1)) > 0.86;
      const b = L.bright * (0.55 + 0.45 * hash11((seed += 0.7)));
      if (warm) {
        p.color = new Color4(b * 1.0, b * (0.6 + 0.2 * t), b * 0.45, 1);
      } else {
        p.color = new Color4(b * (0.7 + 0.25 * t), b * (0.82 + 0.15 * t), b * 1.0, 1);
      }
    });
    const mesh = await pcs.buildMeshAsync();
    mesh.name = `starLayer${li}`;
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.material.pointSize = L.size;
    mesh.material.disableLighting = true;
    if (mesh.material.emissiveColor) mesh.material.emissiveColor = new Color3(1, 1, 1);
    mesh.material.pointsCloud = true;
    meshes.push(mesh);
  }
  return meshes;
}
