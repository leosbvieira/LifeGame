import { TransformNode, Quaternion, Vector3 } from '@babylonjs/core';
import { v3a, v3b, v3c, qa, qb, clamp, damp, lerp } from '../core/scratch.js';

/**
 * Arcade space-flight model. The ship is the player.
 *  - Mouse steers heading (yaw + pitch); the hull banks into turns.
 *  - W/S throttle forward / reverse.  A/D add a lateral bank-assist slide.
 *  - SHIFT boost, RMB brake.  Everything eases; nothing snaps.
 *
 * All state lives in fixed fields; update() allocates nothing.
 */
export class ShipController {
  /** @param {import('@babylonjs/core').Scene} scene @param {import('../core/input.js').Input} input @param {object} settings */
  constructor(scene, input, settings) {
    this.scene = scene;
    this.input = input;
    this.settings = settings;

    this.root = new TransformNode('shipRoot', scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.position.set(0, 24, -80);

    // Visual bank node the model parents to, so hull roll doesn't corrupt heading.
    this.bank = new TransformNode('shipBank', scene);
    this.bank.parent = this.root;
    this.bank.rotationQuaternion = Quaternion.Identity();

    this.velocity = new Vector3(0, 0, 0);
    this.forward = new Vector3(0, 0, 1);
    this.up = new Vector3(0, 1, 0);
    this.right = new Vector3(1, 0, 0);

    this.yaw = 0;
    this.pitch = 0;
    this.rollVisual = 0;
    this.throttle = 0;
    this.speed = 0;
    this.boostAmt = 0; // eased 0..1

    this.baseSpeed = 42;
    this.boostMult = 3.4;
    this.mouseSens = 0.0022;

    this._recompute();
  }

  get position() {
    return this.root.position;
  }

  _recompute() {
    // Build orientation from yaw (around world up) then pitch (around local right).
    Quaternion.RotationYawPitchRollToRef(this.yaw, this.pitch, 0, qa);
    this.root.rotationQuaternion.copyFrom(qa);
    // Cache basis vectors.
    this._basis();
  }

  _basis() {
    const q = this.root.rotationQuaternion;
    // forward = q * (0,0,1)
    rotateVec(q, 0, 0, 1, this.forward);
    rotateVec(q, 1, 0, 0, this.right);
    rotateVec(q, 0, 1, 0, this.up);
  }

  update(dt) {
    const inp = this.input;

    // --- Steering from mouse (heading only; hull bank is visual) ---
    const s = this.mouseSens;
    this.yaw += inp.mouseDX * s;
    this.pitch += inp.mouseDY * s;
    this.pitch = clamp(this.pitch, -1.35, 1.35);

    // --- Throttle ---
    let tTarget = 0;
    if (inp.down('KeyW')) tTarget += 1;
    if (inp.down('KeyS')) tTarget -= 0.6;
    this.throttle = damp(this.throttle, tTarget, 6, dt);

    // Lateral bank-assist (A/D): a soft sideways slide + strong visual roll.
    let strafe = 0;
    if (inp.down('KeyA')) strafe -= 1;
    if (inp.down('KeyD')) strafe += 1;

    // --- Boost / brake ---
    const boosting = inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.down('Space');
    const braking = inp.rmb;
    this.boostAmt = damp(this.boostAmt, boosting ? 1 : 0, boosting ? 3.5 : 5, dt);

    this._recompute();

    // --- Velocity integration ---
    const speedMul = this.settings.shipSpeed;
    let target = this.throttle * this.baseSpeed * speedMul;
    target *= 1 + this.boostAmt * (this.boostMult - 1);
    if (braking) target *= 0.15;

    // Desired velocity = forward*target + lateral strafe.
    v3a.copyFrom(this.forward).scaleInPlace(target);
    v3b.copyFrom(this.right).scaleInPlace(strafe * this.baseSpeed * 0.5 * speedMul);
    v3a.addInPlace(v3b);

    // Ease actual velocity toward desired (inertia).
    const accel = braking ? 4.5 : 2.4 + this.boostAmt * 2.0;
    this.velocity.x = damp(this.velocity.x, v3a.x, accel, dt);
    this.velocity.y = damp(this.velocity.y, v3a.y, accel, dt);
    this.velocity.z = damp(this.velocity.z, v3a.z, accel, dt);

    this.root.position.x += this.velocity.x * dt;
    this.root.position.y += this.velocity.y * dt;
    this.root.position.z += this.velocity.z * dt;

    this.speed = this.velocity.length();

    // --- Visual hull bank: roll into yaw-rate + strafe ---
    const yawRate = inp.mouseDX * s;
    const bankTarget = clamp(-yawRate * 26 - strafe * 0.5, -1.1, 1.1);
    this.rollVisual = damp(this.rollVisual, bankTarget, 5, dt);
    // Slight nose pitch bob under acceleration.
    const noseTarget = -this.throttle * 0.05;
    Quaternion.RotationYawPitchRollToRef(0, noseTarget, this.rollVisual, qb);
    this.bank.rotationQuaternion.copyFrom(qb);
  }

  /** Normalized speed 0..1 vs boosted max, for FOV/wind cues. */
  get speed01() {
    const max = this.baseSpeed * this.boostMult * this.settings.shipSpeed;
    return clamp(this.speed / max, 0, 1);
  }
}

/** Rotate unit axis (x,y,z) by quaternion q into out. No allocation. */
function rotateVec(q, x, y, z, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}
