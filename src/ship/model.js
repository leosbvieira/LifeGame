import {
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  PBRMetallicRoughnessMaterial,
  StandardMaterial,
  VertexBuffer,
} from '@babylonjs/core';

/**
 * Procedural exploration ship — a sleek, faceted interceptor. Built from a few
 * primitives merged into one mesh so it draws in a single call. Detail lives in
 * the material (emissive trim, metal hull) rather than geometry count.
 *
 * Returns { root, engineGlow } where root parents to the ship's bank node.
 */
export function buildShip(scene, parent) {
  const parts = [];

  // Fuselage: a stretched, tapered hull (cylinder w/ few sides -> faceted dart).
  const body = MeshBuilder.CreateCylinder(
    'hull',
    { height: 7.2, diameterTop: 0.35, diameterBottom: 2.4, tessellation: 10 },
    scene
  );
  body.rotation.x = Math.PI / 2; // point +Z
  body.bakeCurrentTransformIntoVertices();
  parts.push(body);

  // Nose cone.
  const nose = MeshBuilder.CreateCylinder(
    'nose',
    { height: 2.4, diameterTop: 0.02, diameterBottom: 0.35, tessellation: 10 },
    scene
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 4.8;
  nose.bakeCurrentTransformIntoVertices();
  parts.push(nose);

  // Wings: two thin swept deltas.
  for (let s = -1; s <= 1; s += 2) {
    const wing = MeshBuilder.CreateBox('wing', { width: 5.0, height: 0.18, depth: 2.6 }, scene);
    wing.position.set(s * 2.7, -0.2, -0.9);
    wing.rotation.y = s * 0.32;
    wing.rotation.z = s * -0.12;
    wing.bakeCurrentTransformIntoVertices();
    parts.push(wing);
  }

  // Dorsal fin.
  const fin = MeshBuilder.CreateBox('fin', { width: 0.16, height: 1.7, depth: 2.2 }, scene);
  fin.position.set(0, 0.9, -2.2);
  fin.bakeCurrentTransformIntoVertices();
  parts.push(fin);

  // Engine ring (torus) at the tail.
  const ring = MeshBuilder.CreateTorus('ering', { diameter: 2.1, thickness: 0.42, tessellation: 16 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -3.4;
  ring.bakeCurrentTransformIntoVertices();
  parts.push(ring);

  const hull = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  hull.name = 'shipHull';
  hull.parent = parent;
  hull.rotationQuaternion = null;

  const mat = new PBRMetallicRoughnessMaterial('shipMat', scene);
  mat.baseColor = new Color3(0.14, 0.16, 0.22);
  mat.metallic = 1.0;
  mat.roughness = 0.34;
  mat.emissiveColor = new Color3(0.02, 0.05, 0.09);
  hull.material = mat;

  // Engine glow disc — an emissive plane at the tail, additive.
  const glow = MeshBuilder.CreateDisc('engineGlow', { radius: 0.95, tessellation: 24 }, scene);
  glow.parent = parent;
  glow.position.set(0, 0, -3.55);
  glow.rotation.y = Math.PI;
  const gmat = new StandardMaterial('glowMat', scene);
  gmat.emissiveColor = new Color3(0.35, 0.75, 1.0);
  gmat.disableLighting = true;
  gmat.alpha = 0.9;
  gmat.alphaMode = 1; // ADD
  glow.material = gmat;
  glow.isPickable = false;

  hull.freezeWorldMatrix();

  return { hull, mat, glow, glowMat: gmat };
}
