import {
  MeshBuilder,
  Mesh,
  VertexData,
  PBRMetallicRoughnessMaterial,
  Matrix,
  Quaternion,
  Vector3,
  Color3,
} from '@babylonjs/core';
import { fbm3 } from './noise.js';
import { hash11 } from '../core/scratch.js';

/**
 * A drifting asteroid field rendered as thin instances of one displaced
 * icosphere — a single draw call for the whole belt. Gives the mid-distance
 * silhouette and parallax the brief asks for, without paying per-rock draws.
 *
 * Returns { root, update(dt) }.
 */
export function buildAsteroids(scene, count = 220) {
  // Base rock: icosphere with noise-displaced vertices.
  const rock = MeshBuilder.CreateIcoSphere('rockBase', { radius: 1, subdivisions: 3 }, scene);
  const pos = rock.getVerticesData('position');
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const n = fbm3(x * 1.6, y * 1.6, z * 1.6, 4);
    const s = 1 + n * 0.55;
    pos[i] = x * s; pos[i + 1] = y * s; pos[i + 2] = z * s;
  }
  rock.updateVerticesData('position', pos);
  const normals = [];
  VertexData.ComputeNormals(pos, rock.getIndices(), normals);
  rock.updateVerticesData('normal', normals);

  const mat = new PBRMetallicRoughnessMaterial('rockMat', scene);
  mat.baseColor = new Color3(0.16, 0.15, 0.17);
  mat.metallic = 0.15;
  mat.roughness = 0.92;
  rock.material = mat;
  rock.isPickable = false;
  rock.applyFog = false;

  // Scatter thin instances in a shell around the play area.
  const matrices = new Float32Array(count * 16);
  const spins = new Float32Array(count * 4); // axis(xyz) + speed
  const m = new Matrix();
  const q = new Quaternion();
  const scaleV = new Vector3();
  const posV = new Vector3();
  let seed = 3.1;

  for (let i = 0; i < count; i++) {
    const u = hash11((seed += 1.3));
    const v = hash11((seed += 2.1));
    const ring = 900 + hash11((seed += 0.7)) * 3200;
    const ang = u * Math.PI * 2;
    const yy = (v - 0.5) * 900 + 260;
    posV.set(Math.cos(ang) * ring, yy, Math.sin(ang) * ring);
    const sc = 6 + hash11((seed += 0.5)) * 46;
    scaleV.set(sc, sc * (0.7 + hash11((seed += 0.3)) * 0.5), sc);
    Quaternion.FromEulerAnglesToRef(u * 6.28, v * 6.28, hash11((seed += 0.9)) * 6.28, q);
    Matrix.ComposeToRef(scaleV, q, posV, m);
    m.copyToArray(matrices, i * 16);

    spins[i * 4] = hash11((seed += 0.2)) - 0.5;
    spins[i * 4 + 1] = hash11((seed += 0.2)) - 0.5;
    spins[i * 4 + 2] = hash11((seed += 0.2)) - 0.5;
    spins[i * 4 + 3] = 0.05 + hash11((seed += 0.2)) * 0.25;
  }
  rock.thinInstanceSetBuffer('matrix', matrices, 16, false);
  rock.thinInstanceRefreshBoundingInfo();

  // Slow tumble. We rewrite the matrix buffer in place (no allocation) on a
  // throttle so 220 rocks don't cost a full recompose every frame.
  const tmpM = new Matrix();
  const tmpQ = new Quaternion();
  const tmpScale = new Vector3();
  const tmpPos = new Vector3();
  const tmpRot = new Quaternion();
  let acc = 0;

  return {
    root: rock,
    update(dt) {
      acc += dt;
      if (acc < 1 / 30) return; // 30 Hz tumble is plenty for distant rocks
      const step = acc;
      acc = 0;
      for (let i = 0; i < count; i++) {
        Matrix.FromArrayToRef(matrices, i * 16, tmpM);
        tmpM.decompose(tmpScale, tmpQ, tmpPos);
        Quaternion.RotationAxisToRef(
          tmpVec(spins[i * 4], spins[i * 4 + 1], spins[i * 4 + 2]),
          spins[i * 4 + 3] * step,
          tmpRot
        );
        tmpRot.multiplyToRef(tmpQ, tmpQ);
        Matrix.ComposeToRef(tmpScale, tmpQ, tmpPos, tmpM);
        tmpM.copyToArray(matrices, i * 16);
      }
      rock.thinInstanceBufferUpdated('matrix');
    },
  };
}

// Reused axis vector for rotation (module-scope, no per-call allocation).
const _axis = new Vector3();
function tmpVec(x, y, z) {
  _axis.set(x, y, z);
  return _axis;
}
