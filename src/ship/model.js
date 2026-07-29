import {
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  PBRMetallicRoughnessMaterial,
  StandardMaterial,
} from '@babylonjs/core';

/**
 * Procedural exploration ship — a sleek, faceted interceptor. The metallic hull
 * is merged into one draw; a separate emissive "accents" mesh carries the
 * cockpit canopy, wing running-lights and intakes so the craft reads as a
 * finished vehicle rather than a flat silhouette. Detail lives in materials, not
 * triangle count.
 *
 * Returns { hull, mat, glow, glowMat, accents }.
 */
export function buildShip(scene, parent) {
  // ---- Metallic hull (merged) ----
  const parts = [];

  const body = MeshBuilder.CreateCylinder(
    'hull',
    { height: 7.2, diameterTop: 0.35, diameterBottom: 2.4, tessellation: 12 },
    scene
  );
  body.rotation.x = Math.PI / 2;
  body.bakeCurrentTransformIntoVertices();
  parts.push(body);

  const nose = MeshBuilder.CreateCylinder(
    'nose',
    { height: 2.6, diameterTop: 0.02, diameterBottom: 0.35, tessellation: 12 },
    scene
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 4.9;
  nose.bakeCurrentTransformIntoVertices();
  parts.push(nose);

  // Swept delta wings.
  for (let s = -1; s <= 1; s += 2) {
    const wing = MeshBuilder.CreateBox('wing', { width: 5.0, height: 0.18, depth: 2.6 }, scene);
    wing.position.set(s * 2.7, -0.2, -0.9);
    wing.rotation.y = s * 0.32;
    wing.rotation.z = s * -0.12;
    wing.bakeCurrentTransformIntoVertices();
    parts.push(wing);
    // Wing-tip pods.
    const pod = MeshBuilder.CreateCylinder('pod', { height: 2.2, diameter: 0.5, tessellation: 8 }, scene);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 4.7, -0.25, -0.6);
    pod.bakeCurrentTransformIntoVertices();
    parts.push(pod);
  }

  // Dorsal fin.
  const fin = MeshBuilder.CreateBox('fin', { width: 0.16, height: 1.7, depth: 2.2 }, scene);
  fin.position.set(0, 0.9, -2.2);
  fin.bakeCurrentTransformIntoVertices();
  parts.push(fin);

  // Engine ring.
  const ring = MeshBuilder.CreateTorus('ering', { diameter: 2.1, thickness: 0.42, tessellation: 18 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -3.4;
  ring.bakeCurrentTransformIntoVertices();
  parts.push(ring);

  const hull = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  hull.name = 'shipHull';
  hull.parent = parent;
  hull.rotationQuaternion = null;

  const mat = new PBRMetallicRoughnessMaterial('shipMat', scene);
  mat.baseColor = new Color3(0.24, 0.27, 0.34);
  mat.metallic = 0.9;
  mat.roughness = 0.38;
  mat.emissiveColor = new Color3(0.05, 0.09, 0.15);
  hull.material = mat;

  // ---- Emissive accents (merged, unlit) ----
  const acc = [];

  // Cockpit canopy: a stretched half-sphere of glowing "glass".
  const canopy = MeshBuilder.CreateSphere('canopy', { diameter: 1.5, segments: 12, slice: 0.5 }, scene);
  canopy.scaling.set(1.0, 0.55, 1.9);
  canopy.position.set(0, 0.55, 1.7);
  canopy.bakeCurrentTransformIntoVertices();
  acc.push(canopy);

  // Wing leading-edge running lights (thin strips).
  for (let s = -1; s <= 1; s += 2) {
    const strip = MeshBuilder.CreateBox('runlight', { width: 4.2, height: 0.08, depth: 0.16 }, scene);
    strip.position.set(s * 2.7, -0.05, 0.05);
    strip.rotation.y = s * 0.32;
    strip.bakeCurrentTransformIntoVertices();
    acc.push(strip);
  }

  // Belly intake glow.
  const intake = MeshBuilder.CreateBox('intake', { width: 1.2, height: 0.1, depth: 2.4 }, scene);
  intake.position.set(0, -1.05, 0.2);
  intake.bakeCurrentTransformIntoVertices();
  acc.push(intake);

  const accents = Mesh.MergeMeshes(acc, true, true, undefined, false, false);
  accents.name = 'shipAccents';
  accents.parent = parent;
  accents.rotationQuaternion = null;
  const accMat = new StandardMaterial('accentMat', scene);
  accMat.emissiveColor = new Color3(0.3, 0.85, 1.0);
  accMat.disableLighting = true;
  accents.material = accMat;
  accents.isPickable = false;

  // ---- Engine glow disc (additive) ----
  const glow = MeshBuilder.CreateDisc('engineGlow', { radius: 0.6, tessellation: 24 }, scene);
  glow.parent = parent;
  glow.position.set(0, 0, -3.55);
  glow.rotation.y = Math.PI;
  const gmat = new StandardMaterial('glowMat', scene);
  gmat.emissiveColor = new Color3(0.22, 0.5, 0.85);
  gmat.disableLighting = true;
  gmat.alpha = 0.75;
  gmat.alphaMode = 1; // ADD
  glow.material = gmat;
  glow.isPickable = false;

  hull.freezeWorldMatrix();
  accents.freezeWorldMatrix();

  return { hull, mat, glow, glowMat: gmat, accents, accMat };
}
