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
- Headless Chromium here does **not** composite the WebGPU canvas into a
  screenshot (a minimal WebGPU box captured the CSS background, not the render)
  and the software SwiftShader WebGPU path crashes under sustained load — so the
  shipped WebGPU path can't be screenshotted here.
- **Workaround that DID let me iterate visually: a WebGL2 capture path (`?gl`).**
  Babylon is cross-API, so under a WebGL engine the whole scene renders and
  Playwright *can* composite it — everything except the one WGSL lensing pass
  (skipped under WebGL). This is capture-only (`src/core/quality.js` isGL) and
  never ships as a fallback. `scripts/tour.mjs` drives it to compose shots.
- Iterating on those captures caught real bugs that would have shipped blind:
  the skybox blowing out to flat white (emissive misuse), the gas sea rendering
  black (inverted triangle winding → down-facing normals), and several
  brightness/blow-out calibrations. Exactly the "look at your output" loop the
  brief demands — recovered via WebGL rather than WebGPU.
- Baseline guards also run: `vite build` + a software-WebGPU **boot check**
  (`scripts/boot-check.mjs`) confirming every system/shader/pipeline constructs
  and warms up without throwing. Final perf + the WGSL lensing pass still need a
  real WebGPU GPU.
- `?lite`, `?min`, `?gl`, `?frames=N` are capture-only and have **no effect** on
  the default GPU path.

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
- **Cascaded shadow map dropped.** The gas sea is the only large receiver and it
  is drawn as a self-luminous unlit surface (per-vertex glow), so a shadow map
  has no meaningful receiver. Trench self-shadowing is instead read directly
  from the recomputed surface normals (the sea shades itself via lighting on its
  own displaced geometry). Saves the cascade render each frame.

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
