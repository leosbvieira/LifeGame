/* =========================================================================
   THE LONG QUIET — space.js
   The backdrop: forty thousand stars, the band of the galaxy seen edge-on,
   nebula sheets, and the near dust that tells you you are moving at all.
   ========================================================================= */
(function (global) {
  'use strict';

  const SKY_RADIUS = 900000;

  // Blackbody-ish star colours from a temperature parameter 0..1.
  function starColor(t) {
    // t=0 deep red dwarf, t=1 blue giant
    const r = U.clamp(1.35 - t * 0.75, 0, 1);
    const g = U.clamp(0.55 + t * 0.42 - Math.pow(t - 0.5, 2) * 0.6, 0, 1);
    const b = U.clamp(0.35 + t * 0.85, 0, 1);
    return [r, g, b];
  }

  // --- Fixed starfield ------------------------------------------------------
  function createStarfield(seed) {
    const rng = U.Rng(seed + 'stars');
    const COUNT = 26000;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const siz = new Float32Array(COUNT);
    const pha = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      // Two populations: a uniform halo and a dense band (the galactic plane).
      let v;
      if (i < COUNT * 0.55) {
        v = rng.unitVec();
        v.y *= 0.13 + rng.range(0, 0.1);   // flatten into the disk
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        v.x /= l; v.y /= l; v.z /= l;
      } else {
        v = rng.unitVec();
      }
      const r = SKY_RADIUS * rng.range(0.85, 1.0);
      pos[i * 3] = v.x * r; pos[i * 3 + 1] = v.y * r; pos[i * 3 + 2] = v.z * r;

      const t = Math.pow(rng.next(), 1.8);
      const c = starColor(t);
      const bright = Math.pow(rng.next(), 2.6) * 0.9 + 0.12;
      col[i * 3] = c[0] * bright; col[i * 3 + 1] = c[1] * bright; col[i * 3 + 2] = c[2] * bright;
      // Most stars are a single sharp pixel; a rare few are worth looking at.
      siz[i] = 0.9 + Math.pow(rng.next(), 8) * 4.4 * (0.5 + bright);
      pha[i] = rng.range(0, Math.PI * 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uBoost: { value: 1 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime; uniform float uPixelRatio; uniform float uBoost;
        varying vec3 vColor; varying float vTw;
        void main(){
          vColor = aColor;
          // Scintillation — very slow, never synchronised.
          vTw = 0.78 + 0.22 * sin(uTime * 0.9 + aPhase) * sin(uTime * 0.31 + aPhase * 2.1);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * uBoost;
        }
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vTw;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          // Tight core, faint halo — a point source, not a smudge.
          float a = exp(-r * 7.0) + exp(-r * 1.6) * 0.12;
          float flare = max(0.0, 1.0 - abs(p.x) * 9.0) * max(0.0, 1.0 - abs(p.y) * 2.0)
                      + max(0.0, 1.0 - abs(p.y) * 9.0) * max(0.0, 1.0 - abs(p.x) * 2.0);
          a += flare * 0.08;
          gl_FragColor = vec4(vColor * vTw * (1.0 + flare * 0.4), a * vTw);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -100;
    return pts;
  }

  // --- Baked nebula textures -----------------------------------------------
  // Running eleven octaves of noise per pixel per frame across dozens of
  // overlapping billboards is not worth it: nebulae do not move. Paint a
  // handful of masks once, tint them per instance, reuse forever.
  const NEB_CACHE = [];
  const NEB_VARIANTS = 6;
  const NEB_SIZE = 224;

  function nebulaTexture(variant) {
    if (NEB_CACHE[variant]) return NEB_CACHE[variant];
    const c = U.makeCanvas(NEB_SIZE, NEB_SIZE);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(NEB_SIZE, NEB_SIZE);
    const d = img.data;
    const seed = 1000 + variant * 7919;
    const scale = 3.4 + variant * 0.6;
    for (let y = 0; y < NEB_SIZE; y++) {
      for (let x = 0; x < NEB_SIZE; x++) {
        const u = (x / NEB_SIZE) * 2 - 1, v = (y / NEB_SIZE) * 2 - 1;
        const r = Math.sqrt(u * u + v * v);
        let a = 0;
        let fil = 0;
        if (r < 1) {
          const f = U.fbm2(u * scale + 8, v * scale + 8, seed, 5, 0.55);
          fil = U.ridged2(u * scale * 1.7 + 3, v * scale * 1.7 + 3, seed + 31, 4, 0.5);
          let dens = f * 0.7 + fil * 0.75;
          dens *= Math.pow(1 - r, 1.7);
          a = U.smoothstep(0.12, 0.72, dens);
        }
        const i = (y * NEB_SIZE + x) * 4;
        // Red channel carries the filament mask so the shader-free material
        // can still mix two colours; alpha carries density.
        d[i] = Math.round(U.clamp(fil, 0, 1) * 255);
        d[i + 1] = Math.round(U.clamp(a, 0, 1) * 255);
        d[i + 2] = Math.round(Math.pow(U.clamp(a, 0, 1), 3) * 255);
        d[i + 3] = Math.round(U.clamp(a, 0, 1) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    NEB_CACHE[variant] = tex;
    return tex;
  }

  // Tinting shader: cheap, two colours mixed by the baked filament mask.
  function nebulaMaterial(texture, colA, colB, density) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uColorA: { value: new THREE.Vector3(colA.r, colA.g, colA.b) },
        uColorB: { value: new THREE.Vector3(colB.r, colB.g, colB.b) },
        uDensity: { value: density }
      },
      vertexShader: SH.glowVert,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D uMap; uniform vec3 uColorA; uniform vec3 uColorB; uniform float uDensity;
        varying vec2 vUv;
        void main(){
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * uDensity;
          if (a < 0.004) discard;
          vec3 col = mix(uColorA, uColorB, clamp(t.r * 1.35, 0.0, 1.0));
          col += uColorB * t.b * 0.8;
          gl_FragColor = vec4(col * a, a);
        }
      `,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
  }

  // --- Galactic band: faint dust lanes across the sky ------------------------
  function createGalacticBand(seed) {
    const rng = U.Rng(seed + 'band');
    const group = new THREE.Group();
    const COUNT = 18;
    for (let i = 0; i < COUNT; i++) {
      const ang = (i / COUNT) * Math.PI * 2 + rng.gauss() * 0.1;
      const size = SKY_RADIUS * rng.range(0.5, 0.95);
      const hue = 0.58 + rng.gauss() * 0.09;
      const a = new THREE.Color().setHSL(U.mod(hue, 1), 0.55, 0.13);
      const b = new THREE.Color().setHSL(U.mod(hue + 0.12, 1), 0.65, 0.26);
      const mat = nebulaMaterial(nebulaTexture(i % NEB_VARIANTS), a, b, rng.range(0.3, 0.62));
      mat.depthTest = false;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * rng.range(0.3, 0.55)), mat);
      m.position.set(
        Math.cos(ang) * SKY_RADIUS * 0.8,
        rng.gauss() * SKY_RADIUS * 0.05,
        Math.sin(ang) * SKY_RADIUS * 0.8
      );
      m.lookAt(0, 0, 0);
      m.rotation.z = rng.gauss() * 0.25;
      m.renderOrder = -99;
      group.add(m);
    }
    group.frustumCulled = false;
    return group;
  }

  // Curated two-colour schemes. Free-running hue drifts into acid green,
  // which no nebula has ever been accused of.
  const NEB_PALETTES = [
    [0.62, 0.52],   // deep blue -> cyan
    [0.92, 0.06],   // magenta -> ember
    [0.55, 0.78],   // teal -> violet
    [0.03, 0.10],   // crimson -> gold
    [0.72, 0.88],   // indigo -> rose
    [0.50, 0.60]    // seafoam -> steel
  ];

  // --- Local nebula sheets (per-system flavour) -----------------------------
  function createNebula(seed, hue, count, radius, density) {
    const rng = U.Rng(seed + 'neb');
    const group = new THREE.Group();
    const pal = NEB_PALETTES[Math.floor(hue * NEB_PALETTES.length) % NEB_PALETTES.length];
    for (let i = 0; i < count; i++) {
      const h = U.mod(pal[0] + rng.gauss() * 0.03, 1);
      const a = new THREE.Color().setHSL(h, 0.72, 0.17);
      const b = new THREE.Color().setHSL(U.mod(pal[1] + rng.gauss() * 0.03, 1), 0.85, 0.44);
      const size = radius * rng.range(0.6, 1.8);
      const mat = nebulaMaterial(
        nebulaTexture(rng.int(0, NEB_VARIANTS - 1)), a, b, density * rng.range(0.6, 1.2));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      const v = rng.unitVec();
      const d = radius * rng.range(0.8, 2.4);
      m.position.set(v.x * d, v.y * d * 0.5, v.z * d);
      m.userData.billboard = true;
      group.add(m);
    }
    return group;
  }

  // --- Near dust: the only thing that proves you are moving -----------------
  function createDust() {
    const COUNT = 1400;
    const BOX = 900;
    const pos = new Float32Array(COUNT * 3);
    const rnd = new Float32Array(COUNT);
    const rng = U.Rng('dust');
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = rng.range(-BOX, BOX);
      pos[i * 3 + 1] = rng.range(-BOX, BOX);
      pos[i * 3 + 2] = rng.range(-BOX, BOX);
      rnd[i] = rng.range(0.3, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uVel: { value: new THREE.Vector3() },
        uSpeed: { value: 0 },
        uPixelRatio: { value: 1 },
        uTint: { value: new THREE.Vector3(0.7, 0.78, 0.95) }
      },
      vertexShader: `
        attribute float aRnd;
        uniform vec3 uVel; uniform float uSpeed; uniform float uPixelRatio;
        varying float vA; varying float vStreak;
        void main(){
          vec3 p = position;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          vA = aRnd * smoothstep(900.0, 120.0, d) * 0.55;
          vStreak = clamp(uSpeed / 900.0, 0.0, 1.0);
          gl_PointSize = (1.0 + vStreak * 3.0) * aRnd * 2.2 * uPixelRatio;
        }
      `,
      fragmentShader: `
        uniform vec3 uTint;
        varying float vA; varying float vStreak;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          float a = exp(-r * 2.4) * vA * (0.35 + vStreak);
          gl_FragColor = vec4(uTint * a, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.BOX = BOX;
    return pts;
  }

  // Keep the dust field centred on the ship, wrapping particles as they exit.
  function updateDust(dust, shipPos) {
    const BOX = dust.userData.BOX;
    const arr = dust.geometry.attributes.position.array;
    const ox = shipPos.x, oy = shipPos.y, oz = shipPos.z;
    let dirty = false;
    for (let i = 0; i < arr.length; i += 3) {
      // Wrap into the [-BOX, BOX] cube around the ship.
      let dx = arr[i] - ox, dy = arr[i + 1] - oy, dz = arr[i + 2] - oz;
      if (dx > BOX) { arr[i] -= BOX * 2; dirty = true; } else if (dx < -BOX) { arr[i] += BOX * 2; dirty = true; }
      if (dy > BOX) { arr[i + 1] -= BOX * 2; dirty = true; } else if (dy < -BOX) { arr[i + 1] += BOX * 2; dirty = true; }
      if (dz > BOX) { arr[i + 2] -= BOX * 2; dirty = true; } else if (dz < -BOX) { arr[i + 2] += BOX * 2; dirty = true; }
    }
    if (dirty) dust.geometry.attributes.position.needsUpdate = true;
  }

  // Reseed the dust cube when the player teleports across a system.
  function recentreDust(dust, shipPos) {
    const BOX = dust.userData.BOX;
    const arr = dust.geometry.attributes.position.array;
    const rng = U.Rng('recentre' + Math.floor(shipPos.x));
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = shipPos.x + rng.range(-BOX, BOX);
      arr[i + 1] = shipPos.y + rng.range(-BOX, BOX);
      arr[i + 2] = shipPos.z + rng.range(-BOX, BOX);
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }

  // --- Hyperspace tunnel ----------------------------------------------------
  function createWarpStreaks() {
    const COUNT = 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 6);   // line segments
    const rng = U.Rng('warp');
    for (let i = 0; i < COUNT; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.pow(rng.next(), 0.6) * 260 + 12;
      const z = rng.range(-1400, 400);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z + 40;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fd0ff, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.userData.count = COUNT;
    lines.visible = false;
    return lines;
  }

  function updateWarpStreaks(lines, dt, intensity) {
    const arr = lines.geometry.attributes.position.array;
    const speed = 2600 * intensity;
    const stretch = 40 + 620 * intensity;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 2] += speed * dt;
      arr[i + 5] = arr[i + 2] + stretch;
      if (arr[i + 2] > 420) {
        arr[i + 2] -= 1800;
        arr[i + 5] = arr[i + 2] + stretch;
      }
    }
    lines.geometry.attributes.position.needsUpdate = true;
    lines.material.opacity = intensity * 0.85;
    lines.visible = intensity > 0.01;
  }

  global.SPACE = {
    createStarfield, createGalacticBand, createNebula, createDust,
    updateDust, recentreDust, createWarpStreaks, updateWarpStreaks,
    starColor, SKY_RADIUS
  };
})(window);
