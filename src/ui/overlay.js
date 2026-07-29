/**
 * Settings + performance overlay. Toggled with F1 (hidden by default).
 * - Frame-time graph with 1% low.
 * - Draw-call / triangle counts.
 * - Toggles for post-process + major systems.
 * - Live art-parameter sliders.
 *
 * No per-frame string allocation: text nodes are updated on a throttle, and
 * the frame-time graph is drawn into a reused canvas.
 */
export class Overlay {
  /**
   * @param {import('@babylonjs/core').Scene} scene
   * @param {object} settings shared mutable settings object
   */
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    this.visible = false;

    // Frame-time ring buffer.
    this.samples = new Float32Array(180);
    this.sampleIdx = 0;
    this.filled = 0;

    this._acc = 0; // throttle accumulator for text updates

    this._buildDOM();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1' || e.code === 'Backquote') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'overlay';
    root.style.cssText = `
      position: fixed; top: 16px; left: 16px; width: 320px; max-height: 92vh;
      overflow-y: auto; padding: 16px 18px; border-radius: 14px;
      background: rgba(8, 11, 22, 0.82); backdrop-filter: blur(14px);
      border: 1px solid rgba(120, 160, 255, 0.16);
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      font: 12px/1.5 'Segoe UI', system-ui, sans-serif; color: #cdd7f5;
      z-index: 100; display: none; user-select: none;
    `;
    this.root = root;

    const title = document.createElement('div');
    title.textContent = 'VOIDRIFT · telemetry';
    title.style.cssText =
      'font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7fd8ff;margin-bottom:10px;';
    root.appendChild(title);

    // Frame-time graph canvas.
    const cv = document.createElement('canvas');
    cv.width = 288;
    cv.height = 64;
    cv.style.cssText = 'width:100%;height:64px;border-radius:8px;background:rgba(0,0,0,0.35);display:block;';
    root.appendChild(cv);
    this.graph = cv;
    this.gctx = cv.getContext('2d');

    const stats = document.createElement('div');
    stats.style.cssText = 'margin:8px 0 12px;font-variant-numeric:tabular-nums;color:#aeb9e0;';
    root.appendChild(stats);
    this.statsEl = stats;

    // Section helper.
    const section = (label) => {
      const s = document.createElement('div');
      s.textContent = label;
      s.style.cssText =
        'margin:12px 0 6px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#6f83b8;border-top:1px solid rgba(120,160,255,0.12);padding-top:8px;';
      root.appendChild(s);
    };

    const toggle = (label, key) => {
      const row = document.createElement('label');
      row.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;padding:3px 0;cursor:pointer;';
      const span = document.createElement('span');
      span.textContent = label;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!this.settings[key];
      cb.style.cssText = 'accent-color:#7fd8ff;width:15px;height:15px;';
      cb.addEventListener('change', () => {
        this.settings[key] = cb.checked;
        this.settings._dirty = true;
      });
      row.appendChild(span);
      row.appendChild(cb);
      root.appendChild(row);
    };

    const slider = (label, key, min, max, step) => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:4px 0;';
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;';
      const span = document.createElement('span');
      span.textContent = label;
      const val = document.createElement('span');
      val.style.color = '#7fd8ff';
      val.textContent = (+this.settings[key]).toFixed(step < 1 ? 2 : 0);
      top.appendChild(span);
      top.appendChild(val);
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.min = min;
      rng.max = max;
      rng.step = step;
      rng.value = this.settings[key];
      rng.style.cssText = 'width:100%;accent-color:#c9a4ff;margin-top:2px;';
      rng.addEventListener('input', () => {
        this.settings[key] = parseFloat(rng.value);
        val.textContent = (+this.settings[key]).toFixed(step < 1 ? 2 : 0);
        this.settings._dirty = true;
      });
      row.appendChild(top);
      row.appendChild(rng);
      root.appendChild(row);
    };

    section('post-processing');
    toggle('Bloom', 'bloom');
    toggle('Tonemapping (ACES)', 'tonemap');
    toggle('Chromatic aberration', 'chroma');
    toggle('Depth of field', 'dof');
    toggle('Film grain', 'grain');
    toggle('Sharpen', 'sharpen');
    toggle('FXAA', 'fxaa');
    toggle('Vignette', 'vignette');

    section('systems');
    toggle('Black-hole lensing', 'lensing');
    toggle('Nebula volumetrics', 'nebula');
    toggle('Ion trail (deformable gas)', 'trail');
    toggle('Asteroid field', 'asteroids');
    toggle('Spindrift / dust', 'dust');

    section('art parameters');
    slider('Exposure', 'exposure', 0.4, 2.5, 0.01);
    slider('Bloom intensity', 'bloomIntensity', 0, 1.5, 0.01);
    slider('Black-hole mass', 'lensMass', 0.0, 2.5, 0.01);
    slider('Nebula density', 'nebulaDensity', 0.0, 2.0, 0.01);
    slider('Trail depth', 'trailDepth', 0.0, 2.0, 0.01);
    slider('Trail refill rate', 'refill', 0.0, 2.0, 0.01);
    slider('Ship speed', 'shipSpeed', 0.5, 3.0, 0.01);

    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:14px;font-size:10px;color:#5f719f;letter-spacing:0.06em;';
    foot.textContent = 'F1 to hide · 1–5 systems · SHIFT boost · RMB brake';
    root.appendChild(foot);

    document.body.appendChild(root);
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  /** Push a frame-time sample (ms) and refresh graph/stats on a throttle. */
  update(dtMs) {
    this.samples[this.sampleIdx] = dtMs;
    this.sampleIdx = (this.sampleIdx + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;

    if (!this.visible) return;

    this._acc += dtMs;
    if (this._acc < 120) return; // ~8 Hz text/graph refresh
    this._acc = 0;

    this._drawGraph();
    this._drawStats();
  }

  _drawGraph() {
    const g = this.gctx;
    const W = this.graph.width;
    const H = this.graph.height;
    g.clearRect(0, 0, W, H);

    // Budget guides: 11.1ms (90fps) and 16.6ms (60fps).
    const scale = H / 33.0; // full height ~ 33ms
    g.strokeStyle = 'rgba(120,220,160,0.35)';
    g.beginPath();
    g.moveTo(0, H - 11.1 * scale);
    g.lineTo(W, H - 11.1 * scale);
    g.stroke();
    g.strokeStyle = 'rgba(255,180,120,0.30)';
    g.beginPath();
    g.moveTo(0, H - 16.6 * scale);
    g.lineTo(W, H - 16.6 * scale);
    g.stroke();

    g.beginPath();
    g.strokeStyle = '#7fd8ff';
    g.lineWidth = 1.5;
    const n = this.filled;
    for (let i = 0; i < n; i++) {
      const idx = (this.sampleIdx - n + i + this.samples.length) % this.samples.length;
      const x = (i / (this.samples.length - 1)) * W;
      const y = H - Math.min(this.samples[idx], 33) * scale;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  _drawStats() {
    // Compute avg + 1% low from the ring buffer.
    const n = this.filled;
    let sum = 0;
    let worst = 0;
    // Copy to a small stack array of frame times for percentile.
    // n <= 180, cheap and only every 120ms, so this is acceptable.
    const tmp = this._tmp || (this._tmp = new Float32Array(this.samples.length));
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      tmp[i] = s;
      sum += s;
      if (s > worst) worst = s;
    }
    const avg = sum / Math.max(1, n);
    // 1% low = 99th percentile frame time -> fps.
    // Simple partial: find the value at the 99th percentile via insertion is overkill;
    // use worst-1% average.
    let onePctCount = Math.max(1, Math.floor(n * 0.01));
    // find top-k largest (small k) without full sort.
    let onePctSum = 0;
    for (let k = 0; k < onePctCount; k++) {
      let mi = -1;
      let mv = -1;
      for (let i = 0; i < n; i++) {
        if (tmp[i] > mv) {
          mv = tmp[i];
          mi = i;
        }
      }
      onePctSum += mv;
      tmp[mi] = -1;
    }
    const onePctMs = onePctSum / onePctCount;

    const eng = this.scene.getEngine();
    const fps = 1000 / avg;
    const lowFps = 1000 / onePctMs;
    const draws = eng._drawCalls ? eng._drawCalls.current : this.scene.getActiveMeshes().length;
    const tris = Math.round(this.scene.totalVerticesPerfCounter.current / 1000);

    this.statsEl.innerHTML =
      `<b style="color:#eafcff">${fps.toFixed(0)}</b> fps` +
      ` &nbsp;·&nbsp; ${avg.toFixed(2)} ms` +
      ` &nbsp;·&nbsp; <span style="color:#ffb98a">1% low ${lowFps.toFixed(0)} fps</span><br>` +
      `${this.scene.getActiveMeshes().length} meshes` +
      ` &nbsp;·&nbsp; ${tris}k verts` +
      ` &nbsp;·&nbsp; ${eng.drawCalls ?? '—'} draws`;
  }
}
