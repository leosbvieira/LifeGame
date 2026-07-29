import { UniversalCamera, Vector3 } from '@babylonjs/core';
import { v3a, v3b, v3c, v3d, damp, lerp, clamp, hash11 } from '../core/scratch.js';

/**
 * Velocity-aware spring-arm chase camera with over-the-shoulder offset.
 * Lags under acceleration, widens FOV under speed, tightens on stop.
 * Manually driven (not attachControl) so we own every easing curve.
 */
export class ChaseCamera {
  /** @param {import('@babylonjs/core').Scene} scene @param {import('./controller.js').ShipController} ship @param {import('../core/input.js').Input} input */
  constructor(scene, ship, input) {
    this.scene = scene;
    this.ship = ship;
    this.input = input;

    this.cam = new UniversalCamera('chase', new Vector3(0, 30, -120), scene);
    this.cam.minZ = 0.35;
    this.cam.maxZ = 60000;
    this.cam.fov = 0.95;
    this.cam.inputs.clear(); // fully manual
    scene.activeCamera = this.cam;

    this.distance = 16;
    this.zoomTarget = 16;
    this.height = 5.2;
    this.shoulder = 2.6; // over-the-shoulder lateral offset

    this.baseFov = 0.95;
    this._pos = this.cam.position.clone();
    this._look = new Vector3();
    this._shake = 0;
    this._t = 0;
  }

  /** Add a burst of camera shake (0..1). Decays over time. */
  addShake(amount) {
    this._shake = Math.min(1, this._shake + amount);
  }

  update(dt) {
    // Capture-only: when frozen, an external harness controls the camera so it
    // can frame things the chase rig can't (e.g. an aerial trail reveal).
    if (this.frozen) return;
    this._t += dt;
    const ship = this.ship;

    // Zoom via wheel, eased.
    this.zoomTarget = clamp(this.zoomTarget + this.input.wheel * 2.2, 9, 40);
    this.distance = damp(this.distance, this.zoomTarget, 8, dt);

    const spd = ship.speed01;

    // Desired camera position: behind + above + shoulder offset, in ship space,
    // but yaw-follow only lightly on pitch so we keep the horizon.
    v3a.copyFrom(ship.forward).scaleInPlace(-this.distance * (1 + spd * 0.25));
    v3b.copyFrom(ship.up).scaleInPlace(this.height);
    v3c.copyFrom(ship.right).scaleInPlace(this.shoulder);
    v3a.addInPlace(v3b).addInPlace(v3c);
    v3a.addInPlace(ship.position);

    // Spring lag: heavier lag while accelerating hard / boosting.
    const lag = lerp(11, 5.5, spd);
    this._pos.x = damp(this._pos.x, v3a.x, lag, dt);
    this._pos.y = damp(this._pos.y, v3a.y, lag, dt);
    this._pos.z = damp(this._pos.z, v3a.z, lag, dt);

    // Look target: ahead of the ship so turns lead the eye.
    v3d.copyFrom(ship.forward).scaleInPlace(6 + spd * 10);
    v3d.addInPlace(ship.position);
    this._look.x = damp(this._look.x, v3d.x, 12, dt);
    this._look.y = damp(this._look.y, v3d.y, 12, dt);
    this._look.z = damp(this._look.z, v3d.z, 12, dt);

    // Camera shake decay + application.
    this._shake = Math.max(0, this._shake - dt * 1.6);
    let sx = 0, sy = 0;
    if (this._shake > 0.001) {
      const a = this._shake * this._shake * 0.6;
      sx = (hash11(this._t * 91.7) - 0.5) * a;
      sy = (hash11(this._t * 57.3 + 12.3) - 0.5) * a;
    }

    this.cam.position.copyFrom(this._pos);
    this.cam.position.x += sx;
    this.cam.position.y += sy;
    this.cam.setTarget(this._look);

    // FOV: widen under speed + boost, tighten on stop. Eased.
    const fovTarget = this.baseFov * (1 + spd * 0.22 + ship.boostAmt * 0.14);
    this.cam.fov = damp(this.cam.fov, fovTarget, 4, dt);
  }
}
