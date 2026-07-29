# ASSETS.md

VOIDRIFT ships **no third-party binary assets**. Every texture, mesh and sound
cue is generated procedurally at load time on the CPU, or built from Babylon.js
primitives. There are therefore no runtime CDN fetches and no licences to track
beyond the dependencies below.

## Procedurally generated at load (CPU)
| Asset | Source module | Notes |
| --- | --- | --- |
| Nebula background cube | `src/space/skybox.js` | fBm + ridged 3D noise, 6×256² |
| Starfield (3 layers) | `src/space/starfield.js` | PointsCloudSystem, hashed placement |
| Saturn band texture | `src/space/saturn.js` | latitude bands + turbulence, 1024×512 |
| Saturn ring texture | `src/space/saturn.js` | radial density + Cassini gap, 1024² |
| Accretion-disk texture | `src/space/blackhole.js` | temperature ramp + Doppler, 1024² |
| Gas-sea detail normal | `src/space/floor.js` | tiling noise-derived normal, 512² |
| Particle sprites | `src/abilities/index.js`, `src/space/world.js` | soft dot / star |

## Meshes
All from Babylon `MeshBuilder` primitives (spheres, discs, torus, boxes,
icosphere), some vertex-displaced by noise (asteroids, ship). No imported
glTF/OBJ.

## Dependencies
| Package | Licence |
| --- | --- |
| `@babylonjs/core` | Apache-2.0 |
| `vite` (dev) | MIT |
| `playwright` (dev, CI capture only) | Apache-2.0 |

## Noise
The Perlin/fBm/ridged noise in `src/space/noise.js` is an original
implementation with a fixed seed (reproducible textures). No third-party code.
