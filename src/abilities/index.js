import {
  ParticleSystem,
  PointLight,
  Vector3,
  Color3,
  Color4,
  RawTexture,
  Texture,
  Constants,
} from '@babylonjs/core';
import { v3a, v3b, v3c, clamp, damp, hash11 } from '../core/scratch.js';

/**
 * Ship systems on keys 1–5. Every one shares the bending grammar: eased in from
 * the gas, momentum-carrying, and every one writes into the deformation field so
 * its mark persists after the effect ends.
 *
 *   1 PULSE       crescent shock ploughs a channel + throws berms
 *   2 TRACTOR     held beam scores a continuous line beneath the aim
 *   3 IMPLODE     targeted eruption: crater + raised rim + glitter fallout
 *   4 CRYSTALLIZE freezes the gas to permanent glossy ice
 *   5 VORTEX      strips a ring of gas around the ship and lets it settle
 *
 * Pools: a fixed set of dynamic lights (budget 5) + reused particle systems.
 * No allocation in update().
 */
export class AbilitySystem {
  constructor(scene, ship, world, input, chase, settings) {
    this.scene = scene;
    this.ship = ship;
    this.world = world;
    this.field = world.field;
    this.input = input;
    this.chase = chase;
    this.settings = settings;

    this.dot = makeSprite(scene, 48, 'soft');
    this.spark = makeSprite(scene, 32, 'spark');

    // --- Dynamic light pool (budget: 5) ---
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new PointLight('abLight' + i, new Vector3(0, -9999, 0), scene);
      l.intensity = 0;
      l.range = 260;
      l.diffuse = new Color3(0.5, 0.8, 1);
      l.specular = new Color3(0.4, 0.7, 1);
      this.lights.push({ light: l, ttl: 0, life: 1, peak: 0, color: new Color3() });
    }

    // --- Particle systems (created once, retriggered) ---
    // Continuous engine ion trail (always on; intensity tracks speed/boost).
    this.psEngine = this._makePS('engineTrail', 1400, this.dot, ParticleSystem.BLENDMODE_ADD);
    this.psEngine.minLifeTime = 0.25;
    this.psEngine.maxLifeTime = 0.8;
    this.psEngine.gravity.set(0, 0, 0);
    this.psEngine.minSize = 1.5;
    this.psEngine.maxSize = 5;
    this.psEngine.preventAutoStart = false;
    this.psEngine.emitRate = 80;
    this.psEngine.start();

    this.psPulse = this._makePS('pulse', 900, this.dot, ParticleSystem.BLENDMODE_ADD);
    this.psTractor = this._makePS('tractor', 700, this.spark, ParticleSystem.BLENDMODE_ADD);
    this.psImplode = this._makePS('implode', 1400, this.dot, ParticleSystem.BLENDMODE_ADD);
    this.psFrost = this._makePS('frost', 900, this.spark, ParticleSystem.BLENDMODE_ADD);
    this.psVortex = this._makePS('vortex', 1200, this.dot, ParticleSystem.BLENDMODE_ADD);

    // Active timed effects (state machines). Fixed small arrays; reused slots.
    this.pulse = { active: false, t: 0, life: 1.2, x: 0, z: 0, dx: 0, dz: 0 };
    this.implode = { active: false, t: 0, life: 1.6, x: 0, z: 0 };
    this.crystal = { active: false, t: 0, life: 1.8, x: 0, z: 0 };
    this.vortex = { active: false, t: 0, life: 2.4, x: 0, z: 0 };

    this._target = new Vector3();
  }

  _makePS(name, cap, tex, blend) {
    const ps = new ParticleSystem(name, cap, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(0, 0, 0);
    ps.minEmitBox = new Vector3(0, 0, 0);
    ps.maxEmitBox = new Vector3(0, 0, 0);
    ps.blendMode = blend;
    ps.gravity = new Vector3(0, -14, 0);
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.4;
    ps.emitRate = 0;
    ps.updateSpeed = 0.016;
    ps.preventAutoStart = true;
    return ps;
  }

  /** Force particle pipelines to compile during the loading screen. */
  warmup() {
    const all = [this.psPulse, this.psTractor, this.psImplode, this.psFrost, this.psVortex];
    for (let i = 0; i < all.length; i++) {
      all[i].manualEmitCount = 1;
      all[i].start();
    }
    for (let i = 0; i < this.lights.length; i++) this.lights[i].light.intensity = 0.001;
  }

  /** Compute the aim point on the gas plane ahead of the ship into this._target. */
  _aim(dist) {
    const s = this.ship;
    this._target.copyFrom(s.forward).scaleInPlace(dist).addInPlace(s.position);
    this._target.y = this.world.floor.baseY;
    return this._target;
  }

  _spawnLight(x, y, z, r, g, b, peak, life, range) {
    // Find the freest light (lowest ttl).
    let best = 0;
    let bestTtl = Infinity;
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lights[i].ttl < bestTtl) {
        bestTtl = this.lights[i].ttl;
        best = i;
      }
    }
    const L = this.lights[best];
    L.light.position.set(x, y, z);
    L.color.set(r, g, b);
    L.light.diffuse.copyFromFloats(r, g, b);
    L.light.specular.copyFromFloats(r, g, b);
    L.light.range = range || 260;
    L.ttl = life;
    L.life = life;
    L.peak = peak;
    return L;
  }

  update(dt) {
    const inp = this.input;
    const field = this.field;
    const ship = this.ship;

    // --- Continuous ship draft: the hull carves the gas sea below it. ---
    // Proximity-scaled: skimming low leaves a deep glowing trench with berms;
    // flying high leaves the sea pristine. This is the core deformable trail.
    const spd = ship.speed01;
    const sx = ship.position.x;
    const sz = ship.position.z;
    const seaY = this.world.floor.baseY + this.world.floor._baseHeight(sx, sz);
    const clearance = ship.position.y - seaY;
    const prox = clamp(1 - clearance / 130, 0, 1);
    const f = dt * 60;

    if (prox > 0.02) {
      const carve = (0.35 + spd * 0.9 + ship.boostAmt * 1.0) * prox;
      const dGlow = (0.4 + spd * 0.9 + ship.boostAmt * 1.0) * prox;
      const dR = 13 + spd * 12 + ship.boostAmt * 14;
      // Main trench along the ship's ground track.
      field.splat(sx, sz, dR, carve * 0.09 * f, 0, dGlow * 0.06 * f, 0);
      // Berms thrown to either side (perpendicular to velocity).
      const vlen = Math.hypot(ship.velocity.x, ship.velocity.z) || 1;
      const pxn = -ship.velocity.z / vlen;
      const pzn = ship.velocity.x / vlen;
      for (let s = -1; s <= 1; s += 2) {
        field.splat(sx + pxn * dR * s, sz + pzn * dR * s, dR * 0.65, 0, carve * 0.13 * f, dGlow * 0.035 * f, 0);
      }
    }

    // --- Engine ion trail: emit from the tail, streaming backward. ---
    const eng = this.psEngine;
    v3a.copyFrom(ship.forward).scaleInPlace(-4);
    v3a.addInPlace(ship.position);
    eng.emitter.copyFrom(v3a);
    // Backward + slight spread, faster under boost.
    const back = 30 + spd * 60 + ship.boostAmt * 120;
    eng.direction1.copyFromFloats(-ship.forward.x * back - 4, -ship.forward.y * back - 2, -ship.forward.z * back - 4);
    eng.direction2.copyFromFloats(-ship.forward.x * back + 4, -ship.forward.y * back + 2, -ship.forward.z * back + 4);
    eng.minEmitPower = back * 0.5;
    eng.maxEmitPower = back;
    eng.emitRate = 60 + spd * 520 + ship.boostAmt * 700;
    // Cool cyan idling -> hot white-blue under boost.
    const bo = ship.boostAmt;
    eng.color1.set(0.3 + bo * 0.5, 0.7 + bo * 0.2, 1.0, 1);
    eng.color2.set(0.5 + bo * 0.4, 0.5 + bo * 0.3, 1.0, 0.9);
    eng.colorDead.set(0.1, 0.2, 0.5, 0);

    // Boost wake glow light under the ship.
    if (ship.boostAmt > 0.05) {
      const L = this._spawnLight(sx, this.world.floor.baseY + 12, sz, 0.3, 0.7, 1.0, ship.boostAmt * 1.4, 0.12, 300);
    }

    // --- Triggers ---
    if (inp.consumePress('Digit1')) this._castPulse();
    if (inp.consumePress('Digit3')) this._castImplode();
    if (inp.consumePress('Digit4')) this._castCrystallize();
    if (inp.consumePress('Digit5')) this._castVortex();
    // Tractor beam is held.
    this._updateTractor(dt, inp.down('Digit2'));

    // --- Update timed effects ---
    this._updatePulse(dt);
    this._updateImplode(dt);
    this._updateCrystal(dt);
    this._updateVortex(dt);

    // --- Light pool decay ---
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      if (L.ttl > 0) {
        L.ttl -= dt;
        const k = clamp(L.ttl / L.life, 0, 1);
        L.light.intensity = L.peak * k * k;
        if (L.ttl <= 0) {
          L.light.intensity = 0;
          L.light.position.y = -9999;
        }
      }
    }
  }

  // ---- 1 · PULSE ------------------------------------------------------------
  _castPulse() {
    const a = this._aim(60);
    const p = this.pulse;
    p.active = true;
    p.t = 0;
    p.x = a.x;
    p.z = a.z;
    p.dx = this.ship.forward.x;
    p.dz = this.ship.forward.z;
    this.psPulse.emitter.copyFromFloats(a.x, this.world.floor.baseY + 8, a.z);
    this.psPulse.direction1.copyFromFloats(p.dx * 40 - 8, 18, p.dz * 40 - 8);
    this.psPulse.direction2.copyFromFloats(p.dx * 60 + 8, 34, p.dz * 60 + 8);
    this.psPulse.color1.set(0.4, 0.8, 1, 1);
    this.psPulse.color2.set(0.7, 0.5, 1, 1);
    this.psPulse.colorDead.set(0.1, 0.2, 0.5, 0);
    this.psPulse.minSize = 5; this.psPulse.maxSize = 16;
    this.psPulse.minEmitPower = 30; this.psPulse.maxEmitPower = 70;
    this.psPulse.manualEmitCount = 420;
    this.psPulse.start();
    this._spawnLight(a.x, this.world.floor.baseY + 20, a.z, 0.4, 0.8, 1.0, 3.2, 0.6, 340);
    this.chase.addShake(0.25);
  }

  _updatePulse(dt) {
    const p = this.pulse;
    if (!p.active) return;
    p.t += dt;
    const k = p.t / p.life;
    if (k >= 1) { p.active = false; return; }
    // The crescent travels forward, ploughing a channel with berms at its rim.
    const speed = 190;
    p.x += p.dx * speed * dt;
    p.z += p.dz * speed * dt;
    const strength = (1 - k);
    this.field.splat(p.x, p.z, 26, 0.5 * strength, 0.7 * strength, 1.2 * strength, 0);
    // Berms to the sides (perpendicular).
    const px = -p.dz, pz = p.dx;
    for (let s = -1; s <= 1; s += 2) {
      this.field.splat(p.x + px * 26 * s, p.z + pz * 26 * s, 16, 0, 0.9 * strength, 0.5 * strength, 0);
    }
  }

  // ---- 2 · TRACTOR (held) ---------------------------------------------------
  _updateTractor(dt, held) {
    const ps = this.psTractor;
    if (held) {
      const a = this._aim(52 + Math.sin(performance.now() * 0.004) * 22);
      ps.emitter.copyFromFloats(a.x, this.world.floor.baseY + 10, a.z);
      ps.direction1.copyFromFloats(0, 26, 0);
      ps.direction2.copyFromFloats(0, 46, 0);
      ps.color1.set(0.5, 1.0, 0.9, 1);
      ps.color2.set(0.3, 0.8, 1.0, 1);
      ps.colorDead.set(0.1, 0.3, 0.4, 0);
      ps.minSize = 2; ps.maxSize = 6;
      ps.minEmitPower = 20; ps.maxEmitPower = 40;
      ps.emitRate = 500;
      if (!ps.isStarted()) ps.start();
      // Score a thin continuous line in the gas.
      this.field.splat(a.x, a.z, 12, 0.35 * dt * 60 * 0.1, 0.25 * dt * 60 * 0.1, 0.8 * dt * 60 * 0.1, 0);
      this._spawnLight(a.x, this.world.floor.baseY + 14, a.z, 0.3, 0.9, 0.8, 1.6, 0.1, 220);
    } else if (ps.isStarted()) {
      ps.emitRate = 0;
      ps.stop();
    }
  }

  // ---- 3 · IMPLODE ----------------------------------------------------------
  _castImplode() {
    const a = this._aim(70);
    const im = this.implode;
    im.active = true; im.t = 0; im.x = a.x; im.z = a.z;
    // Immediate crater + raised rim.
    this.field.splat(a.x, a.z, 46, 1.2, 1.1, 1.6, 0);
    const ps = this.psImplode;
    ps.emitter.copyFromFloats(a.x, this.world.floor.baseY + 6, a.z);
    ps.direction1.copyFromFloats(-10, 70, -10);
    ps.direction2.copyFromFloats(10, 130, 10);
    ps.color1.set(0.8, 0.7, 1.0, 1);
    ps.color2.set(0.5, 0.4, 1.0, 1);
    ps.colorDead.set(0.15, 0.1, 0.4, 0);
    ps.minSize = 4; ps.maxSize = 14;
    ps.minEmitPower = 60; ps.maxEmitPower = 150;
    ps.gravity.set(0, -30, 0);
    ps.minLifeTime = 1.0; ps.maxLifeTime = 2.4;
    ps.manualEmitCount = 900;
    ps.start();
    this._spawnLight(a.x, this.world.floor.baseY + 40, a.z, 0.6, 0.5, 1.0, 5.0, 1.0, 460);
    this.chase.addShake(0.6);
  }

  _updateImplode(dt) {
    const im = this.implode;
    if (!im.active) return;
    im.t += dt;
    if (im.t >= im.life) { im.active = false; return; }
    // Rim keeps settling: berm relaxes slightly inward as fallout lands.
    const k = im.t / im.life;
    this.field.splat(im.x, im.z, 40, 0.1 * (1 - k), 0.3 * (1 - k), 0.4 * (1 - k), 0);
  }

  // ---- 4 · CRYSTALLIZE ------------------------------------------------------
  _castCrystallize() {
    const a = this._aim(56);
    const c = this.crystal;
    c.active = true; c.t = 0; c.x = a.x; c.z = a.z;
    const ps = this.psFrost;
    ps.emitter.copyFromFloats(a.x, this.world.floor.baseY + 10, a.z);
    ps.direction1.copyFromFloats(-18, 6, -18);
    ps.direction2.copyFromFloats(18, 22, 18);
    ps.color1.set(0.7, 0.95, 1.0, 1);
    ps.color2.set(0.85, 0.9, 1.0, 1);
    ps.colorDead.set(0.2, 0.4, 0.6, 0);
    ps.minSize = 1.5; ps.maxSize = 5;
    ps.gravity.set(0, -4, 0);
    ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6;
    ps.minEmitPower = 8; ps.maxEmitPower = 26;
    ps.manualEmitCount = 500;
    ps.start();
    this._spawnLight(a.x, this.world.floor.baseY + 16, a.z, 0.6, 0.85, 1.0, 3.0, 1.4, 300);
  }

  _updateCrystal(dt) {
    const c = this.crystal;
    if (!c.active) return;
    c.t += dt;
    const k = c.t / c.life;
    if (k >= 1) { c.active = false; return; }
    // Ice grows outward from the point, permanently frosting the gas (glossy).
    const radius = 12 + k * 46;
    this.field.splat(c.x, c.z, radius, 0.0, 0.15, 0.4 * (1 - k), 0.9 * (1 - k) * dt * 60 * 0.08 + 0.02);
  }

  // ---- 5 · VORTEX -----------------------------------------------------------
  _castVortex() {
    const v = this.vortex;
    v.active = true; v.t = 0;
    v.x = this.ship.position.x; v.z = this.ship.position.z;
    const ps = this.psVortex;
    ps.emitter.copyFromFloats(v.x, this.world.floor.baseY + 6, v.z);
    ps.minEmitBox.set(-70, 0, -70);
    ps.maxEmitBox.set(70, 8, 70);
    ps.direction1.copyFromFloats(0, 40, 0);
    ps.direction2.copyFromFloats(0, 90, 0);
    ps.color1.set(0.5, 0.7, 1.0, 1);
    ps.color2.set(0.7, 0.5, 1.0, 1);
    ps.colorDead.set(0.1, 0.2, 0.5, 0);
    ps.minSize = 3; ps.maxSize = 9;
    ps.gravity.set(0, -8, 0);
    ps.minLifeTime = 1.4; ps.maxLifeTime = 2.8;
    ps.minEmitPower = 30; ps.maxEmitPower = 70;
    ps.manualEmitCount = 1000;
    ps.start();
    this._spawnLight(v.x, this.world.floor.baseY + 40, v.z, 0.4, 0.6, 1.0, 4.0, 2.0, 420);
    this.chase.addShake(0.5);
  }

  _updateVortex(dt) {
    const v = this.vortex;
    if (!v.active) return;
    v.t += dt;
    const k = v.t / v.life;
    if (k >= 1) { v.active = false; return; }
    // Strip gas from a ring around the center; the ring rises as a glowing berm.
    const ringR = 46 + k * 34;
    const spin = v.t * 6;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      const ang = (i / segs) * Math.PI * 2 + spin;
      const rx = v.x + Math.cos(ang) * ringR;
      const rz = v.z + Math.sin(ang) * ringR;
      this.field.splat(rx, rz, 20, 0.4 * (1 - k), 0.6 * (1 - k), 0.9 * (1 - k), 0);
    }
    // Center thins (gas held aloft) then settles.
    this.field.splat(v.x, v.z, ringR * 0.7, 0.2 * (1 - k), 0, 0.3 * (1 - k), 0);
  }
}

/** Baked particle sprite: 'soft' round or 'spark' star. */
function makeSprite(scene, size, kind) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = Math.max(0, 1 - d);
      if (kind === 'soft') a = a * a * a;
      else {
        // 4-point star: brighten along axes.
        const star = Math.max(0, 1 - Math.min(Math.abs(dx), Math.abs(dy)) * 6);
        a = Math.max(a * a, star * Math.max(0, 1 - d) * 0.9);
      }
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  const tex = new RawTexture(
    data, size, size,
    Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE
  );
  tex.hasAlpha = true;
  return tex;
}
