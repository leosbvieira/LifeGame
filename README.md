# THE LONG QUIET

A solitary space-exploration game that runs in a browser. You are the last
survey pilot still transmitting: fly a ship through a procedurally generated
galaxy, scan worlds nobody has named, recover messages left by the pilot who
went ahead of you, and — eventually — fly into the supermassive black hole at
the centre.

Nothing is loaded from disk. Every star, planet, ring, nebula, wreck and sound
is generated at runtime from a single seed.

## Playing it

Open `index.html` in a modern browser. That's it — no build step, no
dependencies to install, no network access required.

If your browser is strict about local files, serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Click the canvas to capture the mouse. Press `Esc` to release it.

### Controls

| Key | Action |
| --- | --- |
| mouse | pitch and yaw |
| `W` / `S` | throttle up / down |
| `A` / `D` | roll |
| `Q` / `E` / `R` / `V` | lateral and vertical thrusters |
| `shift` | boost |
| `X` (hold) | pulse drive — crosses a solar system in seconds |
| `space` | retro brake |
| `T` | cycle target |
| `F` (hold) | scan the current target |
| `M` | star chart / warp to another system |
| `J` | journal — everything you have surveyed and recovered |
| `C` | cockpit / chase view |
| `H` | hide the interface (for looking at things) |
| `Esc` | pause |

### What there is to do

- **Survey.** Aim at a world and hold `F`. Every scan is written into the
  journal with its own readings and a line about what the place is like.
- **Follow the signals.** Some systems hold a derelict hull or an anomaly.
  Scanning those recovers a transmission. Six of them form a single story;
  the rest are things other people left behind on their way through.
- **Warp.** `M` opens the star chart. Any system inside your jump range can be
  reached; the galaxy is 240-odd systems across four spiral arms.
- **Go to the centre.** Recover four signals and the approach vector to the
  core resolves. The long jump can be made from anywhere. Time runs slow near
  the hole, the hull complains, and the horizon is a one-way trip — which is
  the point.

Progress is saved to `localStorage` on every scan and every jump.

## How it is built

Plain browser JavaScript and one vendored copy of three.js. No bundler, no
framework, no assets.

| File | What it holds |
| --- | --- |
| `src/util.js` | Seeded RNG, CPU noise used to bake textures, formatting |
| `src/shaders.js` | GLSL: planets, stars, atmospheres, accretion disk, post chain |
| `src/galaxy.js` | Galaxy generation — spiral arms, star classes, worlds, belts |
| `src/lore.js` | The recovered transmissions |
| `src/space.js` | Starfield, galactic band, nebulae, near dust, warp streaks |
| `src/system.js` | Builds one star system at a time and disposes the last |
| `src/blackhole.js` | Horizon, photon ring, disk, jets, and the gravity field |
| `src/ship.js` | Ship model, flight model, engine trail, camera rig |
| `src/post.js` | Bright pass → separable blur → composite (bloom, lensing, grain) |
| `src/hud.js` | Instruments, world markers, star chart, journal |
| `src/game.js` | State, input, the loop, scanning, warp, damage, the ending |

A few notes on the interesting parts:

- **Planets** are a single fragment shader: fbm terrain plus a ridged layer for
  mountain chains, sea level, ice caps, drifting clouds, night-side settlement
  lights, and a limb-scattering rim. The surface normal is perturbed by
  sampling the height field along two tangents, so relief actually catches the
  light instead of being painted flat. Those extra samples are skipped on the
  unlit hemisphere and on gas giants, where they would buy nothing.
- **The black hole** combines a screen-space lensing pass (deflection falling
  off as 1/r², clamped near the singularity, with the shadow punched out) with
  a Doppler-beamed accretion disk — the side rotating toward you is brighter
  and bluer — and a second disk copy standing on edge to stand in for the
  Einstein ring. Gravity is integrated into the flight model, and the
  simulation timestep is scaled by depth in the well, so time genuinely runs
  slow as you fall.
- **Nebulae** are baked once into canvas textures rather than evaluated per
  pixel per frame. Dozens of overlapping full-screen additive billboards each
  running eleven octaves of noise is not a trade worth making for something
  that does not move.
- **Sound** is synthesised with the Web Audio API: a drone that retunes itself
  for each system, engine noise filtered by throttle, a sub-bass rumble that
  rises as you approach the core.

## Licence

Do what you like with it.
