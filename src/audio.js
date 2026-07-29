/* =========================================================================
   THE LONG QUIET — audio.js
   All sound is synthesised at runtime: a slow drone that follows the star
   you are orbiting, engine noise driven by the throttle, and small
   instrument sounds. No audio files.
   ========================================================================= */
(function (global) {
  'use strict';

  function Audio() {
    let ctx = null, master = null, ready = false, muted = false;
    let droneNodes = [], padGain = null, engine = {}, rumble = {};
    let currentKey = 0;

    // Pentatonic-ish set of ratios; the drone picks from these so any two
    // systems still sound related when you jump between them.
    const RATIOS = [1, 1.125, 1.25, 1.5, 1.667, 1.875, 2];

    function init() {
      if (ctx) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);
      buildDrone();
      buildEngine();
      buildRumble();
      ready = true;
      master.gain.setTargetAtTime(0.85, ctx.currentTime, 2.0);
    }

    function noiseBuffer(seconds) {
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;   // brown-ish, easier on the ears
        d[i] = last * 3.2;
      }
      return buf;
    }

    function buildDrone() {
      padGain = ctx.createGain();
      padGain.gain.value = 0.09;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 620;
      filt.Q.value = 0.6;
      padGain.connect(filt);

      // A touch of space: feedback delay used as a cheap reverb tail.
      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = 0.55;
      const fb = ctx.createGain();
      fb.gain.value = 0.55;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      filt.connect(delay); delay.connect(fb); fb.connect(delay);
      delay.connect(wet);
      filt.connect(master); wet.connect(master);

      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator();
        o.type = i === 3 ? 'triangle' : 'sine';
        o.frequency.value = 55;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.6 : 0.22;
        // Slow amplitude drift so nothing sits perfectly still.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.02 + i * 0.013;
        const lg = ctx.createGain();
        lg.gain.value = 0.12;
        lfo.connect(lg); lg.connect(g.gain);
        lfo.start();
        o.connect(g); g.connect(padGain);
        o.start();
        droneNodes.push({ osc: o, gain: g, filt: filt });
      }
    }

    function buildEngine() {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(4);
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 1.1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.0;
      src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(master);
      src.start();
      engine = { src, bp, lp, gain: g };
    }

    function buildRumble() {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(6);
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 70; lp.Q.value = 2.0;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start();
      rumble = { src, lp, gain: g };
    }

    // Retune the pad when arriving in a new system. Cooler stars sit lower.
    function setSystemTone(seed, warmth) {
      if (!ready) return;
      const rng = U.Rng(seed);
      const root = 42 * Math.pow(2, Math.floor(rng.range(0, 2)));
      currentKey = root;
      droneNodes.forEach((n, i) => {
        const r = RATIOS[Math.floor(rng.next() * RATIOS.length) % RATIOS.length];
        const f = root * r * (i === 3 ? 2 : 1);
        n.osc.frequency.setTargetAtTime(f, ctx.currentTime, 3.5);
        n.filt.frequency.setTargetAtTime(380 + warmth * 900, ctx.currentTime, 3.0);
      });
    }

    function setEngine(throttle, speed) {
      if (!ready) return;
      const t = ctx.currentTime;
      engine.gain.gain.setTargetAtTime(0.02 + throttle * 0.11, t, 0.15);
      engine.bp.frequency.setTargetAtTime(110 + throttle * 260 + speed * 0.02, t, 0.2);
      engine.lp.frequency.setTargetAtTime(500 + throttle * 1600, t, 0.25);
    }

    function setRumble(amount) {
      if (!ready) return;
      rumble.gain.gain.setTargetAtTime(amount * 0.42, ctx.currentTime, 0.5);
      rumble.lp.frequency.setTargetAtTime(45 + amount * 130, ctx.currentTime, 0.6);
    }

    function setPad(amount) {
      if (!ready) return;
      padGain.gain.setTargetAtTime(0.02 + amount * 0.1, ctx.currentTime, 1.5);
    }

    // --- One-shots ----------------------------------------------------------
    function blip(freq, dur, type, vol) {
      if (!ready || muted) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol || 0.12, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.18));
      o.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + (dur || 0.18) + 0.05);
    }

    function ui() { blip(880, 0.07, 'square', 0.035); }
    function confirm() { blip(560, 0.09, 'triangle', 0.06); setTimeout(() => blip(840, 0.14, 'triangle', 0.05), 70); }
    function deny() { blip(180, 0.16, 'sawtooth', 0.05); }
    function scanTick() { blip(1200 + Math.random() * 240, 0.05, 'sine', 0.03); }
    function discovery() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => blip(f, 0.5, 'sine', 0.06), i * 130));
    }
    function logFound() {
      [392, 466, 587].forEach((f, i) => setTimeout(() => blip(f, 0.9, 'triangle', 0.05), i * 220));
    }

    function warpCharge(seconds) {
      if (!ready || muted) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(60, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + seconds);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(300, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(4000, ctx.currentTime + seconds);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + seconds * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds + 0.6);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + seconds + 0.7);
      return o;
    }

    function warpBoom() {
      if (!ready || muted) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.6);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(2600, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 1.4);
      f.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(); src.stop(ctx.currentTime + 1.6);
    }

    function impact(strength) {
      if (!ready || muted) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.6);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.4, 0.08 + strength * 0.3), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(); src.stop(ctx.currentTime + 0.5);
    }

    function toggleMute() {
      if (!ready) return muted;
      muted = !muted;
      master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.2);
      return muted;
    }

    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    return {
      init, resume, setSystemTone, setEngine, setRumble, setPad,
      ui, confirm, deny, scanTick, discovery, logFound,
      warpCharge, warpBoom, impact, toggleMute,
      get muted() { return muted; },
      get ready() { return ready; }
    };
  }

  global.AUDIO = Audio();
})(window);
