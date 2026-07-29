/* =========================================================================
   THE LONG QUIET — hud.js
   Everything the pilot can read: instruments, markers, the star chart,
   and the journal of what has been recovered so far.
   ========================================================================= */
(function (global) {
  'use strict';

  const $ = U.el;

  function Hud() {
    const self = {};
    const markerPool = [];
    const markersEl = $('markers');
    let markerUsed = 0;

    // --- Instruments --------------------------------------------------------
    self.setSystem = function (sys, sectorLabel) {
      $('sys-name').textContent = sys.name;
      $('sys-class').textContent = sys.isCore ? 'SGR-X / supermassive' : sys.star.cls + ' — ' + sys.star.label;
      $('sys-bodies').textContent = sys.planets.length;
      $('sys-core').textContent = (sys.distanceFromCore / 1000).toFixed(2) + ' kly';
      $('sys-sector').textContent = sectorLabel;
    };

    self.setStats = function (st) {
      $('st-scans').textContent = st.scans;
      $('st-logs').textContent = st.logs + ' / ' + st.logTotal;
      $('st-visited').textContent = st.visited;
      $('st-hull').textContent = Math.max(0, Math.round(st.hull)) + '%';
      $('st-hull').style.color = st.hull < 40 ? 'var(--warn)' : 'var(--paper)';
    };

    self.setDrive = function (throttle, speed, mode, pulse) {
      const bar = $('dr-bar');
      bar.firstElementChild.style.width = (throttle * 100).toFixed(0) + '%';
      bar.classList.toggle('pulse', pulse > 0.05);
      $('dr-thr').textContent = Math.round(throttle * 100) + '%';
      $('dr-speed').textContent = speed < 10000
        ? Math.round(speed) + ' u/s'
        : (speed / 1000).toFixed(1) + ' ku/s';
      $('dr-mode').textContent = mode;
      $('dr-mode').style.color = pulse > 0.05 ? 'var(--amber)' : 'var(--paper)';
    };

    self.setTarget = function (name, dist, state) {
      $('tg-name').textContent = name || 'none';
      $('tg-dist').textContent = dist == null ? '—' : U.formatDistance(dist);
      $('tg-state').textContent = state || '—';
      $('tg-state').style.color = state === 'surveyed' ? 'var(--ok)'
        : state === 'signal' ? 'var(--amber)' : 'var(--paper)';
    };

    self.setReticleLock = function (locked) {
      $('reticle').classList.toggle('locked', !!locked);
    };

    // --- Scan ring ----------------------------------------------------------
    const CIRC = 377;
    self.setScan = function (active, progress, label) {
      const s = $('scan');
      s.classList.toggle('on', !!active);
      if (active) {
        $('scan-arc').setAttribute('stroke-dashoffset', String(CIRC * (1 - progress)));
        $('scan-lbl').textContent = label || 'SCANNING';
      }
    };

    // --- Warnings -----------------------------------------------------------
    let warnState = '';
    self.setWarnings = function (list) {
      const key = list.join('|');
      if (key === warnState) return;
      warnState = key;
      $('warn').innerHTML = list.map(w => '<div>' + w + '</div>').join('');
    };

    // --- Toasts -------------------------------------------------------------
    self.toast = function (msg, warn) {
      const d = document.createElement('div');
      d.className = 'toast' + (warn ? ' warn' : '');
      d.textContent = msg;
      $('toasts').appendChild(d);
      setTimeout(() => d.remove(), 4200);
    };

    // --- Narration ----------------------------------------------------------
    let narrateTimer = null;
    self.narrate = function (text, seconds) {
      const n = $('narrate');
      n.textContent = text;
      n.classList.add('on');
      clearTimeout(narrateTimer);
      narrateTimer = setTimeout(() => n.classList.remove('on'), (seconds || 9) * 1000);
    };

    // --- World-space markers ------------------------------------------------
    function getMarker(i) {
      if (markerPool[i]) return markerPool[i];
      const d = document.createElement('div');
      d.className = 'marker';
      d.innerHTML = '<div class="box"></div><div class="name"></div><div class="dist"></div>';
      markersEl.appendChild(d);
      markerPool[i] = d;
      return d;
    }

    self.beginMarkers = function () { markerUsed = 0; };

    self.marker = function (x, y, name, dist, kind, selected) {
      const d = getMarker(markerUsed++);
      d.style.display = 'block';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.className = 'marker' + (kind === 'signal' ? ' sig' : '') + (selected ? ' sel' : '');
      d.children[1].textContent = name;
      d.children[2].textContent = dist == null ? '' : U.formatDistance(dist);
    };

    self.endMarkers = function () {
      for (let i = markerUsed; i < markerPool.length; i++) markerPool[i].style.display = 'none';
    };

    self.clearMarkers = function () {
      markerPool.forEach(m => m.style.display = 'none');
      markerUsed = 0;
    };

    // --- Overlays -----------------------------------------------------------
    self.show = function (id) { $(id).classList.add('show'); };
    self.hide = function (id) { $(id).classList.remove('show'); };
    self.isShown = function (id) { return $(id).classList.contains('show'); };
    self.setHudVisible = function (on) { $('hud').classList.toggle('on', on); };
    self.setHudHidden = function (h) {
      $('hud').classList.toggle('hidden', h);
      $('reticle').style.display = h ? 'none' : 'block';
      markersEl.style.display = h ? 'none' : 'block';
    };

    // --- Journal ------------------------------------------------------------
    self.renderCodex = function (entries, onSelect) {
      const list = $('codex-list');
      list.innerHTML = '';
      if (!entries.length) {
        list.innerHTML = '<div class="item" style="cursor:default;opacity:.5">— empty —</div>';
        $('codex-pane').innerHTML = '<div class="empty">Nothing recovered yet. Scan what you find; ' +
          'the ship keeps a record even when nobody reads it.</div>';
        return;
      }
      entries.forEach((e, i) => {
        const d = document.createElement('div');
        d.className = 'item';
        d.innerHTML = e.title + '<small>' + e.sub + '</small>';
        d.onclick = () => {
          Array.from(list.children).forEach(c => c.classList.remove('sel'));
          d.classList.add('sel');
          onSelect(e);
        };
        list.appendChild(d);
        if (i === 0) d.onclick();
      });
    };

    self.showCodexEntry = function (e) {
      $('codex-pane').innerHTML =
        '<h3>' + e.title + '</h3><div class="from">' + e.sub + '</div><pre>' + e.body + '</pre>';
    };

    // --- Log popup ----------------------------------------------------------
    let typeTimer = null;
    self.showLog = function (entry) {
      $('log-title').textContent = entry.title;
      $('log-from').textContent = entry.from;
      const target = entry.body.join('\n');
      const el = $('log-body');
      el.textContent = '';
      self.show('logview');
      let i = 0;
      clearInterval(typeTimer);
      typeTimer = setInterval(() => {
        // Type it out — a transmission arriving, not a page opening.
        i += 3;
        el.textContent = target.slice(0, i);
        if (i >= target.length) clearInterval(typeTimer);
      }, 16);
    };
    self.finishLogTyping = function () { clearInterval(typeTimer); };

    // --- Ending -------------------------------------------------------------
    self.showEnding = function (text, done) {
      const el = $('ending-text');
      el.textContent = '';
      self.show('ending');
      let i = 0;
      const t = setInterval(() => {
        i += 1;
        el.textContent = text.slice(0, i);
        if (i >= text.length) { clearInterval(t); if (done) setTimeout(done, 3200); }
      }, 34);
    };

    return self;
  }

  // ==========================================================================
  // STAR CHART — a 2D projection of the galaxy, drawn by hand each frame it
  // is open. Drag to rotate, scroll to zoom, click to pick a destination.
  // ==========================================================================
  function StarChart(canvas) {
    const self = {};
    const ctx = canvas.getContext('2d');
    let yaw = 0.6, pitch = 1.05, zoom = 0.86;
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    let galaxy = null, current = null, selected = null, range = 0;
    let onSelect = null;
    let dpr = 1;

    function resize() {
      dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }

    function project(p) {
      // Rotate around Y, then tilt, then orthographic.
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const x1 = p.x * cy - p.z * sy;
      const z1 = p.x * sy + p.z * cy;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const y2 = p.y * cp - z1 * sp;
      const depth = p.y * sp + z1 * cp;
      const s = zoom * Math.min(canvas.width, canvas.height) / (GALAXY.RADIUS * 2);
      return {
        x: canvas.width / 2 + x1 * s,
        y: canvas.height / 2 + y2 * s,
        d: depth
      };
    }

    self.attach = function (g, cur, jumpRange, cb) {
      galaxy = g; current = cur; range = jumpRange; onSelect = cb;
      selected = null;
      resize();
    };
    self.setCurrent = function (cur) { current = cur; selected = null; };
    self.selected = function () { return selected; };

    self.draw = function (t) {
      if (!galaxy) return;
      if (canvas.width !== canvas.clientWidth * dpr || canvas.height !== canvas.clientHeight * dpr) resize();
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Faint galactic disk halo.
      const c0 = project({ x: 0, y: 0, z: 0 });
      const scale = zoom * Math.min(w, h) / (GALAXY.RADIUS * 2);
      const grad = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, GALAXY.RADIUS * scale);
      grad.addColorStop(0, 'rgba(255,190,120,.16)');
      grad.addColorStop(0.35, 'rgba(120,170,255,.07)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Jump range ring around the current system.
      if (current) {
        const c = project(current.pos);
        ctx.beginPath();
        ctx.arc(c.x, c.y, range * scale, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(143,216,255,.18)';
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([4 * dpr, 6 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const list = galaxy.systems.map(s => ({ s: s, p: project(s.pos) }));
      list.sort((a, b) => a.p.d - b.p.d);

      for (const it of list) {
        const s = it.s, p = it.p;
        const inRange = current && dist3(s.pos, current.pos) <= range && s !== current;
        const known = s.visited;
        let r = (s.isCore ? 6 : 0.9 + s.star.r * 1.1) * dpr;
        let col;
        if (s.isCore) col = 'rgba(255,150,60,';
        else {
          const c = s.star.b;
          col = 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',';
        }
        let alpha = known ? 0.95 : (inRange ? 0.62 : 0.2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col + alpha + ')';
        ctx.fill();
        // Visited systems keep a halo so a route reads at a glance.
        if (known && !s.isCore) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 2.6 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = col + '0.28)';
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }

        if (s.isCore) {
          // The core pulses. It is the only thing on this chart that moves.
          const pr = (7 + Math.sin(t * 2) * 2.2) * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, pr + 5 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,140,60,.45)';
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        if (s === current) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = '#8fd8ff';
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
          label(p, 'YOU ARE HERE', '#8fd8ff');
        }
        if (s === selected) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 12 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = '#f0a24e';
          ctx.lineWidth = 1.6 * dpr;
          ctx.stroke();
          label(p, s.visited || s.isCore ? s.name : 'UNSURVEYED', '#f0a24e');
          if (current) {
            const c = project(current.pos);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = inRange ? 'rgba(240,162,78,.5)' : 'rgba(255,92,70,.4)';
            ctx.setLineDash([3 * dpr, 5 * dpr]);
            ctx.lineWidth = 1.2 * dpr;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    };

    function label(p, text, color) {
      ctx.font = (10 * dpr) + 'px ui-monospace,monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(text, p.x, p.y - 16 * dpr);
    }

    function dist3(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // --- Interaction --------------------------------------------------------
    canvas.addEventListener('mousedown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY; moved = 0;
    });
    global.addEventListener('mouseup', e => {
      if (dragging && moved < 5) pick(e);
      dragging = false;
    });
    global.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      yaw += dx * 0.005;
      pitch = U.clamp(pitch + dy * 0.005, 0.05, 1.55);
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = U.clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.11), 0.12, 4.0);
    }, { passive: false });

    function pick(e) {
      if (!galaxy) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
      let best = null, bestD = 26 * dpr;
      for (const s of galaxy.systems) {
        const p = project(s.pos);
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (best) {
        selected = best;
        if (onSelect) onSelect(best);
      }
    }

    self.resize = resize;
    return self;
  }

  global.HUD = { Hud, StarChart };
})(window);
