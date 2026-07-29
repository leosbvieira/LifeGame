/**
 * Persistent, player-following deformation field for the luminous gas sea.
 * This is the space analogue of SNOWFLOW's snow buffer: everything writes here
 * (ship draft, boost wake, every ability), the floor mesh reads it for
 * displacement + glow, and it slowly heals via diffusion/decay.
 *
 * Toroidally scrolled so it follows the ship without ever being rebuilt from an
 * event list. Channels:
 *   depth  — how far the gas is pushed down (trenches)
 *   berm   — displaced mass thrown to trail edges (raised glowing ridges)
 *   glow   — freshly disturbed gas is hot and luminous (decays fastest)
 *   ice    — crystallized / frozen gas (near-permanent, glossy)
 *
 * CPU sim: fixed typed arrays, indexed loops, zero per-frame allocation.
 */
export class GasField {
  constructor(worldSize = 1400, N = 256) {
    this.N = N;
    this.worldSize = worldSize;
    this.texel = worldSize / N;

    const n2 = N * N;
    this.depth = new Float32Array(n2);
    this.berm = new Float32Array(n2);
    this.glow = new Float32Array(n2);
    this.ice = new Float32Array(n2);
    this._tmp = new Float32Array(n2); // diffusion scratch

    // Global texel index of the window's lower corner.
    this.gx0 = 0;
    this.gz0 = 0;
    this._first = true;

    // World-space center of the field (follows ship).
    this.centerX = 0;
    this.centerZ = 0;

    this.settings = null;
  }

  /** Wrap a global texel index to a physical array index. */
  _wrap(g) {
    const N = this.N;
    return ((g % N) + N) % N;
  }

  /** Clear one physical column (all z) across channels. */
  _clearCol(px) {
    const N = this.N;
    for (let z = 0; z < N; z++) {
      const i = z * N + px;
      this.depth[i] = 0;
      this.berm[i] = 0;
      this.glow[i] = 0;
      this.ice[i] = 0;
    }
  }

  _clearRow(pz) {
    const N = this.N;
    const base = pz * N;
    for (let x = 0; x < N; x++) {
      const i = base + x;
      this.depth[i] = 0;
      this.berm[i] = 0;
      this.glow[i] = 0;
      this.ice[i] = 0;
    }
  }

  /** Recenter the toroidal window on a world position, clearing newly exposed strips. */
  recenter(wx, wz) {
    const N = this.N;
    const t = this.texel;
    const newGx0 = Math.floor(wx / t) - (N >> 1);
    const newGz0 = Math.floor(wz / t) - (N >> 1);
    this.centerX = wx;
    this.centerZ = wz;

    if (this._first) {
      this.gx0 = newGx0;
      this.gz0 = newGz0;
      this._first = false;
      return;
    }

    let dx = newGx0 - this.gx0;
    let dz = newGz0 - this.gz0;

    if (Math.abs(dx) >= N || Math.abs(dz) >= N) {
      // Teleport: wipe everything.
      this.depth.fill(0); this.berm.fill(0); this.glow.fill(0); this.ice.fill(0);
      this.gx0 = newGx0; this.gz0 = newGz0;
      return;
    }

    // Clear columns that scrolled in on the x axis.
    if (dx > 0) {
      for (let g = this.gx0 + N; g < newGx0 + N; g++) this._clearCol(this._wrap(g));
    } else if (dx < 0) {
      for (let g = newGx0; g < this.gx0; g++) this._clearCol(this._wrap(g));
    }
    // Clear rows that scrolled in on the z axis.
    if (dz > 0) {
      for (let g = this.gz0 + N; g < newGz0 + N; g++) this._clearRow(this._wrap(g));
    } else if (dz < 0) {
      for (let g = newGz0; g < this.gz0; g++) this._clearRow(this._wrap(g));
    }

    this.gx0 = newGx0;
    this.gz0 = newGz0;
  }

  /** Physical array index for a world position, or -1 if outside the window. */
  worldIndex(wx, wz) {
    const N = this.N;
    const t = this.texel;
    const gx = Math.floor(wx / t);
    const gz = Math.floor(wz / t);
    if (gx < this.gx0 || gx >= this.gx0 + N || gz < this.gz0 || gz >= this.gz0 + N) return -1;
    return this._wrap(gz) * N + this._wrap(gx);
  }

  /**
   * Additive brush splat in world space.
   * @param {number} wx @param {number} wz world position
   * @param {number} radius world units
   * @param {number} d depth add @param {number} b berm add
   * @param {number} g glow add @param {number} ic ice add
   */
  splat(wx, wz, radius, d, b, g, ic) {
    const N = this.N;
    const t = this.texel;
    const rTex = Math.max(1, radius / t);
    const cgx = Math.floor(wx / t);
    const cgz = Math.floor(wz / t);
    const r = Math.ceil(rTex);
    const inv = 1 / (rTex * rTex);
    for (let oz = -r; oz <= r; oz++) {
      const gz = cgz + oz;
      if (gz < this.gz0 || gz >= this.gz0 + N) continue;
      const pz = this._wrap(gz);
      for (let ox = -r; ox <= r; ox++) {
        const gx = cgx + ox;
        if (gx < this.gx0 || gx >= this.gx0 + N) continue;
        const d2 = (ox * ox + oz * oz) * inv;
        if (d2 > 1) continue;
        const fall = 1 - d2;
        const soft = fall * fall;
        const i = pz * N + this._wrap(gx);
        if (d) this.depth[i] = Math.min(1.5, this.depth[i] + d * soft);
        // Berm forms at the rim of the brush (annulus), not the center.
        if (b) {
          const rim = Math.max(0, 1 - Math.abs(Math.sqrt(d2) - 0.75) * 4);
          this.berm[i] = Math.min(1.2, this.berm[i] + b * rim);
        }
        if (g) this.glow[i] = Math.min(2.0, this.glow[i] + g * soft);
        if (ic) this.ice[i] = Math.min(1.0, this.ice[i] + ic * soft);
      }
    }
  }

  /** Diffuse + decay pass. dt seconds. refillMul from settings (higher = faster heal). */
  step(dt, refillMul) {
    const N = this.N;
    const depth = this.depth, berm = this.berm, glow = this.glow, ice = this.ice;
    const tmp = this._tmp;

    // Glow cools quickly.
    const glowDecay = Math.exp(-dt * 1.6);
    // Depth/berm heal slowly (visible after ~60s at default).
    const healDecay = Math.exp(-dt * 0.09 * refillMul);
    // Ice is near-permanent.
    const iceDecay = Math.exp(-dt * 0.01);
    // Diffusion strength (spatial smoothing = trails softening).
    const diff = Math.min(0.35, dt * 1.2 * refillMul);

    // Diffuse depth into tmp (5-tap), then blend + decay in place.
    for (let z = 0; z < N; z++) {
      const zm = ((z - 1 + N) % N) * N;
      const zp = ((z + 1) % N) * N;
      const zc = z * N;
      for (let x = 0; x < N; x++) {
        const xm = (x - 1 + N) % N;
        const xp = (x + 1) % N;
        const i = zc + x;
        const avg = (depth[zc + xm] + depth[zc + xp] + depth[zm + x] + depth[zp + x]) * 0.25;
        tmp[i] = avg;
      }
    }
    for (let i = 0; i < depth.length; i++) {
      depth[i] = (depth[i] + (tmp[i] - depth[i]) * diff) * healDecay;
      // Berms collapse into the depression over time and heal.
      berm[i] = berm[i] * healDecay * (1 - diff * 0.5);
      glow[i] *= glowDecay;
      ice[i] *= iceDecay;
    }
  }

  update(dt, shipPos, settings) {
    this.settings = settings;
    this.recenter(shipPos.x, shipPos.z);
    this.step(dt, settings ? settings.refill : 1);
  }
}
