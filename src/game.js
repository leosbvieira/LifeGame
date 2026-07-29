/* =========================================================================
   THE LONG QUIET — game.js
   Boot, state, input, the loop, and the long fall toward the centre.
   ========================================================================= */
(function (global) {
  'use strict';

  const JUMP_RANGE = 460;          // galactic units reachable in one warp
  const SCAN_TIME = 2.4;           // seconds to complete a survey
  const SAVE_KEY = 'long-quiet-save-v1';

  // --- Renderer -------------------------------------------------------------
  const canvas = U.el('gl');
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, powerPreference: 'high-performance',
    logarithmicDepthBuffer: true, stencil: false
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // composite does the gamma
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.6, 3.0e6);
  scene.add(new THREE.AmbientLight(0x2a3646, 0.55));

  // Point lights fall off long before they reach the ship at interplanetary
  // range, so the star is faked as a directional light that is re-aimed at the
  // ship every frame. Objects near the ship are then lit as if by the star.
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
  scene.add(sunLight);
  scene.add(sunLight.target);
  // A dim fill from the camera so the hull never reads as a black cut-out.
  const fillLight = new THREE.DirectionalLight(0x9fc4ff, 0.55);
  scene.add(fillLight);
  scene.add(fillLight.target);

  const post = POST.Post(renderer, scene, camera);
  const hud = HUD.Hud();
  const chart = HUD.StarChart(U.el('mapcanvas'));

  // --- World ----------------------------------------------------------------
  const galaxy = GALAXY.build();
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const starfield = SPACE.createStarfield(GALAXY.GALAXY_SEED);
  const band = SPACE.createGalacticBand(GALAXY.GALAXY_SEED);
  skyGroup.add(starfield);
  skyGroup.add(band);

  const dust = SPACE.createDust();
  scene.add(dust);
  const warpStreaks = SPACE.createWarpStreaks();
  camera.add(warpStreaks);
  warpStreaks.position.set(0, 0, -60);
  scene.add(camera);

  const systemScene = SYSTEM.SystemScene(scene);
  const ship = SHIP.Ship(scene);
  const rig = SHIP.CameraRig(camera);
  let blackHole = null;

  // --- Game state -----------------------------------------------------------
  const G = {
    mode: 'boot',            // boot | title | fly | warp | over
    sys: null,
    target: null,
    targetIndex: -1,
    scanT: 0,
    scanning: false,
    hull: 100,
    stats: { scans: 0, logs: 0, visited: 0, logTotal: LORE.chainLength() },
    codex: [],               // recovered journal entries
    foundLogIds: {},
    chainIndex: 0,
    scannedKeys: {},
    hudHidden: false,
    time: 0,
    dilation: 1,
    fade: 0,
    warpT: 0,
    warpTarget: null,
    thoughtTimer: 40,
    ended: false,
    horizonT: 0
  };

  // --- Input ----------------------------------------------------------------
  const keys = {};
  const mouse = { dx: 0, dy: 0, locked: false, invert: false };
  let sensitivity = 0.0022;

  global.addEventListener('keydown', e => {
    if (e.repeat) return;
    keys[e.code] = true;
    onKey(e);
  });
  global.addEventListener('keyup', e => { keys[e.code] = false; });
  global.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('click', () => {
    if (G.mode === 'fly' && !anyOverlay()) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    mouse.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', e => {
    if (!mouse.locked) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  });

  function anyOverlay() {
    return ['map', 'codex', 'logview', 'pause', 'title', 'ending'].some(id => hud.isShown(id));
  }

  function onKey(e) {
    if (G.mode === 'title') {
      if (e.code === 'Enter' || e.code === 'Space') startNew();
      return;
    }
    if (G.mode !== 'fly' && G.mode !== 'warp') return;

    switch (e.code) {
      case 'KeyM':
        if (hud.isShown('logview')) return;
        toggleMap(); break;
      case 'KeyJ':
        if (hud.isShown('logview')) return;
        toggleCodex(); break;
      case 'KeyC':
        if (anyOverlay()) return;
        AUDIO.ui();
        hud.toast('view: ' + rig.toggle());
        ship.setVisible(rig.mode === 'chase');
        break;
      case 'KeyH':
        if (anyOverlay()) return;
        G.hudHidden = !G.hudHidden;
        hud.setHudHidden(G.hudHidden);
        break;
      case 'KeyT':
        if (anyOverlay()) return;
        cycleTarget(); break;
      case 'Escape':
        if (hud.isShown('logview')) { closeLog(); return; }
        if (hud.isShown('map')) { toggleMap(); return; }
        if (hud.isShown('codex')) { toggleCodex(); return; }
        togglePause();
        break;
      case 'Enter':
        if (hud.isShown('logview')) closeLog();
        else if (hud.isShown('map')) tryJump();
        break;
    }
  }

  // --- Boot sequence --------------------------------------------------------
  const BOOT_LINES = [
    'survey vessel — designation withheld',
    'reactor .............. <b>online</b>',
    'life support ......... <b>nominal</b>',
    'long-range sensors ... <b>online</b>',
    'crew ................. <b>1</b>',
    'destination .......... <b>unassigned</b>'
  ];

  function boot() {
    const el = U.el('boot-lines');
    let i = 0;
    const t = setInterval(() => {
      const d = document.createElement('div');
      d.innerHTML = BOOT_LINES[i];
      el.appendChild(d);
      i++;
      if (i >= BOOT_LINES.length) {
        clearInterval(t);
        setTimeout(() => {
          U.el('boot').classList.add('gone');
          G.mode = 'title';
          hud.show('title');
          if (localStorage.getItem(SAVE_KEY)) {
            const b = U.el('btn-continue');
            b.disabled = false; b.classList.remove('off');
          }
        }, 900);
      }
    }, 320);
  }

  // --- System entry ---------------------------------------------------------
  function sectorLabel(sys) {
    const a = Math.atan2(sys.pos.z, sys.pos.x);
    const ring = Math.floor((sys.distanceFromCore / GALAXY.RADIUS) * 5);
    const oct = Math.floor(U.mod(a + Math.PI, Math.PI * 2) / (Math.PI * 2) * 8);
    return 'R' + ring + '-' + 'ABCDEFGH'[oct] + String(sys.id % 97).padStart(2, '0');
  }

  function enterSystem(sys, keepOrientation) {
    G.sys = sys;
    if (!sys.visited) { sys.visited = true; G.stats.visited++; }

    systemScene.build(sys);
    bodyCache = null;

    if (blackHole) { blackHole.dispose(); blackHole = null; }
    if (sys.isCore) {
      blackHole = BLACKHOLE.BlackHole({ rs: 900 });
      scene.add(blackHole.group);
      blackHole.setPixelRatio(renderer.getPixelRatio());
    }

    // Arrive somewhere with a view: off to one side of the ecliptic.
    const rng = U.Rng(sys.seed + 7);
    let arrival;
    if (sys.isCore) {
      arrival = new THREE.Vector3(38000, 9000, 26000);
    } else {
      const far = systemScene.extent || 9000;
      const a = rng.range(0, Math.PI * 2);
      arrival = new THREE.Vector3(
        Math.cos(a) * far * 0.85,
        far * 0.18,
        Math.sin(a) * far * 0.85
      );
    }
    ship.teleport(arrival);
    SPACE.recentreDust(dust, arrival);

    if (!keepOrientation) {
      // Point the nose at the star (or at whatever is at the centre).
      ship.lookAt(new THREE.Vector3(0, 0, 0));
    }
    ship.state.throttle = 0;
    rig.snap(ship);

    G.target = null; G.targetIndex = -1;
    hud.setSystem(sys, sectorLabel(sys));
    updateStats();

    if (sys.isCore) {
      sunLight.color.setRGB(1.0, 0.66, 0.38);
      sunLight.intensity = 2.2;
    } else {
      sunLight.color.setRGB(sys.star.b[0], sys.star.b[1], sys.star.b[2]);
      sunLight.intensity = sys.star.cls === 'D' ? 1.1 : (sys.star.cls === 'N' ? 1.6 : 2.6);
    }

    const warmth = sys.isCore ? 0.15 : U.clamp(sys.star.r / 1.9, 0, 1);
    AUDIO.setSystemTone(sys.seed, warmth);
    AUDIO.setPad(sys.hasNebula ? 0.9 : 0.55);

    // A line on arrival — the ship talking to nobody in particular.
    setTimeout(() => {
      if (sys.isCore) {
        hud.narrate('Sagittarius. Four million suns in a space you could cross in an afternoon.', 11);
      } else {
        const rng2 = U.Rng(sys.seed + 3);
        const lines = [
          'Arrival confirmed. ' + sys.planets.length + ' bodies logged. No transmissions.',
          sys.name + '. Nobody has been here. Nobody is coming.',
          'Drive cooling. The system is quiet on every band.',
          'New star, old light. Survey window open.'
        ];
        hud.narrate(lines[Math.floor(rng2.next() * lines.length) % lines.length], 8);
      }
    }, 1200);
  }

  function updateStats() {
    G.stats.hull = G.hull;
    hud.setStats(G.stats);
  }

  // --- Targeting ------------------------------------------------------------
  // The list is rebuilt only when the system changes. It used to be rebuilt on
  // every call, which handed out a fresh black-hole object each frame — the
  // current target kept changing identity, so a scan could never finish.
  let bodyCache = null;
  let bhBody = null;

  function rebuildTargetList() {
    bodyCache = systemScene.bodies.filter(b => !b.noNav);
    if (blackHole) {
      bhBody = {
        obj: blackHole.group, name: 'SGR-X — event horizon', type: 'blackhole',
        radius: blackHole.rs, scannable: true, scanned: false,
        desc: 'A hole in the sky the size of a solar system. It is not an object. ' +
              'It is a boundary, and everything here is on its way across.',
        hazard: blackHole.rs * 1.02, signal: false
      };
      bodyCache.push(bhBody);
    } else {
      bhBody = null;
    }
  }

  function targetables() {
    if (!bodyCache) rebuildTargetList();
    return bodyCache;
  }

  function cycleTarget() {
    const list = targetables();
    if (!list.length) return;
    const wp = new THREE.Vector3();
    const scored = list.map(b => {
      b.obj.getWorldPosition(wp);
      return { b: b, d: wp.distanceTo(ship.state.pos) };
    }).sort((a, b) => a.d - b.d);
    G.targetIndex = (G.targetIndex + 1) % scored.length;
    G.target = scored[G.targetIndex].b;
    AUDIO.ui();
    hud.toast('target: ' + G.target.name);
  }

  const wpTmp = new THREE.Vector3();
  function targetWorldPos(b) {
    b.obj.getWorldPosition(wpTmp);
    return wpTmp;
  }

  // --- Scanning -------------------------------------------------------------
  function scanRange(b) { return Math.max(1200, b.radius * 14); }

  function completeScan(b) {
    const key = G.sys.id + ':' + b.name;
    if (!G.scannedKeys[key]) {
      G.scannedKeys[key] = true;
      G.stats.scans++;
      b.scanned = true;
      if (b.data) b.data.scanned = true;
      G.codex.push({
        title: b.name,
        sub: G.sys.name + ' · ' + (b.kind || b.type) + ' · sector ' + sectorLabel(G.sys),
        body: b.desc + '\n\n' + surveyBlock(b)
      });
      AUDIO.discovery();
      hud.toast('surveyed: ' + b.name);
    }

    // Some things carry a voice as well as a spectrum.
    if (b.signal && !b.signalTaken) {
      b.signalTaken = true;
      deliverSignal(b);
    }
    updateStats();
  }

  function surveyBlock(b) {
    const rng = U.Rng(G.sys.seed + b.name);
    const rows = [];
    rows.push('radius ......... ' + Math.round(b.radius) + ' u');
    if (b.type === 'planet' || b.type === 'moon') {
      rows.push('gravity ........ ' + (0.2 + rng.next() * 2.4).toFixed(2) + ' g');
      rows.push('atmosphere ..... ' + (['none', 'trace', 'thin', 'dense', 'crushing'][rng.int(0, 4)]));
      rows.push('surface temp ... ' + Math.round(rng.range(-220, 640)) + ' °c');
      rows.push('biosignature ... ' + (b.kind === 'verdant' ? 'positive' : (rng.chance(0.08) ? 'inconclusive' : 'negative')));
    } else if (b.type === 'star') {
      rows.push('class .......... ' + b.kind);
      rows.push('output ......... ' + (rng.range(0.02, 60)).toFixed(2) + ' L☉');
    }
    rows.push('logged ......... survey entry ' + String(G.stats.scans).padStart(4, '0'));
    return rows.join('\n');
  }

  function deliverSignal(b) {
    let entry;
    if (b.type === 'anomaly' || (b.type === 'derelict' && G.chainIndex < LORE.chainLength())) {
      // The chain advances first; drift logs fill the gaps.
      entry = LORE.chainEntry(G.chainIndex);
      if (!G.foundLogIds[entry.id]) {
        G.chainIndex++;
        G.stats.logs++;
      } else {
        entry = LORE.driftEntry(U.Rng(G.sys.seed + b.name));
      }
      G.foundLogIds[entry.id] = true;
    } else {
      entry = LORE.driftEntry(U.Rng(G.sys.seed + b.name));
    }
    G.codex.push({
      title: entry.title,
      sub: entry.from + ' · recovered in ' + G.sys.name,
      body: entry.body.join('\n')
    });
    AUDIO.logFound();
    setTimeout(() => {
      hud.showLog(entry);
      if (mouse.locked) document.exitPointerLock();
    }, 500);

    if (G.stats.logs >= 4 && !G.coreUnlocked) {
      G.coreUnlocked = true;
      setTimeout(() => hud.toast('core coordinates resolved — long jump available', true), 2600);
    }
  }

  function closeLog() {
    hud.finishLogTyping();
    hud.hide('logview');
    if (G.mode === 'fly') canvas.requestPointerLock();
  }

  // --- Warp -----------------------------------------------------------------
  function canJump(sys) {
    if (!sys || sys === G.sys) return false;
    if (sys.isCore) return !!G.coreUnlocked;
    const d = dist3(sys.pos, G.sys.pos);
    return d <= JUMP_RANGE;
  }

  function dist3(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function tryJump() {
    const sel = chart.selected();
    if (!canJump(sel)) { AUDIO.deny(); hud.toast('out of range', true); return; }
    hud.hide('map');
    G.mode = 'warp';
    G.warpT = 0;
    G.warpTarget = sel;
    AUDIO.confirm();
    AUDIO.warpCharge(2.6);
    hud.toast('warp: ' + (sel.isCore ? 'THE CORE' : (sel.visited ? sel.name : 'unsurveyed system')));
    canvas.requestPointerLock();
  }

  function updateWarp(dt) {
    G.warpT += dt;
    const charge = U.clamp(G.warpT / 2.6, 0, 1);
    post.uniforms.uWarp.value = Math.pow(charge, 2.2) * 3.2;
    post.uniforms.uChroma.value = 0.3 + charge * 3.5;
    SPACE.updateWarpStreaks(warpStreaks, dt, Math.pow(charge, 2.0));
    rig.fovBase = 62 + charge * 34;

    if (G.warpT > 2.6 && !G.warpDone) {
      G.warpDone = true;
      AUDIO.warpBoom();
      post.uniforms.uFade.value = 1;
      enterSystem(G.warpTarget, false);
      chart.setCurrent(G.warpTarget);
      save();
    }
    if (G.warpDone) {
      post.uniforms.uFade.value = Math.max(0, post.uniforms.uFade.value - dt * 0.9);
      post.uniforms.uWarp.value *= Math.exp(-6 * dt);
      SPACE.updateWarpStreaks(warpStreaks, dt, Math.max(0, 1 - (G.warpT - 2.6) * 2));
      if (G.warpT > 3.8) {
        G.mode = 'fly';
        G.warpDone = false;
        post.uniforms.uWarp.value = 0;
        post.uniforms.uChroma.value = 0.3;
        post.uniforms.uFade.value = 0;
        rig.fovBase = 62;
        warpStreaks.visible = false;
      }
    }
  }

  // --- Overlays -------------------------------------------------------------
  function toggleMap() {
    if (hud.isShown('map')) {
      hud.hide('map');
      if (G.mode === 'fly') canvas.requestPointerLock();
    } else {
      hud.show('map');
      chart.attach(galaxy, G.sys, JUMP_RANGE, onChartSelect);
      chart.resize();
      if (mouse.locked) document.exitPointerLock();
      AUDIO.ui();
    }
  }

  function onChartSelect(sys) {
    const d = dist3(sys.pos, G.sys.pos);
    U.el('map-name').textContent = sys.visited || sys.isCore ? sys.name : 'unsurveyed';
    U.el('map-class').textContent = sys.isCore ? 'supermassive' : (sys.visited ? sys.star.cls + ' ' + sys.star.label : '—');
    U.el('map-bodies').textContent = sys.visited ? sys.planets.length : '?';
    U.el('map-dist').textContent = d < 1 ? 'here' : d.toFixed(0) + ' ly';
    const ok = canJump(sys);
    U.el('map-status').textContent = sys === G.sys ? 'current' : (ok ? 'in range' : 'out of range');
    U.el('map-status').style.color = ok ? 'var(--ok)' : 'var(--warn)';
    U.el('btn-jump').classList.toggle('off', !ok);
    U.el('map-note').textContent = sys.isCore
      ? (G.coreUnlocked
        ? 'Coordinates resolved. The long jump can be made from anywhere. It is a one-way distance for most ships.'
        : 'The instruments lean this way but the approach vector is not resolved. Recover more signals.')
      : (sys.visited ? 'Previously surveyed.' : 'No survey on record. Whatever is there has not been named.');
    AUDIO.ui();
  }

  function toggleCodex() {
    if (hud.isShown('codex')) {
      hud.hide('codex');
      if (G.mode === 'fly') canvas.requestPointerLock();
    } else {
      hud.renderCodex(G.codex.slice().reverse(), e => hud.showCodexEntry(e));
      hud.show('codex');
      if (mouse.locked) document.exitPointerLock();
      AUDIO.ui();
    }
  }

  function togglePause() {
    if (hud.isShown('pause')) {
      hud.hide('pause');
      if (G.mode === 'fly') canvas.requestPointerLock();
    } else {
      hud.show('pause');
      if (mouse.locked) document.exitPointerLock();
    }
  }

  // --- Save / load ----------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        sysId: G.sys.id,
        hull: G.hull,
        stats: G.stats,
        codex: G.codex,
        chainIndex: G.chainIndex,
        foundLogIds: G.foundLogIds,
        scannedKeys: G.scannedKeys,
        coreUnlocked: !!G.coreUnlocked,
        visited: galaxy.systems.filter(s => s.visited).map(s => s.id)
      }));
    } catch (e) { /* private mode, no save. The voyage is the same either way. */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function startNew() {
    hud.hide('title');
    AUDIO.init();
    AUDIO.resume();
    G.mode = 'fly';
    hud.setHudVisible(true);
    enterSystem(galaxy.start, false);
    canvas.requestPointerLock();
    setTimeout(() => hud.narrate(
      'Eleven years out. The survey program that sent you stopped answering four years ago.', 11), 4000);
  }

  function startContinue() {
    const s = load();
    if (!s) return startNew();
    hud.hide('title');
    AUDIO.init(); AUDIO.resume();
    G.hull = s.hull != null ? s.hull : 100;
    G.stats = Object.assign(G.stats, s.stats || {});
    G.stats.logTotal = LORE.chainLength();
    G.codex = s.codex || [];
    G.chainIndex = s.chainIndex || 0;
    G.foundLogIds = s.foundLogIds || {};
    G.scannedKeys = s.scannedKeys || {};
    G.coreUnlocked = !!s.coreUnlocked;
    (s.visited || []).forEach(id => { const sy = galaxy.systems[id]; if (sy) sy.visited = true; });
    G.stats.visited = galaxy.systems.filter(x => x.visited).length;
    G.mode = 'fly';
    hud.setHudVisible(true);
    enterSystem(galaxy.systems[s.sysId] || galaxy.start, false);
    canvas.requestPointerLock();
  }

  // --- Ending ---------------------------------------------------------------
  const ENDING_TEXT =
    'You cross the horizon at 06:41 ship time.\n\n' +
    'Nothing happens. That is the part nobody could tell you.\n' +
    'No wall, no sound, no moment of arrival — only the sky behind you\n' +
    'closing into a single bright point, and then not even that.\n\n' +
    'The clock on the console keeps counting. It has stopped meaning\n' +
    'anything to anyone but you.\n\n' +
    'Somewhere far above, in a galaxy that will spend the next hundred\n' +
    'million years exactly as it was, your last transmission is still\n' +
    'travelling outward — nine words, sent to no one in particular:\n\n' +
    '        it was worth the distance. keep going.\n';

  function crossHorizon() {
    if (G.ended) return;
    G.ended = true;
    G.mode = 'over';
    if (mouse.locked) document.exitPointerLock();
    AUDIO.setRumble(1);
    AUDIO.warpBoom();
    hud.setHudVisible(false);
    hud.clearMarkers();
    setTimeout(() => {
      hud.showEnding(ENDING_TEXT, () => {
        const b = document.createElement('button');
        b.className = 'btn primary';
        b.textContent = 'Begin again';
        b.style.marginTop = '30px';
        b.onclick = () => location.reload();
        U.el('ending-text').parentElement.appendChild(b);
      });
    }, 2200);
  }

  // --- Damage ---------------------------------------------------------------
  function damage(amount, reason) {
    G.hull -= amount;
    rig.punch(Math.min(2.2, amount * 0.3));
    AUDIO.impact(Math.min(1, amount / 20));
    if (G.hull <= 0) {
      G.hull = 45;
      hud.toast('hull breach — emergency systems engaged', true);
      hud.narrate('Something gave. The ship holds together out of habit. ' +
        'You are still here, which is the only measurement that matters.', 9);
      // Push clear of whatever hit you (a dead-stopped ship has no direction
      // to be pushed along, so fall back to straight up).
      ship.state.vel.multiplyScalar(-0.35);
      const away = ship.state.vel.lengthSq() > 0.0001
        ? ship.state.vel.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      ship.state.pos.addScaledVector(away, 400);
    }
    updateStats();
  }

  // --- Main loop ------------------------------------------------------------
  const clock = new THREE.Clock();
  const gravAccel = new THREE.Vector3();
  const projV = new THREE.Vector3();
  const dirTmp = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    // Clamped so a stalled tab cannot teleport the ship through a planet.
    // Generous enough that a slow machine still runs at something like real time.
    let dt = Math.min(clock.getDelta(), 0.1);
    updateQuality(dt);
    if (G.mode === 'boot' || G.mode === 'title') {
      G.time += dt;
      idleRender(dt);
      return;
    }
    if (anyOverlay() && G.mode !== 'warp') {
      // Paused: the galaxy waits. The chart still animates.
      if (hud.isShown('map')) chart.draw(G.time);
      G.time += dt * 0.2;
      systemScene.update(G.time, dt * 0.2, camera);
      if (blackHole) blackHole.update(G.time, dt * 0.2, camera);
      renderFrame();
      return;
    }

    const simDt = dt * G.dilation;
    G.time += simDt;

    // --- input ------------------------------------------------------------
    const input = {
      pitch: 0, yaw: 0, roll: 0, throttleDelta: 0,
      boost: !!keys.ShiftLeft || !!keys.ShiftRight,
      brake: !!keys.Space, pulse: !!keys.KeyX,
      strafeX: 0, strafeY: 0
    };
    if (mouse.locked) {
      input.pitch = U.clamp(-mouse.dy * sensitivity, -1, 1) * (mouse.invert ? -1 : 1);
      input.yaw = U.clamp(-mouse.dx * sensitivity, -1, 1);
    }
    mouse.dx *= 0.0; mouse.dy *= 0.0;
    if (keys.KeyW) input.throttleDelta += 1;
    if (keys.KeyS) input.throttleDelta -= 1;
    if (keys.KeyA) input.roll += 1;
    if (keys.KeyD) input.roll -= 1;
    if (keys.KeyQ) input.strafeX -= 1;
    if (keys.KeyE) input.strafeX += 1;
    if (keys.KeyR) input.strafeY += 1;
    if (keys.KeyV) input.strafeY -= 1;

    // --- mass lock: the pulse drive will not engage near a gravity well ----
    let nearest = null, nearestSurf = Infinity;
    for (const b of targetables()) {
      const p = targetWorldPos(b);
      const d = p.distanceTo(ship.state.pos) - b.radius;
      if (d < nearestSurf) { nearestSurf = d; nearest = b; }
    }
    const massLocked = nearestSurf < (nearest ? Math.max(2500, nearest.radius * 6) : 2500);

    // --- gravity ------------------------------------------------------------
    gravAccel.set(0, 0, 0);
    let holeDist = Infinity;
    if (blackHole) {
      holeDist = blackHole.distanceTo(ship.state.pos);
      blackHole.gravityAt(ship.state.pos, gravAccel);
      // Time runs slower the deeper you are. Sim slows with it.
      const rr = U.clamp(holeDist / (blackHole.rs * 6), 0, 1);
      G.dilation = U.damp(G.dilation, 0.25 + 0.75 * Math.pow(rr, 0.6), 2.0, dt);
    } else {
      G.dilation = U.damp(G.dilation, 1, 2.0, dt);
    }

    if (G.mode === 'warp') {
      updateWarp(dt);
    }

    ship.update(simDt, input, gravAccel, !massLocked && G.mode === 'fly');

    // --- collisions ---------------------------------------------------------
    if (G.mode === 'fly') {
      for (const b of targetables()) {
        if (!b.hazard) continue;
        const p = targetWorldPos(b);
        const d = p.distanceTo(ship.state.pos);
        if (b.type === 'blackhole') continue;
        if (d < b.hazard) {
          // Bounce off the surface and take a knock.
          dirTmp.copy(ship.state.pos).sub(p).normalize();
          ship.state.pos.copy(p).addScaledVector(dirTmp, b.hazard + 2);
          const impact = ship.state.vel.length();
          ship.state.vel.reflect(dirTmp).multiplyScalar(0.28);
          damage(U.clamp(impact * 0.02, 2, 26), 'impact');
          hud.toast('impact — ' + b.name, true);
        } else if (b.type === 'star' && d < b.radius * 4.2) {
          damage(24 * simDt, 'heat');
        }
      }
    }

    // --- black hole hazards -------------------------------------------------
    const warnings = [];
    if (blackHole) {
      const rs = blackHole.rs;
      AUDIO.setRumble(U.clamp(1 - holeDist / (rs * 18), 0, 1));
      if (holeDist < rs * 9) warnings.push('gravitational shear');
      if (holeDist < rs * 4.5) {
        warnings.push('time dilation ' + (1 / G.dilation).toFixed(2) + '×');
        damage(8 * dt, 'tidal');
      }
      if (holeDist < rs * 1.35 && !G.ended) {
        warnings.push('event horizon');
        G.horizonT += dt;
      }
      if (holeDist < rs * 1.02) crossHorizon();
      post.uniforms.uHoleVisible.value = 1;
      const hp = blackHole.group.position;
      projV.copy(hp).project(camera);
      const onScreen = projV.z < 1;
      post.uniforms.uHolePos.value.set((projV.x + 1) / 2, (projV.y + 1) / 2);
      // Angular size of the shadow, in screen-height units.
      const ang = Math.atan2(rs * 1.35, Math.max(holeDist, rs));
      const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
      post.uniforms.uHoleRadius.value = U.clamp(ang / halfFov * 0.5, 0.004, 1.4);
      post.uniforms.uHoleStrength.value = onScreen ? 1.5 : 0.0;
      post.uniforms.uHoleVisible.value = onScreen ? 1 : 0;
    } else {
      AUDIO.setRumble(0);
      post.uniforms.uHoleVisible.value = 0;
    }

    if (massLocked && keys.KeyX) warnings.push('mass lock — pulse drive held');
    if (G.hull < 40) warnings.push('hull integrity ' + Math.round(G.hull) + '%');
    hud.setWarnings(warnings);

    // --- targeting & scanning ----------------------------------------------
    updateTargeting(dt);

    // --- world update -------------------------------------------------------
    systemScene.update(G.time, simDt, camera);
    if (blackHole) blackHole.update(G.time, simDt, camera);
    rig.update(dt, ship, 0);

    // Re-aim the star: it always shines from the system centre outward.
    sunLight.target.position.copy(ship.state.pos);
    sunLight.position.copy(ship.state.pos).multiplyScalar(0.0001);
    if (sunLight.position.lengthSq() < 1) sunLight.position.set(0, 1, 0);
    fillLight.target.position.copy(ship.state.pos);
    fillLight.position.copy(camera.position).sub(ship.state.pos)
      .normalize().multiplyScalar(50).add(ship.state.pos);

    skyGroup.position.copy(camera.position);
    SPACE.updateDust(dust, ship.state.pos);
    dust.material.uniforms.uSpeed.value = ship.state.speed;

    starfield.material.uniforms.uTime.value = G.time;

    // --- audio / hud --------------------------------------------------------
    AUDIO.setEngine(ship.state.throttle, ship.state.speed);
    const mode = ship.state.pulse > 0.5 ? 'pulse' : (ship.state.boost > 0.5 ? 'boost' : 'impulse');
    hud.setDrive(ship.state.throttle, ship.state.speed, mode, ship.state.pulse);

    // Ambient thought, occasionally, when nothing else is happening.
    G.thoughtTimer -= dt;
    if (G.thoughtTimer <= 0) {
      G.thoughtTimer = 75 + Math.random() * 90;
      if (!anyOverlay() && ship.state.speed > 20) {
        hud.narrate(LORE.thought(U.Rng(Math.floor(G.time * 13))), 9);
      }
    }

    // Post feel: subtle shake at speed, more grain in the dark.
    post.uniforms.uShake.value = U.clamp(ship.state.speed / 260000, 0, 0.0022) +
      (blackHole ? U.clamp(1 - holeDist / (blackHole.rs * 6), 0, 1) * 0.004 : 0);
    post.uniforms.uVignette.value = 0.75 + (1 - G.dilation) * 0.9;
    post.uniforms.uExposure.value = 1.15;

    renderFrame();
  }

  function renderFrame() {
    post.render(G.time);
  }

  // Slow drift behind the title screen.
  const titleCamTarget = new THREE.Vector3();
  function idleRender(dt) {
    camera.position.set(
      Math.cos(G.time * 0.05) * 2600,
      460 + Math.sin(G.time * 0.03) * 260,
      Math.sin(G.time * 0.05) * 2600
    );
    camera.lookAt(titleCamTarget.set(0, 0, 0));
    camera.updateProjectionMatrix();
    if (G.sys) systemScene.update(G.time, dt, camera);
    skyGroup.position.copy(camera.position);
    starfield.material.uniforms.uTime.value = G.time;
    renderFrame();
  }

  // --- Targeting / markers --------------------------------------------------
  const fwdTmp = new THREE.Vector3();
  function updateTargeting(dt) {
    const list = targetables();
    const shipPos = ship.state.pos;
    ship.forward(fwdTmp);

    // Auto-acquire whatever is closest to the crosshair if nothing is targeted.
    if (!G.target || list.indexOf(G.target) === -1) {
      let best = null, bestScore = -1;
      for (const b of list) {
        const p = targetWorldPos(b);
        dirTmp.copy(p).sub(shipPos);
        const d = dirTmp.length();
        dirTmp.divideScalar(d || 1);
        const align = dirTmp.dot(fwdTmp);
        const score = align > 0.92 ? align / Math.max(1, d * 0.00002) : -1;
        if (score > bestScore) { bestScore = score; best = b; }
      }
      G.target = best;
    }

    let tgtDist = null;
    if (G.target) {
      const p = targetWorldPos(G.target);
      tgtDist = p.distanceTo(shipPos);
      dirTmp.copy(p).sub(shipPos).normalize();
      const aligned = dirTmp.dot(fwdTmp) > 0.985;
      const inRange = tgtDist < scanRange(G.target) + G.target.radius;
      const canScan = G.target.scannable && !G.target.scanned && inRange && aligned;

      hud.setReticleLock(aligned && inRange);
      hud.setTarget(
        G.target.name, tgtDist,
        G.target.scanned ? 'surveyed' : (canScan ? 'ready to scan [F]' : (inRange ? 'align to scan' : 'out of scan range'))
      );

      if (keys.KeyF && canScan) {
        G.scanning = true;
        G.scanT += dt;
        if (Math.floor(G.scanT * 8) !== Math.floor((G.scanT - dt) * 8)) AUDIO.scanTick();
        hud.setScan(true, G.scanT / SCAN_TIME, 'SCANNING ' + G.target.name.toUpperCase());
        if (G.scanT >= SCAN_TIME) {
          G.scanT = 0; G.scanning = false;
          hud.setScan(false, 0);
          completeScan(G.target);
          save();
        }
      } else {
        if (G.scanning) { G.scanT = Math.max(0, G.scanT - dt * 2); }
        if (G.scanT <= 0.01) { G.scanning = false; hud.setScan(false, 0); }
        else hud.setScan(true, G.scanT / SCAN_TIME, 'SCAN INTERRUPTED');
      }
    } else {
      hud.setTarget(null, null, null);
      hud.setReticleLock(false);
      hud.setScan(false, 0);
    }

    // Markers. Distant bodies pile up into an unreadable heap near the star,
    // so anything that lands on top of an already-placed label is dropped.
    // The current target is placed first and never suppressed.
    if (G.hudHidden) { hud.clearMarkers(); return; }
    hud.beginMarkers();
    const w = global.innerWidth, h = global.innerHeight;
    const placed = [];
    const ordered = G.target ? [G.target].concat(list.filter(b => b !== G.target)) : list;
    for (const b of ordered) {
      const p = targetWorldPos(b);
      projV.copy(p).project(camera);
      if (projV.z > 1) continue;
      const x = (projV.x + 1) / 2 * w;
      const y = (1 - projV.y) / 2 * h;
      if (x < -60 || x > w + 60 || y < -40 || y > h + 40) continue;
      const isTarget = b === G.target;
      const signal = b.signal && !b.signalTaken;
      if (!isTarget) {
        let clash = false;
        for (const q of placed) {
          if (Math.abs(q.x - x) < 96 && Math.abs(q.y - y) < 34) { clash = true; break; }
        }
        if (clash) continue;
      }
      placed.push({ x: x, y: y });
      const d = p.distanceTo(shipPos);
      hud.marker(x, y, b.type === 'derelict' && !b.scanned ? 'signal' : b.name,
        d, signal ? 'signal' : 'body', isTarget);
    }
    hud.endMarkers();
  }

  // --- Resize / adaptive quality --------------------------------------------
  // The planet and disk shaders are fill-rate hungry. Rather than ask the
  // player to pick a quality setting, watch the frame time and quietly scale
  // the render resolution between 55% and 100%.
  const quality = { scale: 1, avg: 1 / 60, cooldown: 3 };

  function updateQuality(dt) {
    quality.avg = quality.avg * 0.93 + dt * 0.07;
    quality.cooldown -= dt;
    if (quality.cooldown > 0) return;
    if (quality.avg > 1 / 28 && quality.scale > 0.55) {
      quality.scale = Math.max(0.55, quality.scale - 0.15);
      resize(); quality.cooldown = 3;
    } else if (quality.avg < 1 / 55 && quality.scale < 1) {
      quality.scale = Math.min(1, quality.scale + 0.1);
      resize(); quality.cooldown = 5;
    }
  }

  function resize() {
    const w = global.innerWidth, h = global.innerHeight;
    const pr = Math.min(global.devicePixelRatio || 1, 1.75) * quality.scale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.setSize(w, h, pr);
    starfield.material.uniforms.uPixelRatio.value = pr;
    dust.material.uniforms.uPixelRatio.value = pr;
    ship.setPixelRatio(pr);
    if (blackHole) blackHole.setPixelRatio(pr);
    chart.resize();
  }
  global.addEventListener('resize', resize);

  // --- UI wiring ------------------------------------------------------------
  U.el('btn-begin').onclick = () => { AUDIO.init(); startNew(); };
  U.el('btn-continue').onclick = () => { AUDIO.init(); startContinue(); };
  U.el('btn-jump').onclick = tryJump;
  U.el('btn-map-close').onclick = toggleMap;
  U.el('btn-codex-close').onclick = toggleCodex;
  U.el('btn-log-close').onclick = closeLog;
  U.el('btn-resume').onclick = togglePause;
  U.el('btn-save').onclick = () => { save(); hud.toast('voyage recorded'); AUDIO.confirm(); };
  U.el('btn-mute').onclick = () => {
    const m = AUDIO.toggleMute();
    U.el('btn-mute').textContent = 'Sound: ' + (m ? 'off' : 'on');
  };
  U.el('btn-quit').onclick = () => { save(); location.reload(); };

  // Chart needs a redraw whenever it is open, even while paused.
  setInterval(() => { if (hud.isShown('map')) chart.draw(U.now()); }, 33);

  resize();
  boot();
  frame();

  // Expose a little of the machine for the curious (and for testing).
  global.LQ = {
    G, galaxy, ship, systemScene, scene, camera, renderer, post, hud,
    goto: function (nameOrId) {
      const s = typeof nameOrId === 'number'
        ? galaxy.systems[nameOrId]
        : galaxy.systems.find(x => x.name === nameOrId);
      if (s) { enterSystem(s, false); chart.setCurrent(s); }
      return s && s.name;
    },
    get blackHole() { return blackHole; },
    // Park the ship a given number of radii from a body, on its lit side.
    park: function (name, radii, elevation) {
      const all = targetables();
      const b = all.find(x => x.name === name) ||
                all.find(x => x.name.indexOf(name) === 0) || all[0];
      if (!b) return null;
      const wp = targetWorldPos(b).clone();
      const sunward = wp.lengthSq() > 1 ? wp.clone().normalize().negate() : new THREE.Vector3(0, 0, -1);
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(sunward, up).normalize();
      const off = sunward.multiplyScalar(b.radius * (radii || 3))
        .addScaledVector(side, b.radius * (radii || 3) * 0.55)
        .addScaledVector(up, b.radius * (elevation == null ? 0.35 : elevation));
      ship.teleport(wp.clone().add(off));
      ship.lookAt(wp);
      rig.snap(ship);
      G.target = b;
      return b.name;
    }
  };
})(window);
