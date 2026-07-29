/* =========================================================================
   THE LONG QUIET — system.js
   Builds one star system at a time: the star, its worlds, moons, rings,
   the belt, and whatever people left behind out here.
   ========================================================================= */
(function (global) {
  'use strict';

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  function toVec(arr) { return new THREE.Vector3(arr[0], arr[1], arr[2]); }

  // --- Ring shader (procedural bands with a shadow cast by the planet) ------
  const ringVert = `
    varying vec3 vPos; varying vec3 vWorld;
    void main(){
      vPos = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const ringFrag = `
    precision highp float;
    ${SH.NOISE}
    uniform vec3 uColorA; uniform vec3 uColorB; uniform float uInner; uniform float uOuter;
    uniform float uSeed; uniform vec3 uSunDir; uniform float uPlanetRadius;
    varying vec3 vPos; varying vec3 vWorld;
    void main(){
      // Vertices live in the XY plane (see the accretion disk for the same
      // trap): the mesh is rotated flat, the geometry is not.
      float r = length(vPos.xy);
      float t = (r - uInner) / (uOuter - uInner);
      if (t < 0.0 || t > 1.0) discard;
      float bands = fbm(vec3(t * 26.0, uSeed, 0.0), 5, 2.3, 0.55) * 0.5 + 0.5;
      float gaps = smoothstep(0.34, 0.42, abs(sin(t * 13.0 + uSeed)));
      float a = bands * gaps * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.86, t);
      vec3 col = mix(uColorA, uColorB, bands);
      // Planet shadow: project the ring point onto the sun axis. The ring's
      // XY plane corresponds to the planet's XZ plane once the mesh is laid flat.
      vec3 local = vec3(vPos.x, 0.0, vPos.y);
      float along = dot(local, normalize(uSunDir));
      vec3 perp = local - normalize(uSunDir) * along;
      float shadow = (along < 0.0 && length(perp) < uPlanetRadius) ? 0.12 : 1.0;
      gl_FragColor = vec4(col * shadow * 1.3, a * 0.85);
    }
  `;

  // Anomaly / artifact shader — something that does not belong here.
  const anomalyFrag = `
    precision highp float;
    ${SH.NOISE}
    uniform float uTime; uniform vec3 uColor;
    varying vec3 vPos; varying vec3 vNormal; varying vec3 vWorld;
    void main(){
      vec3 n = normalize(vPos);
      float f = fbm(n * 3.0 + vec3(0.0, uTime * 0.25, 0.0), 5, 2.2, 0.55) * 0.5 + 0.5;
      float lines = smoothstep(0.46, 0.5, abs(fract(f * 6.0 + uTime * 0.1) - 0.5));
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(1.0 - max(dot(normalize(vNormal), v), 0.0), 2.5);
      vec3 col = uColor * (0.25 + lines * 1.4 + rim * 2.4);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function SystemScene(scene) {
    const self = {};
    let group = null;
    let bodies = [];          // targetable things
    let updaters = [];        // per-frame closures
    let sys = null;
    let starLight = null;
    let starMesh = null;
    const disposables = [];

    function track(obj) {
      if (obj.geometry) disposables.push(obj.geometry);
      if (obj.material) disposables.push(obj.material);
      return obj;
    }

    // --- Star ---------------------------------------------------------------
    function buildStar(s, rng) {
      const cls = s.star;
      const radius = 320 * cls.r;
      const colA = toVec(cls.a), colB = toVec(cls.b);

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: colA }, uColorB: { value: colB },
          uSeed: { value: rng.range(0, 100) }
        },
        vertexShader: SH.planetVert,
        fragmentShader: SH.starFrag
      });
      const mesh = track(new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat));
      group.add(mesh);
      starMesh = mesh;

      // Corona billboard, scaled well beyond the photosphere.
      const glowMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: colB.clone() }, uTime: { value: 0 },
          uIntensity: { value: cls.cls === 'N' ? 1.8 : 1.0 },
          uSeed: { value: rng.range(0, 100) }
        },
        vertexShader: SH.glowVert, fragmentShader: SH.glowFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const glow = track(new THREE.Mesh(new THREE.PlaneGeometry(radius * 9, radius * 9), glowMat));
      glow.userData.billboard = true;
      group.add(glow);

      updaters.push((t, dt) => {
        mat.uniforms.uTime.value = t;
        glowMat.uniforms.uTime.value = t;
        mesh.rotation.y += dt * 0.008;
      });

      bodies.push({
        obj: mesh, name: s.name + ' (' + cls.label + ')', type: 'star',
        radius: radius, kind: cls.cls, scannable: true, scanned: false,
        desc: starDesc(cls), hazard: radius * 2.6
      });
      return radius;
    }

    function starDesc(cls) {
      switch (cls.cls) {
        case 'M': return 'A red dwarf. It will outlive every story ever told about it.';
        case 'K': return 'Orange, steady, unremarkable. The best kind of star to live near.';
        case 'G': return 'A yellow star. The type that grows people, given enough time and luck.';
        case 'F': return 'White and hot. Its worlds are sterilised out to a long way.';
        case 'A': return 'Blue-white and fast-burning. Young. It will not be here long.';
        case 'B': return 'A blue giant. Enormous, violent, and already dying.';
        case 'N': return 'A neutron star: a sun folded into a city-sized point. It spins, and it does not forgive.';
        case 'D': return 'A dying ember. The fusion stopped a long time ago. This is only the heat left over.';
        default: return 'Unclassified stellar object.';
      }
    }

    // --- Planet -------------------------------------------------------------
    function buildPlanet(p, s, rng) {
      const pal = GALAXY.PALETTES[p.kind];
      const pivot = new THREE.Group();
      group.add(pivot);
      pivot.rotation.x = p.inclination;

      const holder = new THREE.Group();
      pivot.add(holder);

      // Two worlds of the same class should not be the same colour. Rotate
      // the palette's hue per planet — gently for rock and ice, wildly for
      // gas giants, which range from Jovian cream to Neptune blue.
      const hueShift = p.kind === 'gas' ? rng.range(-0.5, 0.5) : rng.gauss() * 0.05;
      const satMul = 0.85 + rng.range(0, 0.5);
      const palette = pal.p.map(c => {
        const col = new THREE.Color(c[0], c[1], c[2]);
        const hsl = { h: 0, s: 0, l: 0 };
        col.getHSL(hsl);
        col.setHSL(U.mod(hsl.h + hueShift, 1), Math.min(1, hsl.s * satMul), hsl.l);
        return V3(col.r, col.g, col.b);
      });
      const atmoCol = new THREE.Color(pal.atmo[0], pal.atmo[1], pal.atmo[2]);
      const ahsl = { h: 0, s: 0, l: 0 };
      atmoCol.getHSL(ahsl);
      atmoCol.setHSL(U.mod(ahsl.h + hueShift * 0.6, 1), ahsl.s, ahsl.l);

      const uniforms = {
        uSunDir: { value: V3(1, 0, 0) },
        uSunColor: { value: toVec(s.star.b) },
        uPalette: { value: palette },
        uAtmoColor: { value: V3(atmoCol.r, atmoCol.g, atmoCol.b) },
        uSeed: { value: p.seed },
        uTime: { value: 0 },
        uWater: { value: pal.water },
        uIce: { value: pal.ice },
        uClouds: { value: pal.clouds },
        uRough: { value: 1.6 + rng.range(-0.5, 1.4) },
        uGas: { value: p.kind === 'gas' ? 1 : 0 },
        uLava: { value: p.kind === 'lava' ? 1 : 0 },
        uCity: { value: p.city ? 1 : 0 },
        uToWorld: { value: new THREE.Matrix3() }
      };
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: SH.planetVert, fragmentShader: SH.planetFrag
      });
      const mesh = track(new THREE.Mesh(new THREE.SphereGeometry(p.radius, 96, 48), mat));
      mesh.rotation.z = p.tilt;
      holder.add(mesh);

      // Atmosphere shell for anything with air.
      let atmoMat = null;
      const hasAir = ['ocean', 'verdant', 'toxic', 'ice', 'desert', 'gas', 'lava'].includes(p.kind);
      if (hasAir) {
        atmoMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: V3(atmoCol.r, atmoCol.g, atmoCol.b) },
            uSunDir: { value: V3(1, 0, 0) },
            uPower: { value: 3.0 },
            uIntensity: { value: p.kind === 'gas' ? 1.1 : 1.5 }
          },
          vertexShader: SH.atmoVert, fragmentShader: SH.atmoFrag,
          transparent: true, side: THREE.BackSide, depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const shell = track(new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.06, 48, 24), atmoMat));
        holder.add(shell);
      }

      // Rings.
      let ringMat = null;
      if (p.rings) {
        const inner = p.radius * rng.range(1.4, 1.7);
        const outer = inner * rng.range(1.5, 2.3);
        const ca = new THREE.Color().setHSL(rng.range(0.05, 0.12), 0.35, 0.42);
        const cb = new THREE.Color().setHSL(rng.range(0.05, 0.12), 0.2, 0.72);
        ringMat = new THREE.ShaderMaterial({
          uniforms: {
            uColorA: { value: V3(ca.r, ca.g, ca.b) },
            uColorB: { value: V3(cb.r, cb.g, cb.b) },
            uInner: { value: inner }, uOuter: { value: outer },
            uSeed: { value: rng.range(0, 100) },
            uSunDir: { value: V3(1, 0, 0) },
            uPlanetRadius: { value: p.radius }
          },
          vertexShader: ringVert, fragmentShader: ringFrag,
          transparent: true, side: THREE.DoubleSide, depthWrite: false
        });
        const ring = track(new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128, 1), ringMat));
        ring.rotation.x = -Math.PI / 2;
        const tiltGroup = new THREE.Group();
        tiltGroup.rotation.z = p.tilt;
        tiltGroup.add(ring);
        holder.add(tiltGroup);
      }

      // Moons.
      const moons = [];
      for (let i = 0; i < p.moons; i++) {
        const mr = p.radius * rng.range(0.16, 0.34);
        const md = p.radius * rng.range(2.6, 5.5) + mr * 3;
        const mMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(rng.range(0, 1), 0.05, rng.range(0.25, 0.5)),
          roughness: 0.95, metalness: 0.0, flatShading: true
        });
        const mMesh = track(new THREE.Mesh(new THREE.IcosahedronGeometry(mr, 3), mMat));
        // Rough up the sphere so moons read as cratered rock.
        deform(mMesh.geometry, rng, 0.09);
        holder.add(mMesh);
        moons.push({
          mesh: mMesh, dist: md, speed: rng.range(0.012, 0.045) * rng.sign(),
          phase: rng.range(0, Math.PI * 2), incl: rng.gauss() * 0.4
        });
        bodies.push({
          obj: mMesh, name: p.name + ' ' + String.fromCharCode(97 + i), type: 'moon',
          radius: mr, kind: 'barren', scannable: true, scanned: false,
          desc: 'A moon of ' + p.name + '. ' + GALAXY.describePlanet({ kind: 'barren' }, rng),
          hazard: mr * 1.25
        });
      }

      const body = {
        obj: holder, mesh: mesh, name: p.name, type: 'planet',
        radius: p.radius, kind: p.kind, scannable: true, scanned: !!p.scanned,
        desc: GALAXY.describePlanet(p, rng), data: p, hazard: p.radius * 1.2
      };
      bodies.push(body);

      const spin = rng.range(0.03, 0.12) * rng.sign();
      updaters.push((t, dt) => {
        const ang = p.phase + t * p.orbitSpeed;
        holder.position.set(Math.cos(ang) * p.orbit, 0, Math.sin(ang) * p.orbit);
        mesh.rotation.y += dt * spin;
        uniforms.uTime.value = t;
        // The planet spins and is tilted; the shader needs that rotation to
        // turn object-space normals into world space.
        mesh.updateWorldMatrix(true, false);
        uniforms.uToWorld.value.setFromMatrix4(mesh.matrixWorld);
        // Sunlight direction in world space (the star sits at the origin).
        const wp = new THREE.Vector3();
        holder.getWorldPosition(wp);
        const dir = wp.clone().multiplyScalar(-1).normalize();
        uniforms.uSunDir.value.copy(dir);
        if (atmoMat) atmoMat.uniforms.uSunDir.value.copy(dir);
        if (ringMat) {
          // Ring shader works in the planet's local frame.
          const local = dir.clone().applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()).invert());
          ringMat.uniforms.uSunDir.value.copy(local);
        }
        for (const m of moons) {
          const a2 = m.phase + t * m.speed;
          m.mesh.position.set(
            Math.cos(a2) * m.dist,
            Math.sin(a2) * m.dist * Math.sin(m.incl),
            Math.sin(a2) * m.dist * Math.cos(m.incl)
          );
          m.mesh.rotation.y += dt * 0.05;
        }
      });

      return body;
    }

    // Perturb vertices to break up the primitive silhouette. `amount` is a
    // fraction of the radius. Shared vertices must move together or the mesh
    // splits open, so displacement is cached by position.
    function deform(geo, rng, amount) {
      const pos = geo.attributes.position;
      const seen = new Map();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
        let s = seen.get(key);
        if (s === undefined) { s = 1 + rng.gauss() * amount; seen.set(key, s); }
        pos.setXYZ(i, x * s, y * s, z * s);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }

    // --- Asteroid belt ------------------------------------------------------
    function buildBelt(s, rng) {
      const COUNT = 900;
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x6b6357, roughness: 0.98, metalness: 0.02, flatShading: true
      });
      const inst = new THREE.InstancedMesh(geo, mat, COUNT);
      inst.frustumCulled = false;
      disposables.push(geo, mat);
      const dummy = new THREE.Object3D();
      const rocks = [];
      for (let i = 0; i < COUNT; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = s.beltRadius * rng.range(0.86, 1.14);
        const y = rng.gauss() * s.beltRadius * 0.02;
        const sc = Math.pow(rng.next(), 2.4) * 34 + 3;
        rocks.push({
          a, r, y, sc,
          rot: V3(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)),
          spin: rng.range(0.1, 0.5) * rng.sign(),
          w: (0.004 / Math.pow(r / 3000, 1.5)) * rng.range(0.9, 1.1)
        });
      }
      group.add(inst);
      updaters.push((t) => {
        for (let i = 0; i < COUNT; i++) {
          const k = rocks[i];
          const ang = k.a + t * k.w;
          dummy.position.set(Math.cos(ang) * k.r, k.y, Math.sin(ang) * k.r);
          dummy.rotation.set(k.rot.x + t * k.spin, k.rot.y + t * k.spin * 0.6, k.rot.z);
          dummy.scale.setScalar(k.sc);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
      });
      bodies.push({
        obj: inst, name: s.name + ' Belt', type: 'belt', radius: s.beltRadius,
        kind: 'belt', scannable: false, scanned: false, noNav: true,
        desc: 'Debris in a resonance gap. A planet that never finished assembling.',
        hazard: 0
      });
    }

    // --- Derelict -----------------------------------------------------------
    function buildDerelict(s, rng, distance, kind) {
      const wreck = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({
        color: 0x5a5f66, roughness: 0.85, metalness: 0.55, flatShading: false
      });
      const darkMat = new THREE.MeshStandardMaterial({
        color: 0x24262b, roughness: 0.9, metalness: 0.4
      });
      disposables.push(hullMat, darkMat);

      const len = rng.range(70, 210);
      const rad = len * rng.range(0.08, 0.16);
      const body = track(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.8, len, 12, 1), hullMat));
      body.rotation.z = Math.PI / 2;
      wreck.add(body);

      // Broken spine and ribs.
      for (let i = 0; i < rng.int(3, 7); i++) {
        const ring = track(new THREE.Mesh(new THREE.TorusGeometry(rad * rng.range(1.1, 1.9), rad * 0.09, 6, 18), darkMat));
        ring.rotation.y = Math.PI / 2;
        ring.position.x = rng.range(-len * 0.45, len * 0.45);
        ring.rotation.x = rng.gauss() * 0.2;
        wreck.add(ring);
      }
      for (let i = 0; i < rng.int(2, 5); i++) {
        const panel = track(new THREE.Mesh(
          new THREE.BoxGeometry(len * rng.range(0.1, 0.3), rad * 0.08, rad * rng.range(1.5, 3.4)), darkMat));
        panel.position.set(rng.range(-len * 0.4, len * 0.4), rng.gauss() * rad, rng.gauss() * rad * 1.5);
        panel.rotation.set(rng.gauss() * 0.5, rng.gauss() * 0.5, rng.gauss() * 0.5);
        wreck.add(panel);
      }
      // Severed prow, drifting alongside.
      const prow = track(new THREE.Mesh(new THREE.ConeGeometry(rad * 0.9, len * 0.3, 10), hullMat));
      prow.rotation.z = -Math.PI / 2;
      prow.position.set(len * 0.78, rng.gauss() * rad * 1.5, rng.gauss() * rad * 1.5);
      prow.rotation.x = rng.gauss() * 0.6;
      wreck.add(prow);

      // The beacon: the only thing still drawing power.
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
      disposables.push(beaconMat);
      const beacon = track(new THREE.Mesh(new THREE.SphereGeometry(rad * 0.22, 12, 8), beaconMat));
      beacon.position.set(-len * 0.4, rad * 1.2, 0);
      wreck.add(beacon);
      const bLight = new THREE.PointLight(0xff5a3c, 3, rad * 40, 2);
      beacon.add(bLight);

      const v = rng.unitVec();
      wreck.position.set(v.x * distance, v.y * distance * 0.3, v.z * distance);
      wreck.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      group.add(wreck);

      const tumble = V3(rng.gauss() * 0.02, rng.gauss() * 0.02, rng.gauss() * 0.02);
      updaters.push((t, dt) => {
        wreck.rotation.x += tumble.x * dt;
        wreck.rotation.y += tumble.y * dt;
        wreck.rotation.z += tumble.z * dt;
        const pulse = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(t * 1.6)), 6);
        beaconMat.color.setRGB(1.0 * pulse, 0.35 * pulse, 0.23 * pulse);
        bLight.intensity = pulse * 4;
      });

      bodies.push({
        obj: wreck, name: 'Unidentified hull', type: 'derelict', radius: len * 0.6,
        kind: kind, scannable: true, scanned: false, signal: true,
        desc: 'A ship that stopped. The beacon is still running on whatever is left.',
        hazard: len * 0.35
      });
    }

    // --- Anomaly ------------------------------------------------------------
    function buildAnomaly(s, rng, distance) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: V3(0.45, 0.95, 0.85) } },
        vertexShader: SH.planetVert, fragmentShader: anomalyFrag
      });
      const size = rng.range(30, 70);
      const mesh = track(new THREE.Mesh(new THREE.IcosahedronGeometry(size, 2), mat));
      const v = rng.unitVec();
      mesh.position.set(v.x * distance, v.y * distance * 0.4, v.z * distance);
      group.add(mesh);
      const light = new THREE.PointLight(0x66ffdd, 2.5, size * 30, 2);
      mesh.add(light);
      updaters.push((t, dt) => {
        mat.uniforms.uTime.value = t;
        mesh.rotation.y += dt * 0.15;
        mesh.rotation.x += dt * 0.07;
        light.intensity = 2.0 + Math.sin(t * 2.1) * 0.9;
      });
      bodies.push({
        obj: mesh, name: 'Anomaly', type: 'anomaly', radius: size,
        kind: 'anomaly', scannable: true, scanned: false, signal: true,
        desc: 'It is not natural and it is not ours. It has been here longer than either.',
        hazard: size * 1.3
      });
    }

    // --- Public API ---------------------------------------------------------
    self.build = function (s) {
      self.dispose();
      sys = s;
      group = new THREE.Group();
      scene.add(group);
      bodies = [];
      updaters = [];

      const rng = U.Rng(s.seed);

      if (!s.isCore) {
        buildStar(s, rng);
        for (const p of s.planets) buildPlanet(p, s, rng);
        if (s.hasBelt) buildBelt(s, rng);
      }
      // Lighting for nearby solids is handled by game.js's directional star
      // light; a point light at the system centre never reaches this far.

      if (s.hasNebula) {
        const neb = SPACE.createNebula(String(s.seed), s.nebulaHue, 9, 26000, s.isCore ? 0.9 : 0.55);
        group.add(neb);
        self.nebula = neb;
      }

      const far = s.planets.length
        ? s.planets[s.planets.length - 1].orbit * 1.25
        : 9000;
      if (s.derelict) buildDerelict(s, rng, far * rng.range(0.5, 1.1), 'derelict');
      if (s.anomaly) buildAnomaly(s, rng, far * rng.range(0.4, 0.9));

      self.bodies = bodies;
      self.group = group;
      self.starLight = starLight;
      self.starMesh = starMesh;
      self.extent = far;
      return self;
    };

    self.update = function (t, dt, camera) {
      for (const u of updaters) u(t, dt);
      if (self.nebula) {
        for (const child of self.nebula.children) {
          child.quaternion.copy(camera.quaternion);
          if (child.material.uniforms && child.material.uniforms.uTime) child.material.uniforms.uTime.value = t;
        }
      }
      if (group) {
        group.traverse(o => {
          if (o.userData.billboard) o.quaternion.copy(camera.quaternion);
        });
      }
    };

    self.dispose = function () {
      if (!group) return;
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
      disposables.length = 0;
      group = null; bodies = []; updaters = []; starLight = null; starMesh = null;
      self.nebula = null; self.bodies = []; self.group = null;
    };

    self.bodies = bodies;
    return self;
  }

  global.SYSTEM = { SystemScene };
})(window);
