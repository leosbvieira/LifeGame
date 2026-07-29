# VOIDRIFT

A WebGPU space-exploration graphics tech demo built with Babylon.js — a
deformable luminous **gas sea** you skim across in a ship, under a sky with a
**gravitationally-lensed black hole**, a ringed **gas giant**, procedural
nebulae and a drifting asteroid belt. Ship systems carve persistent glowing
wakes into the gas that slowly heal.

It's the space-themed sibling of the SNOWFLOW brief: same deformable-surface,
third-person-action, "visual quality is the product" DNA, reinterpreted for
deep space. See `DECISIONS.md` for the full mapping.

## Requirements
**WebGPU only.** A recent Chrome / Edge with hardware acceleration on a real
GPU. No WebGL fallback by design — if `navigator.gpu` is missing (or no adapter
is available) you get a single line of text and nothing else.

## Run
```bash
npm install
npm run dev      # http://localhost:5173
# or
npm run build && npm run preview
```

## Controls
| Input | Action |
| --- | --- |
| **WASD** | Fly (throttle / reverse / bank-slide), relative to heading |
| **Mouse** | Steer heading (click canvas for pointer lock) |
| **SHIFT / Space** | Boost — accelerate, widen FOV, whip the ion wake |
| **RMB** | Brake |
| **Wheel** | Zoom (eased) |
| **1** | Pulse — crescent shock ploughs a channel + berms |
| **2** | Tractor (hold) — beam scores a continuous line in the gas |
| **3** | Implode — crater + raised rim + glitter fallout |
| **4** | Crystallize — freezes gas into permanent glossy ice |
| **5** | Vortex — strips a ring of gas around the ship |
| **F1** / **`** | Settings + performance overlay (hidden by default) |

Every system writes into the deformation field, so its mark persists after the
effect ends.

## Structure
```
src/
  core/     engine boot, render loop glue, input, scratch math, settings, quality
  space/    starfield, nebula skybox, Saturn, black hole, floor (gas sea),
            asteroids, lighting, world orchestrator
  field/    persistent player-following gas deformation field (CPU sim)
  ship/     flight controller, chase camera, procedural ship model
  abilities/ ship systems 1–5 + shared VFX/light pools
  post/     Babylon post pipeline + hand-written WGSL lensing pass
  ui/       settings/perf overlay with 1%-low frame graph
```

See `DECISIONS.md`, `PERF.md`, `ASSETS.md` for engineering notes.

## Note on verification
This repo was authored in an environment without hardware WebGPU, so it was
validated by build + a headless **boot check** (`scripts/boot-check.mjs`) that
confirms every system and shader constructs and warms up under a software
device without errors. Final visual/perf tuning is expected on a real GPU.
