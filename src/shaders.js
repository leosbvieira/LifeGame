/* =========================================================================
   THE LONG QUIET — shaders.js
   Every surface in this game is math. No textures are loaded from disk;
   the few that exist are painted at runtime into a canvas.
   ========================================================================= */
(function (global) {
  'use strict';

  // --- Shared GLSL: value/simplex noise + fbm -------------------------------
  const NOISE = `
    vec3 hash33(vec3 p){
      p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
               dot(p, vec3(269.5, 183.3, 246.1)),
               dot(p, vec3(113.5, 271.9, 124.6)));
      return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
    }
    float snoise(vec3 p){
      vec3 i = floor(p); vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                         dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                     mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                         dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                 mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                         dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                     mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                         dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
    }
    float fbm(vec3 p, int oct, float lac, float gain){
      float a = 0.5, s = 0.0, n = 0.0;
      for (int i = 0; i < 8; i++){
        if (i >= oct) break;
        s += a * snoise(p); n += a; p *= lac; a *= gain;
      }
      return s / max(n, 0.0001);
    }
    // Ridged variant — mountain chains, filament structure in nebulae.
    float ridged(vec3 p, int oct, float lac, float gain){
      float a = 0.5, s = 0.0, n = 0.0;
      for (int i = 0; i < 8; i++){
        if (i >= oct) break;
        float v = 1.0 - abs(snoise(p));
        v *= v;
        s += a * v; n += a; p *= lac; a *= gain;
      }
      return s / max(n, 0.0001);
    }
  `;

  // =========================================================================
  // PLANET
  // Terrain + water + ice caps + clouds + terminator, all in one pass.
  // uPalette carries four biome colours picked per-planet on the CPU side.
  // =========================================================================
  const planetVert = `
    varying vec3 vPos;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main(){
      vPos = position;
      // World space, not view space: the lighting maths below works in world
      // coordinates (uSunDir, cameraPosition), so normalMatrix is wrong here.
      vNormal = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const planetFrag = `
    precision highp float;
    ${NOISE}
    uniform vec3 uSunDir;        // world-space direction to the star
    uniform vec3 uSunColor;
    uniform vec3 uPalette[4];
    uniform vec3 uAtmoColor;
    uniform float uSeed;
    uniform float uTime;
    uniform float uWater;        // 0..1 sea level
    uniform float uIce;          // polar cap extent
    uniform float uClouds;       // cloud coverage
    uniform float uRough;        // terrain frequency
    uniform float uGas;          // 1 = banded gas giant
    uniform float uLava;         // 1 = molten cracks glow
    uniform float uCity;         // night-side settlement lights
    uniform mat3 uToWorld;       // object -> world rotation (fragment shaders
                                 // have no modelMatrix, so it is passed in)
    varying vec3 vPos;
    varying vec3 vNormal;
    varying vec3 vWorld;

    // Elevation at a point on the unit sphere. The octave count trades detail
    // for speed: the shading pass wants all of it, the gradient samples do not.
    float heightAt(vec3 n, int oct){
      vec3 sp = n * uRough + vec3(uSeed);
      if (uGas > 0.5){
        float band = n.y * 6.0 + fbm(sp * 0.7 + vec3(uTime * 0.006, 0.0, 0.0), 5, 2.1, 0.55) * 2.4;
        float h = 0.5 + 0.5 * sin(band * 2.3);
        return mix(h, fbm(sp * 1.6, 4, 2.0, 0.5) * 0.5 + 0.5, 0.25);
      }
      float base = fbm(sp, oct, 2.03, 0.52) * 0.5 + 0.5;
      float mount = ridged(sp * 2.1 + 11.0, oct - 1, 2.1, 0.5);
      return base * 0.75 + mount * 0.35 * base;
    }

    void main(){
      vec3 n = normalize(vPos);
      vec3 sp = n * uRough + vec3(uSeed);

      float h = heightAt(n, 5);

      // Bump: sample the height field along two tangents and tilt the normal,
      // so relief actually catches the light instead of being painted on.
      // Only worth doing where there is light to catch, and gas giants have
      // no relief to speak of — both cases skip the extra samples entirely.
      vec3 wsmooth = normalize(uToWorld * n);
      float sunFacing = dot(wsmooth, normalize(uSunDir));
      vec3 bumped = n;
      if (uGas < 0.5 && sunFacing > -0.15){
        vec3 tangent = normalize(abs(n.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), n) : vec3(1.0, 0.0, 0.0));
        vec3 bitan = cross(n, tangent);
        float eps = 0.010;
        float hc = heightAt(n, 3);
        float hx = heightAt(normalize(n + tangent * eps), 3);
        float hy = heightAt(normalize(n + bitan * eps), 3);
        bumped = normalize(n - (tangent * (hx - hc) + bitan * (hy - hc)) * 30.0);
      }

      float sea = uWater;
      float land = smoothstep(sea, sea + 0.03, h);

      vec3 col;
      if (uGas > 0.5){
        col = mix(uPalette[0], uPalette[1], smoothstep(0.25, 0.75, h));
        col = mix(col, uPalette[2], smoothstep(0.8, 1.0, h));
        // The great storm.
        float storm = smoothstep(0.86, 1.0, 1.0 - length(n.xy - vec2(0.42, -0.22)) * 1.6);
        col = mix(col, uPalette[3], storm * 0.85);
      } else {
        float shore = smoothstep(sea - 0.02, sea + 0.06, h);
        vec3 deep = uPalette[0] * 0.55;
        vec3 water = mix(deep, uPalette[0], smoothstep(sea - 0.25, sea, h));
        vec3 ground = mix(uPalette[1], uPalette[2], smoothstep(sea + 0.02, sea + 0.35, h));
        ground = mix(ground, uPalette[3], smoothstep(sea + 0.3, sea + 0.6, h));
        col = mix(water, ground, shore);
        // Ice caps, ragged at the edge.
        float lat = abs(n.y);
        float caps = smoothstep(uIce - 0.12, uIce + 0.06, lat + fbm(sp * 3.0, 3, 2.0, 0.5) * 0.09);
        col = mix(col, vec3(0.92, 0.95, 1.0), caps * 0.95);
      }

      // Lava fissures glowing through the crust.
      if (uLava > 0.5){
        float cr = ridged(sp * 3.2 + 4.0, 4, 2.2, 0.5);
        float glow = smoothstep(0.62, 0.95, cr) * (1.0 - land * 0.4);
        col = mix(col, vec3(1.0, 0.42, 0.08) * 2.2, glow);
      }

      // Lighting.
      vec3 wn = normalize(uToWorld * bumped);
      float ndl = dot(wn, normalize(uSunDir));
      float ndlSmooth = dot(wsmooth, normalize(uSunDir));
      // Terrain shading from the bumped normal; the terminator follows the
      // true sphere so relief never punches a hole through the night side.
      float lightAmt = clamp(ndl, 0.0, 1.0) * smoothstep(-0.06, 0.22, ndlSmooth);
      float night = 1.0 - smoothstep(-0.06, 0.22, ndlSmooth);

      // Specular sheen on open water only.
      float spec = 0.0;
      if (uGas < 0.5 && land < 0.5){
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 hv = normalize(v + normalize(uSunDir));
        spec = pow(max(dot(wsmooth, hv), 0.0), 60.0) * 0.7 * lightAmt;
      }

      // Clouds drift slowly, cast a faint shadow on what's beneath.
      if (uClouds > 0.01){
        float c = fbm(n * 2.6 + vec3(uTime * 0.012, uTime * 0.004, uSeed), 5, 2.2, 0.55) * 0.5 + 0.5;
        float cm = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.22, c);
        col = mix(col * (1.0 - cm * 0.15), vec3(1.0), cm * 0.85);
      }

      vec3 lit = col * (lightAmt * uSunColor * 1.15 + 0.05);
      lit += uSunColor * spec;

      // Settlements: a scatter of warm pinpricks on the dark side.
      if (uCity > 0.5){
        float cl = fbm(n * 14.0 + uSeed, 3, 2.4, 0.5) * 0.5 + 0.5;
        float lights = smoothstep(0.74, 0.82, cl) * land * night;
        lit += vec3(1.0, 0.72, 0.36) * lights * 0.85;
      }

      // Atmospheric limb scattering.
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(1.0 - max(dot(wsmooth, v), 0.0), 3.0);
      lit += uAtmoColor * rim * (lightAmt * 0.9 + 0.06);

      gl_FragColor = vec4(lit, 1.0);
    }
  `;

  // =========================================================================
  // ATMOSPHERE SHELL (additive, back faces) — the blue halo around a world.
  // =========================================================================
  const atmoVert = `
    varying vec3 vNormal; varying vec3 vWorld;
    void main(){
      vNormal = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const atmoFrag = `
    precision highp float;
    uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower; uniform float uIntensity;
    varying vec3 vNormal; varying vec3 vWorld;
    void main(){
      vec3 v = normalize(cameraPosition - vWorld);
      vec3 n = normalize(vNormal);
      float rim = pow(1.0 - abs(dot(n, v)), uPower);
      float ndl = smoothstep(-0.45, 0.5, dot(n, normalize(uSunDir)));
      // Forward-scattering makes the crescent glow hot near the terminator.
      float fs = pow(max(dot(normalize(uSunDir), -v), 0.0), 4.0) * 0.6;
      float a = rim * (ndl + fs) * uIntensity;
      gl_FragColor = vec4(uColor * a, a);
    }
  `;

  // =========================================================================
  // STAR — churning photosphere + corona.
  // =========================================================================
  const starFrag = `
    precision highp float;
    ${NOISE}
    uniform float uTime; uniform vec3 uColorA; uniform vec3 uColorB; uniform float uSeed;
    varying vec3 vPos; varying vec3 vNormal; varying vec3 vWorld;
    void main(){
      vec3 n = normalize(vPos);
      float g = fbm(n * 3.2 + vec3(uTime * 0.05, uTime * 0.03, uSeed), 5, 2.2, 0.55);
      float cells = ridged(n * 7.0 + vec3(0.0, uTime * 0.08, uSeed), 4, 2.1, 0.5);
      float t = clamp(g * 0.5 + 0.5 + cells * 0.35, 0.0, 1.0);
      vec3 col = mix(uColorA, uColorB, t);
      // Sunspots.
      float spot = smoothstep(0.55, 0.75, fbm(n * 4.5 - uSeed, 4, 2.0, 0.5) * 0.5 + 0.5);
      col *= 1.0 - spot * 0.45;
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(1.0 - max(dot(normalize(vNormal), v), 0.0), 2.0);
      col += uColorB * rim * 1.6;
      gl_FragColor = vec4(col * 2.4, 1.0);
    }
  `;

  // Corona billboard — soft, breathing halo drawn additively behind everything.
  const glowVert = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  const glowFrag = `
    precision highp float;
    ${NOISE}
    uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uSeed;
    varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = pow(1.0 - r, 2.6);
      float ang = atan(p.y, p.x);
      // Ragged flares licking outward.
      float flare = fbm(vec3(cos(ang) * 2.0, sin(ang) * 2.0, uTime * 0.15 + uSeed), 4, 2.3, 0.55);
      a *= 1.0 + flare * 0.55 * smoothstep(0.15, 1.0, r);
      a += pow(1.0 - r, 12.0) * 1.2;
      gl_FragColor = vec4(uColor * a * uIntensity, a * uIntensity);
    }
  `;

  // =========================================================================
  // ACCRETION DISK — relativistic beaming, doppler shift, hot inner edge.
  // =========================================================================
  const diskFrag = `
    precision highp float;
    ${NOISE}
    uniform float uTime; uniform float uInner; uniform float uOuter;
    uniform vec3 uHot; uniform vec3 uCool; uniform vec3 uCenter;
    varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld;
    void main(){
      // RingGeometry builds its vertices in the XY plane; the mesh is what
      // gets laid flat afterwards. Radius therefore comes from xy, not xz.
      float r = length(vPos.xy);
      float t = (r - uInner) / (uOuter - uInner);
      if (t < 0.0 || t > 1.0) discard;
      float ang = atan(vPos.y, vPos.x);
      // Keplerian shear: inner material laps the outer material.
      float spin = uTime * (1.6 / pow(max(r, uInner), 0.6));
      vec3 sp = vec3(cos(ang + spin) * 2.0, sin(ang + spin) * 2.0, r * 0.35);
      float turb = fbm(sp * 1.4, 5, 2.3, 0.55) * 0.5 + 0.5;
      float streak = ridged(sp * vec3(3.0, 3.0, 0.6), 4, 2.2, 0.5);

      float heat = pow(1.0 - t, 2.4);
      vec3 col = mix(uCool, uHot, clamp(heat * 1.25, 0.0, 1.0));
      col *= 0.55 + turb * 1.1 + streak * 0.5;

      // Doppler beaming: the side rotating toward the camera is brighter/bluer.
      // Orbital velocity is tangential in the world XZ plane about the hole.
      vec3 v = normalize(cameraPosition - vWorld);
      vec3 radial = vWorld - uCenter;
      vec3 vel = normalize(cross(vec3(0.0, 1.0, 0.0), radial));
      float beam = dot(vel, -v);
      col *= 1.0 + beam * 0.95;
      col = mix(col, col * vec3(0.75, 0.88, 1.35), clamp(beam, 0.0, 1.0) * 0.7);
      col = mix(col, col * vec3(1.35, 0.72, 0.5), clamp(-beam, 0.0, 1.0) * 0.5);

      float alpha = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.72, t);
      alpha *= 0.55 + turb * 0.6;
      col *= 0.8 + heat * 2.4;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `;
  const diskVert = `
    varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld;
    void main(){
      vUv = uv; vPos = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  // Photon ring — the thin, painfully bright circle at 1.5 Schwarzschild radii.
  const photonFrag = `
    precision highp float;
    uniform float uTime; uniform vec3 uColor;
    varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float ring = exp(-pow(abs(r - 0.72) * 34.0, 2.0));
      float halo = exp(-pow(abs(r - 0.72) * 6.0, 2.0)) * 0.35;
      float a = ring + halo;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * a * 4.5, a);
    }
  `;

  // =========================================================================
  // NEBULA — layered volumetric-ish billboards.
  // =========================================================================
  const nebulaFrag = `
    precision highp float;
    ${NOISE}
    uniform vec3 uColorA; uniform vec3 uColorB; uniform float uSeed;
    uniform float uTime; uniform float uDensity;
    varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      vec3 q = vec3(p * 1.7, uSeed);
      float f = fbm(q + vec3(0.0, 0.0, uTime * 0.01), 6, 2.15, 0.55) * 0.5 + 0.5;
      float fil = ridged(q * 1.8 + uSeed, 5, 2.2, 0.5);
      float d = f * 0.65 + fil * 0.6;
      d *= pow(1.0 - r, 1.8);
      d = smoothstep(0.12, 0.85, d) * uDensity;
      vec3 col = mix(uColorA, uColorB, clamp(fil * 1.3, 0.0, 1.0));
      col += uColorB * pow(d, 3.0) * 0.7;
      gl_FragColor = vec4(col * d, d);
    }
  `;

  // =========================================================================
  // POST — bright pass, separable blur, and the final composite that carries
  // gravitational lensing, chromatic aberration, grain and vignette.
  // =========================================================================
  const quadVert = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const brightFrag = `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uSoft;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(uThreshold, uThreshold + uSoft, l);
      gl_FragColor = vec4(c * k, 1.0);
    }
  `;

  const blurFrag = `
    precision highp float;
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel;
    varying vec2 vUv;
    void main(){
      vec3 sum = vec3(0.0);
      float w[5];
      w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;
      sum += texture2D(tDiffuse, vUv).rgb * w[0];
      for (int i = 1; i < 5; i++){
        vec2 o = uDir * uTexel * float(i) * 1.6;
        sum += texture2D(tDiffuse, vUv + o).rgb * w[i];
        sum += texture2D(tDiffuse, vUv - o).rgb * w[i];
      }
      gl_FragColor = vec4(sum, 1.0);
    }
  `;

  const compositeFrag = `
    precision highp float;
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uBloom;
    uniform float uExposure;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uFade;        // 0 = normal, 1 = black (transitions)
    uniform float uWarp;        // hyperspace radial smear
    uniform float uShake;
    // Black hole lensing, fed from the CPU each frame.
    uniform vec2 uHolePos;      // screen-space centre, 0..1
    uniform float uHoleStrength;
    uniform float uHoleRadius;
    uniform float uHoleVisible;
    varying vec2 vUv;

    float hash12(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 uv = vUv;

      // --- gravitational lensing -------------------------------------------
      if (uHoleVisible > 0.5){
        vec2 d = uv - uHolePos;
        d.x *= aspect;
        float r = length(d);
        float rs = max(uHoleRadius, 0.0005);
        // Deflection ~ 1/r, clamped so it stays stable at the singularity.
        float defl = uHoleStrength * rs * rs / max(r * r, rs * rs * 0.06);
        defl = min(defl, 0.62);
        vec2 dir = r > 0.00001 ? d / r : vec2(0.0);
        // Inside the shadow, nothing comes back out.
        float shadow = smoothstep(rs * 0.98, rs * 0.86, r);
        uv = clamp(uv - dir * defl * vec2(1.0 / aspect, 1.0), vec2(0.001), vec2(0.999));
        vec3 lensed = texture2D(tScene, uv).rgb;
        lensed *= 1.0 - shadow;
        vec3 bl = texture2D(tBloom, uv).rgb * (1.0 - shadow * 0.85);
        vec3 c0 = lensed + bl * uBloom;
        // Continue with the rest of the chain using the lensed colour.
        vec2 p = vUv * 2.0 - 1.0;
        c0 *= uExposure;
        c0 = c0 / (1.0 + c0);
        c0 = pow(c0, vec3(1.0 / 2.2));
        float vig = 1.0 - uVignette * dot(p, p) * 0.42;
        c0 *= vig;
        c0 += (hash12(gl_FragCoord.xy + uTime * 60.0) - 0.5) * uGrain;
        c0 *= 1.0 - uFade;
        gl_FragColor = vec4(c0, 1.0);
        return;
      }

      vec2 p = vUv * 2.0 - 1.0;
      vec2 suv = uv + vec2(sin(uTime * 47.0), cos(uTime * 39.0)) * uShake;

      // Hyperspace: smear samples radially outward from the centre.
      vec3 scene;
      if (uWarp > 0.001){
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 8; i++){
          float t = float(i) / 7.0;
          float s = 1.0 - t * uWarp * 0.28;
          vec2 su = (suv - 0.5) * s + 0.5;
          float w = 1.0 - t * 0.6;
          acc += texture2D(tScene, su).rgb * w; wsum += w;
        }
        scene = acc / wsum;
      } else {
        scene = texture2D(tScene, suv).rgb;
      }

      // Chromatic aberration grows toward the edges of the lens.
      float ca = uChroma * (0.4 + dot(p, p));
      if (ca > 0.0001){
        vec2 off = normalize(p + 0.0001) * ca * 0.004;
        scene.r = texture2D(tScene, suv + off).r;
        scene.b = texture2D(tScene, suv - off).b;
      }

      vec3 bloom = texture2D(tBloom, suv).rgb;
      vec3 c = scene + bloom * uBloom;

      c *= uExposure;
      c = c / (1.0 + c);                 // Reinhard
      c = pow(c, vec3(1.0 / 2.2));       // gamma

      float vig = 1.0 - uVignette * dot(p, p) * 0.42;
      c *= vig;
      c += (hash12(gl_FragCoord.xy + uTime * 60.0) - 0.5) * uGrain;
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  global.SH = {
    NOISE, planetVert, planetFrag, atmoVert, atmoFrag, starFrag,
    glowVert, glowFrag, diskVert, diskFrag, photonFrag, nebulaFrag,
    quadVert, brightFrag, blurFrag, compositeFrag
  };
})(window);
