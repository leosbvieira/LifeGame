/* =========================================================================
   THE LONG QUIET — util.js
   Deterministic randomness, math helpers, procedural naming.
   Everything in this game is generated from a single seed. No assets.
   ========================================================================= */
(function (global) {
  'use strict';

  // --- Deterministic PRNG (mulberry32) --------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Hash a string into a 32-bit seed so names/ids can drive generation.
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // A small rng wrapper with the sampling helpers used all over the codebase.
  function Rng(seed) {
    const r = mulberry32(typeof seed === 'string' ? hashStr(seed) : (seed | 0));
    return {
      next: r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => Math.floor(a + (b - a + 1) * r()) ,
      pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
      chance: (p) => r() < p,
      // Gaussian-ish via central limit, cheap and good enough.
      gauss: () => (r() + r() + r() + r() - 2) * 0.8660254,
      sign: () => (r() < 0.5 ? -1 : 1),
      unitVec: () => {
        const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        return { x: s * Math.cos(a), y: s * Math.sin(a), z: z };
      }
    };
  }

  // --- Math -----------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Frame-rate independent exponential approach. `speed` is "per second".
  const damp = (a, b, speed, dt) => lerp(a, b, 1 - Math.exp(-speed * dt));
  const mod = (n, m) => ((n % m) + m) % m;

  function formatDistance(m) {
    if (m < 1000) return m.toFixed(0) + ' m';
    if (m < 1e6) return (m / 1000).toFixed(1) + ' km';
    if (m < 1e9) return (m / 1e6).toFixed(2) + ' Mm';
    return (m / 1e9).toFixed(2) + ' Gm';
  }

  function romanize(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out || 'I';
  }

  // --- Procedural naming ----------------------------------------------------
  // Syllable soup tuned to sound like catalogue entries whispered over a radio.
  const SYL_A = ['ka', 've', 'thu', 'lyr', 'san', 'ori', 'mel', 'cy', 'dra', 'nor',
    'ael', 'zar', 'phe', 'ith', 'vor', 'sol', 'ain', 'kel', 'tor', 'mir',
    'sha', 'ul', 'eri', 'obs', 'yan', 'cal', 'hel', 'nyx', 'pol', 'rha'];
  const SYL_B = ['dara', 'nix', 'thys', 'vane', 'mora', 'lune', 'kaar', 'sien', 'tesh', 'vira',
    'quon', 'baal', 'rion', 'seth', 'ora', 'phos', 'dain', 'yara', 'zeth', 'noma',
    'ceti', 'mund', 'aris', 'weth', 'ulon', 'tara', 'vash', 'esca', 'iren', 'oth'];
  const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Upsilon', 'Omega'];

  function systemName(rng) {
    const base = cap(rng.pick(SYL_A) + rng.pick(SYL_B));
    const roll = rng.next();
    if (roll < 0.22) return rng.pick(GREEK) + ' ' + base;
    if (roll < 0.38) return base + '-' + rng.int(1, 9) + rng.pick(['A', 'B', 'C', 'D', 'E']);
    if (roll < 0.5) return base + ' ' + romanize(rng.int(1, 9));
    return base;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // --- CPU noise (for baking textures once, instead of per-pixel per-frame) --
  function noise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => {
      let n = (a * 374761393 + b * 668265263 + seed * 2147483647) | 0;
      n = (n ^ (n >> 13)) * 1274126177;
      return ((n ^ (n >> 16)) >>> 0) / 4294967296;
    };
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm2(x, y, seed, oct, gain) {
    let amp = 0.5, sum = 0, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(x * f, y * f, seed + i * 977);
      norm += amp; f *= 2.03; amp *= (gain || 0.5);
    }
    return sum / norm;
  }

  // Ridged variant — gives nebulae their filament structure.
  function ridged2(x, y, seed, oct, gain) {
    let amp = 0.5, sum = 0, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(noise2(x * f, y * f, seed + i * 613) * 2 - 1);
      sum += amp * v * v;
      norm += amp; f *= 2.11; amp *= (gain || 0.5);
    }
    return sum / norm;
  }

  // --- Small helpers --------------------------------------------------------
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }

  function el(id) { return document.getElementById(id); }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  global.U = {
    mulberry32, hashStr, Rng, clamp, lerp, smoothstep, damp, mod,
    formatDistance, romanize, systemName, cap, now, el, makeCanvas,
    noise2, fbm2, ridged2
  };
})(window);
