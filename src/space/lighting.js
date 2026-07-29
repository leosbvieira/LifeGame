import {
  DirectionalLight,
  HemisphericLight,
  CascadedShadowGenerator,
  Vector3,
  Color3,
} from '@babylonjs/core';
import { isLite } from '../core/quality.js';

/**
 * Scene lighting. A cool directional key rakes across the gas sea at a low angle
 * for long shadows and crisp trench self-shadowing; a blue-shifted hemispheric
 * fill keeps shadowed gas glowing rather than dead-black. IBL ambient comes from
 * the nebula cube (set on the scene by World).
 *
 * Returns { key, fill, shadow }.
 */
export function buildLighting(scene) {
  const key = new DirectionalLight('key', new Vector3(-0.45, -0.62, 0.38), scene);
  key.position.set(1600, 2400, -1200);
  key.intensity = 2.6;
  key.diffuse = new Color3(0.92, 0.95, 1.0);
  key.specular = new Color3(0.8, 0.9, 1.0);
  key.autoCalcShadowZBounds = true;
  key.shadowMinZ = 1;
  key.shadowMaxZ = 2600;

  const fill = new HemisphericLight('fill2', new Vector3(0.2, 1, -0.1), scene);
  fill.intensity = 0.55;
  fill.diffuse = new Color3(0.35, 0.55, 0.95); // blue-shifted ambient
  fill.groundColor = new Color3(0.28, 0.12, 0.4); // magenta bounce from the gas
  fill.specular = new Color3(0, 0, 0);

  // The luminous gas sea is drawn unlit and self-shadows via a baked N·L term
  // (see floor.js), so a cascaded shadow map has no useful receiver here and is
  // omitted for the frame budget. The key light still shades the PBR ship and
  // asteroids. (Deviation noted in DECISIONS.md.)
  const shadow = null;

  return { key, fill, shadow };
}
