/**
 * Raw input state. Polled once per frame by the controller.
 * No allocations: everything lives in fixed fields / a Set.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.rmb = false;
    this.lmb = false;
    this._pointerLocked = false;

    // Edge-triggered key presses consumed by the ability system.
    this.pressed = new Set();

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      // Prevent scrolling/space page jump while flying.
      if (k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);

    this._onMouseMove = (e) => {
      if (this._pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    };
    this._onWheel = (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };
    this._onDown = (e) => {
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
      if (!this._pointerLocked) canvas.requestPointerLock?.();
    };
    this._onUp = (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    };
    this._onCtx = (e) => e.preventDefault();
    this._onLockChange = () => {
      this._pointerLocked = document.pointerLockElement === canvas;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    canvas.addEventListener('contextmenu', this._onCtx);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  down(code) {
    return this.keys.has(code);
  }

  /** Consume an edge-triggered press (true only on the frame the key went down). */
  consumePress(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Call at the end of each frame to reset deltas. */
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
  }
}
