import { Scene } from '@babylonjs/core/scene.js';
import { Color4 } from '@babylonjs/core/Maths/math.js';

import { bootEngine } from './core/engine.js';
import { createSettings } from './core/settings.js';
import { Input } from './core/input.js';
import { Overlay } from './ui/overlay.js';
import { ShipController } from './ship/controller.js';
import { ChaseCamera } from './ship/camera.js';
import { buildShip } from './ship/model.js';
import { clamp } from './core/scratch.js';
import { isLite, isMin } from './core/quality.js';

async function main() {
  // Lite/min/gl modes: for headless capture only, no effect on the real demo.
  const _q = new URLSearchParams(location.search);
  globalThis.__GL__ = _q.has('gl');
  globalThis.__LITE__ = _q.has('lite') || _q.has('gl');
  globalThis.__MIN__ = _q.has('min');

  const canvas = document.getElementById('renderCanvas');
  const engine = await bootEngine(canvas);
  if (!engine) return;

  if (isLite()) engine.setHardwareScalingLevel(2.5);

  const setLoad = (pct, msg) => {
    const bar = document.getElementById('bar');
    const m = document.getElementById('loadMsg');
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
    if (m && msg) m.textContent = msg;
  };

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.004, 0.006, 0.016, 1);
  scene.autoClear = true;
  scene.skipPointerMovePicking = true;

  const settings = createSettings();
  const input = new Input(canvas);

  setLoad(0.15, 'systems online');

  // --- Player ship + camera ---
  const ship = new ShipController(scene, input, settings);
  ship.root.position.set(0, 70, -80);
  ship.model = buildShip(scene, ship.bank);
  const chase = new ChaseCamera(scene, ship, input);

  setLoad(0.5, 'plotting course');

  // --- Space environment ---
  const { World } = await import('./space/world.js');
  const world = new World(scene, settings, ship);
  await world.init(setLoad);
  world.registerShip(ship.model.hull);

  // --- Abilities + VFX ---
  let abilities = null;
  if (!isMin()) {
    const { AbilitySystem } = await import('./abilities/index.js');
    abilities = new AbilitySystem(scene, ship, world, input, chase, settings);
  }

  // --- Post chain ---
  const { PostChain } = await import('./post/pipeline.js');
  const post = new PostChain(scene, chase.cam, settings, world);

  const overlay = new Overlay(scene, settings);

  setLoad(0.9, 'compiling pipelines');
  // Pipeline warm-up: render several frames offscreen before revealing so first
  // spell casts don't hitch on shader/pipeline compilation.
  if (abilities) abilities.warmup();
  for (let i = 0; i < 6; i++) scene.render();
  await engine.whenReadyAsync?.();

  setLoad(1.0, 'ready');
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
    const hint = document.getElementById('hint');
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 7000);
  }, 400);

  // --- Main loop ---
  // In lite capture mode, cap the number of rendered frames so the software
  // renderer isn't pushed into a sustained-load crash. No effect on real GPU.
  const frameCap = isLite() ? parseInt(_q.get('frames') || '80', 10) : Infinity;
  let frameCount = 0;

  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0.0001, 0.05);

    ship.update(dt);
    if (abilities) abilities.update(dt);
    world.update(dt, chase);
    chase.update(dt);
    post.update(dt, ship);
    overlay.update(dt * 1000);

    scene.render();
    input.endFrame();

    if (++frameCount >= frameCap) {
      engine.stopRenderLoop();
      globalThis.__RENDER_DONE__ = true;
    }
  });

  window.__voidrift = { scene, engine, ship, chase, world, settings, post, abilities };
}

main().catch((e) => {
  console.error(e);
  const f = document.getElementById('fatal');
  if (f) {
    f.style.display = 'flex';
    f.querySelector('p').innerHTML = `<b>Boot error.</b><br><br>${(e && e.message) || e}`;
  }
  const l = document.getElementById('loader');
  if (l) l.style.display = 'none';
});
