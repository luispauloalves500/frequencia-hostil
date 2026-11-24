import { emptyFrame, type FrameInput } from "./core/sim";

/** Teclado e mouse. Em modo de diagnóstico (?debug=1) a captura do mouse é emulada. */
export class Input {
  keys = new Set<string>();
  private edges = new Set<string>();
  private btn = new Set<number>();
  private btnEdges = new Set<number>();
  dx = 0; dy = 0; wheel = 0;
  locked = false;
  emulateLock = false;
  /** depois de capturar o mouse, ignora o clique até ele ser solto (retomar não dispara) */
  suppressFire = false;
  onLockChange: (locked: boolean) => void = () => {};
  onEscape: () => void = () => {};
  onKey: (code: string) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (["Space", "Tab", "ControlLeft", "ControlRight", "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyF", "KeyR", "KeyC", "F3"].includes(e.code) && this.locked) e.preventDefault();
      if (e.code === "Escape") { this.onEscape(); }
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      this.onKey(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.btn.clear(); });
    window.addEventListener("mousemove", (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    window.addEventListener("mousedown", (e) => {
      this.held.add(e.button);
      if (!this.locked) return;
      if (this.suppressFire) return;
      this.btn.add(e.button); this.btnEdges.add(e.button);
    });
    window.addEventListener("mouseup", (e) => { this.held.delete(e.button); this.btn.delete(e.button); if (this.suppressFire) this.suppressFire = false; });
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("wheel", (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener("pointerlockchange", () => {
      if (this.emulateLock) return;
      const l = document.pointerLockElement === this.el;
      if (l !== this.locked) { this.locked = l; this.onLockChange(l); }
    });
  }

  /** botões fisicamente pressionados, capturado ou não */
  private held = new Set<number>();
  requestLock(fromClick: boolean) {
    // só ignora o clique se o botão que abriu a captura ainda estiver pressionado
    this.suppressFire = fromClick && this.held.size > 0;
    this.clear();
    if (this.emulateLock) { this.locked = true; this.onLockChange(true); return; }
    try {
      const r = (this.el as any).requestPointerLock?.({ unadjustedMovement: false });
      if (r && typeof r.catch === "function") r.catch(() => (this.el as any).requestPointerLock?.());
    } catch { /* navegador sem suporte */ }
  }
  releaseLock() {
    if (this.emulateLock) { this.locked = false; return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() { this.edges.clear(); this.btn.clear(); this.btnEdges.clear(); this.dx = this.dy = 0; this.wheel = 0; }

  pressed(code: string) { return this.edges.has(code); }

  /** Monta a entrada de um passo e consome as bordas. */
  frame(): FrameInput {
    const k = this.keys;
    const f = emptyFrame();
    f.fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    f.right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    f.sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    f.crouch = k.has("ControlLeft") || k.has("ControlRight") || k.has("KeyC");
    f.crouchPressed = this.edges.has("ControlLeft") || this.edges.has("ControlRight") || this.edges.has("KeyC");
    f.jump = this.edges.has("Space");
    f.fireHeld = this.btn.has(0);
    f.firePressed = this.btnEdges.has(0);
    f.altPressed = this.btnEdges.has(2);
    f.reload = this.edges.has("KeyR");
    f.beacon = this.edges.has("KeyQ");
    f.interact = this.edges.has("KeyE");
    f.heal = this.edges.has("KeyF");
    for (let i = 1; i <= 4; i++) if (this.edges.has(`Digit${i}`)) f.slot = i;
    if (this.wheel) { f.slot = -this.wheel; this.wheel = 0; }
    this.edges.clear(); this.btnEdges.clear();
    return f;
  }

  takeLook(): { dx: number; dy: number } { const r = { dx: this.dx, dy: this.dy }; this.dx = this.dy = 0; return r; }
}
