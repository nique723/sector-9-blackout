export class Input {
  constructor() {
    this.pointers = new Map();
    this.move = { x: 0, y: 0, active: false };
    this.look = { dx: 0, dy: 0 };
    this.fireHeld = false;
    this.sprint = false;
    this.edges = { melee: false, dodge: false, use: false, reload: false, weapon: false, pause: false };
    this.keys = new Set();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.mouseDown = false;
    this.locked = false;
    this.sensitivity = 1;
    this.blocked = false;
  }

  bind() {
    const joy = document.getElementById("joy");
    const stick = document.getElementById("joy-stick");
    const fire = document.getElementById("btn-fire");
    const buttons = document.querySelectorAll("[data-action]");
    const canvas = document.getElementById("view");

    const down = (e) => {
      if (this.blocked) return;
      const el = e.currentTarget;
      const action = el.dataset.action;
      if (this.pointers.has(e.pointerId)) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      const rec = { role: action, el, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      this.pointers.set(e.pointerId, rec);
      el.classList.add("pressed");
      if (action === "move") this.move.active = true;
      if (action === "fire") this.fireHeld = true;
      if (action === "sprint") {
        this.sprint = !this.sprint;
        el.classList.toggle("on", this.sprint);
      }
      if (["melee", "dodge", "use", "reload", "weapon", "pause"].includes(action)) this.edges[action] = true;
      e.preventDefault();
    };

    const move = (e) => {
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      if (rec.role === "move") {
        const box = joy.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const max = box.width * 0.38;
        const len = Math.hypot(dx, dy) || 1;
        const clamped = Math.min(len, max);
        dx = (dx / len) * clamped;
        dy = (dy / len) * clamped;
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
        this.move.x = dx / max;
        this.move.y = dy / max;
      } else if (rec.role === "fire" || rec.role === "aim") {
        this.look.dx += e.clientX - rec.x;
        this.look.dy += e.clientY - rec.y;
        rec.x = e.clientX;
        rec.y = e.clientY;
      }
      e.preventDefault();
    };

    const up = (e) => {
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      rec.el.classList.remove("pressed");
      this.pointers.delete(e.pointerId);
      if (rec.role === "move") {
        this.move.x = 0;
        this.move.y = 0;
        this.move.active = this.any("move");
        if (!this.move.active) stick.style.transform = "translate(0px, 0px)";
      }
      if (rec.role === "fire") this.fireHeld = this.any("fire");
    };

    buttons.forEach((btn) => {
      btn.addEventListener("pointerdown", down);
    });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    canvas.addEventListener("pointerdown", (e) => {
      if (this.blocked || e.target !== canvas) return;
      const r = canvas.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      if (nx < 0.46) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.pointers.set(e.pointerId, { role: "aim", el: canvas, x: e.clientX, y: e.clientY });
      e.preventDefault();
    });

    window.addEventListener("keydown", (e) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "KeyR") this.edges.reload = true;
      if (e.code === "KeyE") this.edges.use = true;
      if (e.code === "KeyQ") this.edges.melee = true;
      if (e.code === "Space") this.edges.dodge = true;
      if (e.code === "Escape") this.edges.pause = true;
      if (e.code === "Digit1" || e.code === "KeyF") this.edges.weapon = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDx += e.movementX || 0;
      this.mouseDy += e.movementY || 0;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0 && this.locked) this.mouseDown = true;
    });
    window.addEventListener("mouseup", () => { this.mouseDown = false; });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener("blur", () => this.clearHeld());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearHeld();
    });
  }

  any(role) {
    for (const rec of this.pointers.values()) if (rec.role === role) return true;
    return false;
  }

  clearHeld() {
    this.pointers.clear();
    this.move.x = 0;
    this.move.y = 0;
    this.move.active = false;
    this.fireHeld = false;
    this.mouseDown = false;
    const stick = document.getElementById("joy-stick");
    if (stick) stick.style.transform = "translate(0px, 0px)";
    document.querySelectorAll(".pressed").forEach((el) => el.classList.remove("pressed"));
  }

  consumeLook() {
    const s = this.sensitivity;
    const dx = (this.look.dx + this.mouseDx) * 0.0042 * s;
    const dy = (this.look.dy + this.mouseDy) * 0.0032 * s;
    this.look.dx = 0;
    this.look.dy = 0;
    this.mouseDx = 0;
    this.mouseDy = 0;
    return { dx, dy };
  }

  take(name) {
    const v = this.edges[name];
    this.edges[name] = false;
    return v;
  }

  wishMove() {
    let x = this.move.x;
    let y = this.move.y;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  firing() {
    return this.fireHeld || this.mouseDown;
  }

  sprinting() {
    return this.sprint || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }
}
