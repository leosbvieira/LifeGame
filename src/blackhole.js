/* =========================================================================
   THE LONG QUIET — blackhole.js
   The thing at the centre. An event horizon you cannot see, a disk you
   cannot look away from, and gravity that does not negotiate.
   ========================================================================= */
(function (global) {
  'use strict';

  const jetFrag = `
    precision highp float;
    ${SH.NOISE}
    uniform float uTime; uniform vec3 uColor;
    varying vec2 vUv; varying vec3 vPos;
    void main(){
      float along = clamp(vUv.y, 0.0, 1.0);
      float n = fbm(vec3(vUv * vec2(4.0, 1.2), uTime * 0.6 - vUv.y * 3.0), 4, 2.3, 0.55) * 0.5 + 0.5;
      float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
      float a = pow(edge, 3.4) * pow(1.0 - along, 2.2) * n * 0.7;
      a *= smoothstep(0.0, 0.06, along);
      vec3 col = mix(uColor, vec3(1.0), pow(edge, 6.0) * 0.6);
      gl_FragColor = vec4(col * a * 3.0, a * 0.7);
    }
  `;

  function BlackHole(opts) {
    opts = opts || {};
    const self = {};
    // Schwarzschild radius in world units. Everything else scales off it.
    const rs = opts.rs || 900;
    const group = new THREE.Group();

    // --- Event horizon: pure black, occludes the disk behind it -------------
    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(rs, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    group.add(horizon);

    // --- Photon ring --------------------------------------------------------
    const photonMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Vector3(1.0, 0.86, 0.62) } },
      vertexShader: SH.glowVert, fragmentShader: SH.photonFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const photon = new THREE.Mesh(new THREE.PlaneGeometry(rs * 4.2, rs * 4.2), photonMat);
    photon.userData.billboard = true;
    group.add(photon);

    // --- Accretion disk -----------------------------------------------------
    const inner = rs * 2.2, outer = rs * 13.0;
    const diskMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner }, uOuter: { value: outer },
        uHot: { value: new THREE.Vector3(1.0, 0.94, 0.82) },
        uCool: { value: new THREE.Vector3(1.0, 0.34, 0.10) },
        uCenter: { value: new THREE.Vector3() }
      },
      vertexShader: SH.diskVert, fragmentShader: SH.diskFrag,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 256, 24), diskMat);
    disk.rotation.x = -Math.PI / 2;
    group.add(disk);

    // The disk seen bent over the top of the hole: a second copy, standing on
    // edge, faked as the Einstein ring that light-bending would produce.
    const haloMat = diskMat.clone();
    haloMat.uniforms = THREE.UniformsUtils.clone(diskMat.uniforms);
    haloMat.uniforms.uInner.value = rs * 1.55;
    haloMat.uniforms.uOuter.value = rs * 4.6;
    const halo = new THREE.Mesh(new THREE.RingGeometry(rs * 1.55, rs * 4.6, 192, 8), haloMat);
    halo.userData.billboard = true;
    group.add(halo);

    // --- Relativistic jets --------------------------------------------------
    const jets = [];
    for (let s = -1; s <= 1; s += 2) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Vector3(0.42, 0.68, 1.0) } },
        vertexShader: `
          varying vec2 vUv; varying vec3 vPos;
          void main(){ vUv = uv; vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: jetFrag,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const h = rs * 14;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(rs * 2.4, h, 22, 1, true), mat);
      jet.position.y = (s * h) / 2;
      jet.rotation.x = s > 0 ? Math.PI : 0;
      group.add(jet);
      jets.push(mat);
    }

    // Light thrown out by the disk — lights the ship as you fall in.
    const light = new THREE.PointLight(0xffb070, 6.0, rs * 90, 2);
    group.add(light);

    // Debris being shredded on its way down.
    const debrisCount = 700;
    const dPos = new Float32Array(debrisCount * 3);
    const dRnd = new Float32Array(debrisCount);
    const orbits = [];
    const drng = U.Rng('bh-debris');
    for (let i = 0; i < debrisCount; i++) {
      const r = drng.range(inner * 0.95, outer * 1.05);
      const a = drng.range(0, Math.PI * 2);
      orbits.push({ r, a, y: drng.gauss() * rs * 0.22, w: 2.4 / Math.pow(r / rs, 1.5) });
      dRnd[i] = drng.range(0.3, 1);
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dGeo.setAttribute('aRnd', new THREE.BufferAttribute(dRnd, 1));
    const dMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: `
        attribute float aRnd; uniform float uPixelRatio; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = aRnd;
          gl_PointSize = (2.0 + aRnd * 3.0) * uPixelRatio * (2000.0 / max(length(mv.xyz), 1.0));
        }
      `,
      fragmentShader: `
        varying float vA;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          float a = exp(-r * 3.0) * vA;
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * 2.0, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const debris = new THREE.Points(dGeo, dMat);
    debris.frustumCulled = false;
    group.add(debris);

    self.group = group;
    self.rs = rs;
    self.diskOuter = outer;
    // Gravitational parameter chosen so orbital speeds stay flyable.
    self.mu = opts.mu || rs * rs * 260;

    self.update = function (t, dt, camera) {
      diskMat.uniforms.uTime.value = t;
      haloMat.uniforms.uTime.value = t;
      diskMat.uniforms.uCenter.value.copy(group.position);
      haloMat.uniforms.uCenter.value.copy(group.position);
      photonMat.uniforms.uTime.value = t;
      for (const j of jets) j.uniforms.uTime.value = t;
      group.traverse(o => { if (o.userData.billboard) o.quaternion.copy(camera.quaternion); });

      const arr = dGeo.attributes.position.array;
      for (let i = 0; i < debrisCount; i++) {
        const o = orbits[i];
        o.a += o.w * dt * 0.35;
        o.r -= dt * o.r * 0.004;                    // slow inspiral
        if (o.r < inner * 0.9) o.r = outer * 1.05;  // recycle from the rim
        arr[i * 3] = Math.cos(o.a) * o.r;
        arr[i * 3 + 1] = o.y * (o.r / outer);
        arr[i * 3 + 2] = Math.sin(o.a) * o.r;
      }
      dGeo.attributes.position.needsUpdate = true;
    };

    // Acceleration on a body at world position p (the hole sits at group.position).
    self.gravityAt = function (p, out) {
      const d = out.copy(group.position).sub(p);
      const r2 = Math.max(d.lengthSq(), 1);
      const a = self.mu / r2;
      return d.normalize().multiplyScalar(a);
    };

    self.distanceTo = function (p) { return group.position.distanceTo(p); };

    self.setPixelRatio = function (pr) { dMat.uniforms.uPixelRatio.value = pr; };

    self.dispose = function () {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      if (group.parent) group.parent.remove(group);
    };

    return self;
  }

  global.BLACKHOLE = { BlackHole };
})(window);
