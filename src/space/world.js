import {
  TransformNode,
  Vector3,
  Color3,
  Color4,
  Scene,
  ParticleSystem,
  RawTexture,
  Texture,
  Constants,
} from '@babylonjs/core';
import { buildStarfield } from './starfield.js';
import { buildSkybox } from './skybox.js';
import { buildSaturn } from './saturn.js';
import { buildBlackHole } from './blackhole.js';
import { buildLighting } from './lighting.js';
import { buildAsteroids } from './asteroids.js';
import { GasField } from '../field/gasfield.js';
import { GasFloor } from './floor.js';
import { isLite, isMin, isGL } from '../core/quality.js';

/**
 * Owns every environment system and drives their per-frame update. The ship,
 * camera, abilities and VFX read from here (gas field, black hole, lighting).
 */
export class World {
  constructor(scene, settings, ship) {
    this.scene = scene;
    this.settings = settings;
    this.ship = ship;
    this.skyRoot = new TransformNode('skyRoot', scene);
  }

  async init(setLoad) {
    const scene = this.scene;

    const lite = isLite();

    // Sky background (nebula cube + IBL). Bigger = crisper distant nebula.
    setLoad?.(0.58, 'seeding the void');
    const faceSize = lite ? (isGL() ? 192 : 96) : 512;
    const { skybox, cubeTexture } = buildSkybox(scene, faceSize);
    skybox.parent = null; // infiniteDistance handles centering
    scene.environmentTexture = cubeTexture;
    scene.environmentIntensity = 0.55;
    this.skybox = skybox;

    // Stars.
    setLoad?.(0.62, 'igniting stars');
    const starMeshes = await buildStarfield(scene);
    for (let i = 0; i < starMeshes.length; i++) starMeshes[i].parent = this.skyRoot;
    this.starMeshes = starMeshes;

    // Distant bodies.
    setLoad?.(0.68, 'placing Saturn');
    this.saturn = buildSaturn(scene, { position: new Vector3(4200, 3200, 8600), radius: 940 });

    setLoad?.(0.72, 'collapsing a singularity');
    this.blackHole = buildBlackHole(scene, { position: new Vector3(-4600, 2900, 7800), radius: 760 });

    // Lighting + shadows.
    setLoad?.(0.76, 'raking starlight');
    this.lighting = buildLighting(scene);

    const min = isMin();

    // Deformable gas sea.
    if (!min) {
      setLoad?.(0.8, 'condensing the gas sea');
      this.field = new GasField(1400, 256);
      this.floor = new GasFloor(scene, this.field, this.settings);
      if (this.lighting.shadow) {
        this.floor.base.receiveShadows = true;
        this.lighting.shadow.addShadowCaster(this.floor.base);
      }

      // Asteroids.
      this.asteroids = buildAsteroids(scene, lite ? 60 : 220);

      // Spindrift / dust.
      this._buildDust();
    }

    // Fog for aerial perspective over the sea.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.03, 0.05, 0.11);
    scene.fogDensity = 0.00035;

    setLoad?.(0.84, 'systems nominal');
  }

  /** Register the ship hull as a shadow caster once it exists. */
  registerShip(hull) {
    if (hull && this.lighting.shadow) {
      this.lighting.shadow.addShadowCaster(hull);
    }
  }

  _buildDust() {
    const scene = this.scene;
    const ps = new ParticleSystem('spindrift', 900, scene);
    ps.particleTexture = makeDustTexture(scene);
    ps.emitter = new Vector3(0, 40, 0);
    ps.minEmitBox = new Vector3(-600, -30, -600);
    ps.maxEmitBox = new Vector3(600, 120, 600);
    ps.color1 = new Color4(0.5, 0.75, 1.0, 0.5);
    ps.color2 = new Color4(0.8, 0.6, 1.0, 0.4);
    ps.colorDead = new Color4(0.2, 0.3, 0.6, 0);
    ps.minSize = 1.2;
    ps.maxSize = 5.0;
    ps.minLifeTime = 3.0;
    ps.maxLifeTime = 7.0;
    ps.emitRate = 220;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, 0, 0);
    ps.direction1 = new Vector3(-14, 0, -3);
    ps.direction2 = new Vector3(-22, 2, 3);
    ps.minEmitPower = 6;
    ps.maxEmitPower = 16;
    ps.updateSpeed = 0.02;
    ps.start();
    this.dust = ps;
  }

  update(dt, chase) {
    const cam = chase.cam;
    // Keep the sky centered on the camera (infinite-distance stars).
    this.skyRoot.position.copyFrom(cam.position);

    this.blackHole.update(dt);

    // Apply sky visibility toggle.
    this.skybox.setEnabled(this.settings.nebula);

    if (!this.field) return; // min mode: environment only

    // Deformable field follows the ship.
    const sp = this.ship.position;
    this.field.update(dt, sp, this.settings);
    this.floor.update(dt, sp);

    if (this.settings.asteroids) this.asteroids.update(dt);

    // Dust follows the ship so spindrift is always around the player.
    this.dust.emitter.copyFromFloats(sp.x, this.floor.baseY + 40, sp.z);

    // Apply visibility toggles.
    this.floor.glow.setEnabled(this.settings.trail);
    this.asteroids.root.setEnabled(this.settings.asteroids);
    this.dust.emitRate = this.settings.dust ? 220 : 0;

    // Live scene tuning from overlay.
    if (this.scene.imageProcessingConfiguration) {
      this.scene.imageProcessingConfiguration.exposure = this.settings.exposure;
    }
  }
}

/** Soft round dust sprite baked on the CPU. */
function makeDustTexture(scene, size = 32) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - d);
      const soft = a * a;
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = soft * 255;
    }
  }
  const tex = new RawTexture(
    data, size, size,
    Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE
  );
  tex.hasAlpha = true;
  return tex;
}
