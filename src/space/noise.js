/**
 * Cheap, dependency-free procedural noise used to bake textures on the CPU at
 * load time. Not used in the render loop. Value noise + fBm, 2D and 3D.
 */

// 256-entry permutation for hashing lattice points.
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Deterministic shuffle (fixed seed) so textures are reproducible.
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
  return a + t * (b - a);
}
function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Perlin-style gradient noise in 3D, range ~[-1,1]. */
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad3(PERM[AA], x, y, z), grad3(PERM[BA], x - 1, y, z), u),
      lerp(grad3(PERM[AB], x, y - 1, z), grad3(PERM[BB], x - 1, y - 1, z), u),
      v
    ),
    lerp(
      lerp(grad3(PERM[AA + 1], x, y, z - 1), grad3(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad3(PERM[AB + 1], x, y - 1, z - 1), grad3(PERM[BB + 1], x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}

/** 2D slice of the 3D noise. */
export function noise2(x, y) {
  return noise3(x, y, 0.5);
}

/** fBm in 3D. */
export function fbm3(x, y, z, octaves = 5, lac = 2.0, gain = 0.5) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq);
    freq *= lac;
    amp *= gain;
  }
  return sum;
}

/** Ridged multifractal — good for wispy nebula filaments. */
export function ridged3(x, y, z, octaves = 5, lac = 2.0, gain = 0.5) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1.0 - Math.abs(noise3(x * freq, y * freq, z * freq));
    n *= n;
    sum += amp * n;
    freq *= lac;
    amp *= gain;
  }
  return sum;
}

export function fbm2(x, y, octaves = 5) {
  return fbm3(x, y, 0.5, octaves);
}

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
