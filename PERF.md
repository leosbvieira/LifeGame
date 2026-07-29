# PERF.md

Frame budget target: **90 FPS = 11.1 ms**, 60 FPS floor. Allocation in the
render loop is treated as the primary enemy; all per-frame math uses
module-scope scratch instances (`src/core/scratch.js`) and indexed loops.

> **Measured numbers pending real-GPU capture.** This environment cannot run
> hardware WebGPU (see DECISIONS.md), so the per-system millisecond costs below
> are *design budgets / estimates* to be confirmed and filled in on the target
> RTX 5070 Ti @ 1440p. The overlay (F1) ships a live 1%-low frame-time graph for
> exactly this measurement.

## Budget allocation (design targets @ 1440p, 90 FPS)
| System | Budget | Notes |
| --- | ---: | --- |
| Gas-sea floor (CPU displace + upload) | 1.5 ms | 160² patch, 3 buffer updates/frame |
| Gas-field sim (CPU diffuse/decay) | 1.0 ms | 256² field, 4 channels |
| Cascaded shadows | 2.0 ms | 3 cascades @ 2048, floor + ship casters |
| Snow/gas + body shading | 2.0 ms | Standard/PBR, IBL from nebula cube |
| Post chain (bloom/ACES/CA/grain/FXAA) | 2.5 ms | Babylon DefaultRenderingPipeline |
| Gravitational-lensing pass | 0.6 ms | single WGSL fullscreen warp |
| Particles + abilities | 1.0 ms | CPU ParticleSystems, pooled |
| Headroom | 0.5 ms | |

## Zero-allocation measures in place
- Scratch `Vector3/Quaternion/Matrix/Color` reused everywhere in `update()`.
- No `map`/`filter`/`reduce`/spread/destructuring in hot paths; indexed `for`.
- Overlay text/graph refreshed on a ~8 Hz throttle, into reused buffers.
- Object pools: 5 dynamic lights, 5 reused ability particle systems, thin
  instances for the whole asteroid belt (1 draw), toroidal gas-field arrays.
- Typed arrays uploaded in place (`updateVerticesData`, `thinInstanceBufferUpdated`).
- Asteroid tumble + overlay throttled below frame rate.

## Warm-up
`src/main.js` compiles every particle pipeline (`AbilitySystem.warmup()`) and
renders several offscreen frames before the loading screen dismisses, so the
first cast of any ability does not hitch on pipeline compilation.

## Known cost levers (overlay sliders / toggles)
- Shadows, bloom kernel, DoF, chromatic aberration — all individually toggleable.
- `?lite` reduces shadow res, floor grid, cube size (headless capture only).
