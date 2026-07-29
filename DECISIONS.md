# DECISIONS.md

Every deviation from the implementation brief, with a one-line rationale. The
brief is for SNOWFLOW (deformable snow); VOIDRIFT reinterprets the same systems
for a space-exploration setting. The mapping itself is the first "deviation":

| Brief (SNOWFLOW) | VOIDRIFT |
| --- | --- |
| Deformable snow field | Deformable **luminous gas sea** the ship skims across |
| Snow shading (SSS, glint) | Glowing gas shading + banded planet + ring ice + accretion disk |
| Snow-surf (RMB) | **Boost/drift** with ion wake + FOV widen + speed streaks |
| Spells 1–5 | Ship **systems** 1–5 (pulse, tractor, implode, crystallize, vortex) |
| Warm sun, blue shadows | Cool key light, magenta gas bounce, black-hole + Saturn skies |

## Environment / verification
- **Cannot iterate from screenshots in this build environment.** Headless
  Chromium here does not composite the WebGPU canvas into screenshots (a minimal
  box scene captured the CSS background, not the render), and the software
  SwiftShader path crashes under sustained load. Verification therefore rests on
  `vite build` (imports/syntax) + a headless **boot check** that confirms every
  system, material, WGSL shader and the post pipeline construct and warm up
  under a software WebGPU device without throwing (`scripts/boot-check.mjs`).
  Final visual tuning is expected on a real WebGPU GPU.
- Added `?lite`, `?min`, `?frames=N` capture modes purely to reduce cost for
  headless software rendering. They have **no effect** on the default GPU path.

## Rendering approach
- **Minimized hand-written WGSL to one hero shader** (the black-hole
  gravitational-lensing post pass). Everything else uses Babylon's built-in
  materials/post-processes (which ship validated WGSL) plus CPU-baked procedural
  textures. Rationale: without on-device visual iteration, a blind WGSL bug
  would silently break an effect; this keeps the blast radius to one
  gracefully-degrading pass.
- **Backgrounds/textures baked on the CPU** (nebula cube, Saturn bands + rings,
  accretion disk, gas detail normal, particle sprites). Guaranteed to render on
  any WebGPU device; fully procedural and controllable.
- **Gas-field deformation runs on the CPU**, and the floor patch is
  CPU-displaced with recomputed normals, instead of a GPU ping-pong sim. More
  robust than blind compute/RTT shaders and gives real geometry that
  self-shadows. Cost is bounded (256² sim, 160² patch) — see PERF.md.
- **Floor glow via a second additive mesh sharing one geometry** rather than a
  custom emissive-from-vertex-color material, because Standard/PBR materials
  don't add vertex colour to emissive and a custom WGSL material was avoided.

## Lighting / post
- **FXAA instead of TAA.** The brief wants TAA to stabilise crawling glints, but
  VOIDRIFT has no crawling high-frequency specular (stars are static points,
  the gas is stylised), so TAA's cost and ghosting aren't worth it. FXAA +
  post-sharpen covers the aliasing that remains.
- **SSR dropped.** No large flat wet/ice planes benefit from it here; the ice
  state instead reads as glossy vertex colour. Reflections come from the nebula
  IBL cube. Saves a full screen-space pass toward the frame budget.

## Character
- **The ship replaces the robed figure.** The "cloth" direction (hem/sleeve
  Verlet) is reinterpreted as the ship's **ion wake + boost streaks + banked
  hull**; procedural, velocity-driven, whips back under boost — same intent
  (motion-driven secondary detail conveying speed), different medium.

## Scope kept faithful
- Persistent, additive, player-following deformation buffer with slow refill;
  every ship system and the continuous ship draft write into it. ✔
- Third-person action framing, spring-arm chase camera, eased FOV/zoom, shake. ✔
- Pipeline warm-up before the loading screen dismisses. ✔
- Settings/perf overlay with a 1%-low frame-time graph and per-system toggles. ✔
