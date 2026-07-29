/* =========================================================================
   THE LONG QUIET — ship.js
   One survey ship, built from primitives, and the flight model that moves it.
   ========================================================================= */
(function (global) {
  'use strict';

  const MAX_CRUISE = 340;      // units/s at full throttle
  const BOOST_MULT = 5.5;
  const PULSE_SPEED = 34000;   // interplanetary drive
  const PULSE_RAMP = 2.2;      // seconds to spin up

  function buildMesh() {
    const g = new THREE.Group();

    const hull = new THREE.MeshStandardMaterial({ color: 0xb9c1cc, roughness: 0.42, metalness: 0.72 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xe0703a, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b1620, roughness: 0.08, metalness: 0.1,
      transparent: true, opacity: 0.85, emissive: 0x123044, emissiveIntensity: 0.5
    });

    // Fuselage: a stretched, faceted spindle.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.55, 9.5, 8), hull);
    body.rotation.x = Math.PI / 2;
    g.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3.6, 8), hull);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = 6.55;
    g.add(nose);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 2.2, 8), dark);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -5.85;
    g.add(tail);

    // Canopy.
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), glass);
    canopy.scale.set(1.0, 0.7, 2.0);
    canopy.position.set(0, 0.55, 2.4);
    g.add(canopy);

    // Wings: swept, thin, with a hard leading edge.
    const wingShape = new THREE.BoxGeometry(7.5, 0.22, 3.0);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wingShape, hull);
      w.position.set(s * 4.1, -0.15, -1.6);
      w.rotation.y = s * -0.34;
      w.rotation.z = s * 0.09;
      g.add(w);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 2.0), accent);
      tip.position.set(s * 7.4, 0.35, -2.2);
      tip.rotation.z = s * 0.2;
      g.add(tip);

      // Nacelle under each wing.
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 4.4, 10), dark);
      nac.rotation.x = Math.PI / 2;
      nac.position.set(s * 3.4, -0.55, -2.0);
      g.add(nac);
    }

    // Dorsal fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.1, 2.6), hull);
    fin.position.set(0, 1.35, -4.0);
    fin.rotation.x = 0.22;
    g.add(fin);

    // Sensor dish — the reason this ship exists.
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), accent);
    dish.scale.set(1, 0.35, 1);
    dish.position.set(0, 1.15, 0.4);
    dish.rotation.x = -0.5;
    g.add(dish);

    // Engine bells + their glow.
    const engines = [];
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x66c8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const bellPositions = [[0, 0, -6.9], [-3.4, -0.55, -4.3], [3.4, -0.55, -4.3]];
    for (const p of bellPositions) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 1.0, 10, 1, true), dark);
      bell.rotation.x = Math.PI / 2;
      bell.position.set(p[0], p[1], p[2] + 0.4);
      g.add(bell);

      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.4, 12, 1, true), glowMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(p[0], p[1], p[2] - 1.4);
      g.add(flame);
      engines.push(flame);
    }

    // Navigation strobes.
    const navMats = [];
    for (const [x, c] of [[-7.6, 0xff3b30], [7.6, 0x30ff6a]]) {
      const m = new THREE.MeshBasicMaterial({ color: c });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m);
      l.position.set(x, 0.45, -2.2);
      g.add(l);
      navMats.push(m);
    }

    const cockpitLight = new THREE.PointLight(0x88bbff, 0.6, 30, 2);
    cockpitLight.position.set(0, 0.6, 2.0);
    g.add(cockpitLight);

    return { group: g, engines, glowMat, navMats, materials: [hull, dark, accent, glass, glowMat] };
  }

  // --- Engine trail ---------------------------------------------------------
  function buildTrail() {
    const COUNT = 600;
    const pos = new Float32Array(COUNT * 3);
    const age = new Float32Array(COUNT);
    const rnd = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) age[i] = 999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uColor: { value: new THREE.Vector3(0.42, 0.72, 1.0) } },
      vertexShader: `
        attribute float aAge; attribute float aRnd;
        uniform float uPixelRatio;
        varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float life = clamp(1.0 - aAge / 1.6, 0.0, 1.0);
          vA = life * aRnd;
          gl_PointSize = (1.0 + (1.0 - life) * 9.0) * aRnd * uPixelRatio * 3.0;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          float a = exp(-r * 2.6) * vA * 0.5;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), vA * 0.5) * a * 2.0, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { points: pts, geo, mat, COUNT, cursor: 0 };
  }

  function Ship(scene) {
    const self = {};
    const built = buildMesh();
    const trail = buildTrail();
    scene.add(built.group);
    scene.add(trail.points);

    const state = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      throttle: 0,
      pulse: 0,             // 0..1 spin-up of the long-range drive
      boost: 0,
      angVel: new THREE.Vector3(),   // pitch, yaw, roll rates
      speed: 0,
      hull: 100,
      fuel: 100
    };

    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const fwd = new THREE.Vector3();
    const desired = new THREE.Vector3();

    self.state = state;
    self.group = built.group;
    self.trail = trail;

    self.forward = function (out) {
      return (out || fwd).set(0, 0, 1).applyQuaternion(state.quat);
    };
    self.up = function (out) {
      return (out || new THREE.Vector3()).set(0, 1, 0).applyQuaternion(state.quat);
    };
    self.right = function (out) {
      return (out || new THREE.Vector3()).set(1, 0, 0).applyQuaternion(state.quat);
    };

    // input: { pitch, yaw, roll, throttleDelta, boost, brake, pulse, strafe }
    self.update = function (dt, input, externalAccel, allowPulse) {
      // --- attitude ---------------------------------------------------------
      const agility = 1.0 - 0.55 * state.pulse;
      const target = new THREE.Vector3(
        input.pitch * 1.5 * agility,
        input.yaw * 1.3 * agility,
        input.roll * 2.2 * agility
      );
      state.angVel.x = U.damp(state.angVel.x, target.x, 7.5, dt);
      state.angVel.y = U.damp(state.angVel.y, target.y, 7.5, dt);
      state.angVel.z = U.damp(state.angVel.z, target.z, 6.0, dt);

      tmpE.set(state.angVel.x * dt, state.angVel.y * dt, state.angVel.z * dt, 'XYZ');
      tmpQ.setFromEuler(tmpE);
      state.quat.multiply(tmpQ).normalize();

      // --- throttle ---------------------------------------------------------
      state.throttle = U.clamp(state.throttle + input.throttleDelta * dt * 0.85, 0, 1);
      state.boost = U.damp(state.boost, input.boost ? 1 : 0, 4.0, dt);

      const wantPulse = input.pulse && allowPulse && state.throttle > 0.05;
      state.pulse = U.clamp(state.pulse + (wantPulse ? dt / PULSE_RAMP : -dt / 0.5), 0, 1);

      const cruise = MAX_CRUISE * (1 + state.boost * (BOOST_MULT - 1));
      const speedTarget = state.throttle * U.lerp(cruise, PULSE_SPEED, Math.pow(state.pulse, 2.0));

      self.forward(fwd);
      desired.copy(fwd).multiplyScalar(speedTarget);

      // Lateral thrusters.
      if (input.strafeX || input.strafeY) {
        const r = self.right(new THREE.Vector3()).multiplyScalar(input.strafeX * cruise * 0.45);
        const u = self.up(new THREE.Vector3()).multiplyScalar(input.strafeY * cruise * 0.45);
        desired.add(r).add(u);
      }

      // Engines can only change velocity so fast; the pulse drive cheats.
      const accel = U.lerp(2.4, 12.0, state.pulse);
      state.vel.lerp(desired, 1 - Math.exp(-accel * dt));

      if (input.brake) state.vel.multiplyScalar(Math.exp(-2.6 * dt));

      if (externalAccel) state.vel.addScaledVector(externalAccel, dt);

      state.pos.addScaledVector(state.vel, dt);
      state.speed = state.vel.length();

      built.group.position.copy(state.pos);
      built.group.quaternion.copy(state.quat);

      // --- engine visuals ---------------------------------------------------
      const power = U.clamp(state.throttle * (0.35 + state.boost * 0.5 + state.pulse * 0.9), 0, 1.6);
      for (const e of built.engines) {
        e.scale.set(0.6 + power * 0.9, 0.5 + power * 2.6, 0.6 + power * 0.9);
      }
      built.glowMat.opacity = 0.25 + power * 0.7;
      const hot = state.pulse > 0.2;
      built.glowMat.color.setRGB(hot ? 1.0 : 0.4, hot ? 0.75 : 0.78, 1.0);

      updateTrail(dt, power);
      return state;
    };

    const emitPos = new THREE.Vector3();
    function updateTrail(dt, power) {
      const ageAttr = trail.geo.attributes.aAge.array;
      const posAttr = trail.geo.attributes.position.array;
      const rndAttr = trail.geo.attributes.aRnd.array;
      for (let i = 0; i < trail.COUNT; i++) ageAttr[i] += dt;

      const emits = Math.min(8, Math.floor(power * 7) + (power > 0.02 ? 1 : 0));
      for (let e = 0; e < emits; e++) {
        const i = trail.cursor;
        trail.cursor = (trail.cursor + 1) % trail.COUNT;
        const bell = built.engines[e % built.engines.length];
        emitPos.copy(bell.position).applyQuaternion(state.quat).add(state.pos);
        emitPos.x += (Math.random() - 0.5) * 0.6;
        emitPos.y += (Math.random() - 0.5) * 0.6;
        emitPos.z += (Math.random() - 0.5) * 0.6;
        posAttr[i * 3] = emitPos.x; posAttr[i * 3 + 1] = emitPos.y; posAttr[i * 3 + 2] = emitPos.z;
        ageAttr[i] = 0;
        rndAttr[i] = 0.4 + Math.random() * 0.6;
      }
      trail.geo.attributes.position.needsUpdate = true;
      trail.geo.attributes.aAge.needsUpdate = true;
      trail.geo.attributes.aRnd.needsUpdate = true;
    }

    self.teleport = function (v) {
      state.pos.copy(v);
      state.vel.set(0, 0, 0);
      built.group.position.copy(v);
      // Park the trail on top of the ship so it does not stretch across space.
      const posAttr = trail.geo.attributes.position.array;
      const ageAttr = trail.geo.attributes.aAge.array;
      for (let i = 0; i < trail.COUNT; i++) {
        posAttr[i * 3] = v.x; posAttr[i * 3 + 1] = v.y; posAttr[i * 3 + 2] = v.z;
        ageAttr[i] = 999;
      }
      trail.geo.attributes.position.needsUpdate = true;
      trail.geo.attributes.aAge.needsUpdate = true;
    };

    self.lookAt = function (targetVec) {
      const m = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      m.lookAt(state.pos, targetVec, up);
      state.quat.setFromRotationMatrix(m);
      // three's lookAt points -Z at the target; the ship's nose is +Z.
      state.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      built.group.quaternion.copy(state.quat);
    };

    self.setPixelRatio = function (pr) { trail.mat.uniforms.uPixelRatio.value = pr; };
    self.setVisible = function (v) { built.group.visible = v; };

    return self;
  }

  // --- Chase / cockpit camera ----------------------------------------------
  function CameraRig(camera) {
    const self = {};
    const chaseOffset = new THREE.Vector3(0, 5.4, -31);
    const cockpitOffset = new THREE.Vector3(0, 0.62, 2.9);
    const desiredPos = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let shake = 0;
    self.mode = 'chase';
    self.fovBase = 62;

    self.update = function (dt, ship, extraFov) {
      const st = ship.state;
      const off = self.mode === 'chase' ? chaseOffset : cockpitOffset;
      desiredPos.copy(off).applyQuaternion(st.quat).add(st.pos);

      if (self.mode === 'chase') {
        // Trail the ship with a spring so hard turns read as weight.
        camera.position.lerp(desiredPos, 1 - Math.exp(-9.0 * dt));
        const lookTarget = tmp.set(0, 1.4, 26).applyQuaternion(st.quat).add(st.pos);
        const m = new THREE.Matrix4().lookAt(camera.position, lookTarget, ship.up(new THREE.Vector3()));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        camera.quaternion.slerp(q, 1 - Math.exp(-11.0 * dt));
      } else {
        camera.position.copy(desiredPos);
        camera.quaternion.copy(st.quat);
        camera.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      }

      if (shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        camera.position.z += (Math.random() - 0.5) * shake;
        shake *= Math.exp(-3.0 * dt);
      }

      const speedFov = U.clamp(st.speed / 2400, 0, 1) * 16 + st.pulse * 12;
      camera.fov = U.damp(camera.fov, self.fovBase + speedFov + (extraFov || 0), 3.5, dt);
      camera.updateProjectionMatrix();
    };

    // Cut, don't drift: on arrival the camera must already be in place.
    self.snap = function (ship) {
      const st = ship.state;
      const off = self.mode === 'chase' ? chaseOffset : cockpitOffset;
      camera.position.copy(off).applyQuaternion(st.quat).add(st.pos);
      const lookTarget = tmp.set(0, 1.4, 26).applyQuaternion(st.quat).add(st.pos);
      const m = new THREE.Matrix4().lookAt(camera.position, lookTarget, ship.up(new THREE.Vector3()));
      camera.quaternion.setFromRotationMatrix(m);
      camera.updateMatrixWorld();
    };

    self.punch = function (amount) { shake = Math.max(shake, amount); };
    self.toggle = function () {
      self.mode = self.mode === 'chase' ? 'cockpit' : 'chase';
      return self.mode;
    };
    return self;
  }

  global.SHIP = { Ship, CameraRig, MAX_CRUISE, PULSE_SPEED };
})(window);
