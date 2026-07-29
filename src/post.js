/* =========================================================================
   THE LONG QUIET — post.js
   A small hand-rolled post chain: scene -> bright pass -> separable blur ->
   composite (bloom, lensing, tonemap, grain, vignette). No example modules.
   ========================================================================= */
(function (global) {
  'use strict';

  function Post(renderer, scene, camera) {
    const self = {};
    const size = new THREE.Vector2();
    renderer.getSize(size);

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false
    };

    let rtScene = new THREE.WebGLRenderTarget(size.x, size.y, rtOpts);
    let rtA = new THREE.WebGLRenderTarget(size.x / 2, size.y / 2, { ...rtOpts, depthBuffer: false });
    let rtB = new THREE.WebGLRenderTarget(size.x / 2, size.y / 2, { ...rtOpts, depthBuffer: false });

    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(quadGeo, null);
    quad.frustumCulled = false;
    quadScene.add(quad);

    const brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 0.86 },
        uSoft: { value: 0.5 }
      },
      vertexShader: SH.quadVert, fragmentShader: SH.brightFrag, depthTest: false, depthWrite: false
    });

    const blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) }
      },
      vertexShader: SH.quadVert, fragmentShader: SH.blurFrag, depthTest: false, depthWrite: false
    });

    const compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uResolution: { value: new THREE.Vector2(size.x, size.y) },
        uTime: { value: 0 },
        uBloom: { value: 0.85 },
        uExposure: { value: 1.15 },
        uVignette: { value: 0.75 },
        uGrain: { value: 0.035 },
        uChroma: { value: 0.3 },
        uFade: { value: 0 },
        uWarp: { value: 0 },
        uShake: { value: 0 },
        uHolePos: { value: new THREE.Vector2(0.5, 0.5) },
        uHoleStrength: { value: 0 },
        uHoleRadius: { value: 0.05 },
        uHoleVisible: { value: 0 }
      },
      vertexShader: SH.quadVert, fragmentShader: SH.compositeFrag, depthTest: false, depthWrite: false
    });

    self.uniforms = compMat.uniforms;

    function blit(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target || null);
      renderer.render(quadScene, quadCam);
    }

    self.setSize = function (w, h, pr) {
      const W = Math.max(2, Math.floor(w * pr));
      const H = Math.max(2, Math.floor(h * pr));
      rtScene.setSize(W, H);
      rtA.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
      rtB.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
      compMat.uniforms.uResolution.value.set(W, H);
      blurMat.uniforms.uTexel.value.set(2 / W, 2 / H);
    };

    self.render = function (t) {
      compMat.uniforms.uTime.value = t;

      // 1. Scene.
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);

      // 2. Bright pass at half resolution.
      brightMat.uniforms.tDiffuse.value = rtScene.texture;
      blit(brightMat, rtA);

      // 3. Two separable blur iterations, widening each time.
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tDiffuse.value = rtA.texture;
        blurMat.uniforms.uDir.value.set(1 + i, 0);
        blit(blurMat, rtB);
        blurMat.uniforms.tDiffuse.value = rtB.texture;
        blurMat.uniforms.uDir.value.set(0, 1 + i);
        blit(blurMat, rtA);
      }

      // 4. Composite to the screen.
      compMat.uniforms.tScene.value = rtScene.texture;
      compMat.uniforms.tBloom.value = rtA.texture;
      blit(compMat, null);
    };

    self.dispose = function () {
      rtScene.dispose(); rtA.dispose(); rtB.dispose();
      quadGeo.dispose(); brightMat.dispose(); blurMat.dispose(); compMat.dispose();
    };

    return self;
  }

  global.POST = { Post };
})(window);
