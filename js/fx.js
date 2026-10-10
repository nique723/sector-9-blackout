import * as THREE from "three";

// Everything here is pooled and created once. Nothing is added to or removed
// from the scene while playing, so firing never triggers a shader rebuild or
// a garbage-collection hitch.

const TRACER_SPEED = 240;
const TRACER_LEN = 5.5;
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function flashTexture() {
  return canvasTexture(128, (g, s) => {
    const h = s / 2;
    const core = g.createRadialGradient(h, h, 0, h, h, h);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.18, "rgba(255,236,170,0.95)");
    core.addColorStop(0.45, "rgba(255,150,40,0.35)");
    core.addColorStop(1, "rgba(255,90,0,0)");
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = "lighter";
    g.translate(h, h);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3 + (i % 2) * 0.2);
      const spike = g.createLinearGradient(0, 0, h, 0);
      spike.addColorStop(0, "rgba(255,240,190,0.9)");
      spike.addColorStop(1, "rgba(255,140,30,0)");
      g.fillStyle = spike;
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(h * (0.7 + (i % 3) * 0.14), 0);
      g.lineTo(0, 5);
      g.fill();
    }
  });
}

function softTexture(inner, outer) {
  return canvasTexture(64, (g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

function holeTexture() {
  return canvasTexture(64, (g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, "rgba(0,0,0,0.95)");
    grad.addColorStop(0.28, "rgba(10,10,12,0.9)");
    grad.addColorStop(0.5, "rgba(40,38,36,0.45)");
    grad.addColorStop(1, "rgba(60,58,54,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

export class Fx {
  constructor(scene, quality = "medium") {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "Fx";
    scene.add(this.root);
    const low = quality === "low";

    // Muzzle flashes: three crossed additive quads each.
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const face = new THREE.Mesh(quad, flashMat);
      const a = new THREE.Mesh(quad, flashMat);
      a.rotation.y = Math.PI / 2;
      a.position.z = 0.22;
      a.scale.set(1.5, 0.6, 1);
      const b = a.clone();
      b.rotation.set(0, Math.PI / 2, 0);
      b.rotateX(Math.PI / 2);
      g.add(face, a, b);
      g.visible = false;
      this.root.add(g);
      this.flashes.push({ group: g, life: 0 });
    }
    // One permanent light for the player's flash. Its intensity is animated;
    // it is never added or removed, so the light count stays constant.
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 9, 2);
    this.root.add(this.flashLight);
    this.flashLightT = 0;

    // Tracers: thin additive streaks that travel from muzzle to impact.
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracers = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe2a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, head: 0, active: false });
    }

    // Sparks: one Points object, particles recycled in a ring.
    this.sparkMax = low ? 90 : 180;
    this.sparkPos = new Float32Array(this.sparkMax * 3).fill(-999);
    this.sparkCol = new Float32Array(this.sparkMax * 3);
    this.sparkVel = new Float32Array(this.sparkMax * 3);
    this.sparkLife = new Float32Array(this.sparkMax);
    this.sparkNext = 0;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      size: 0.075, map: softTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"),
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true, fog: false
    }));
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);

    // Dust / smoke puffs.
    const puffTex = softTexture("rgba(255,255,255,0.75)", "rgba(255,255,255,0)");
    this.puffs = [];
    for (let i = 0; i < (low ? 6 : 12); i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      this.root.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, size: 0.2 });
    }
    this.puffNext = 0;

    // Bullet holes.
    const holeMat = new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    });
    this.holes = [];
    for (let i = 0; i < (low ? 16 : 36); i++) {
      const m = new THREE.Mesh(quad, holeMat);
      m.visible = false;
      this.root.add(m);
      this.holes.push(m);
    }
    this.holeNext = 0;

    // Ejected brass.
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.35 });
    const casingGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.028, 6);
    this.casings = [];
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(casingGeo, brass);
      mesh.visible = false;
      this.root.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    this.casingNext = 0;
  }

  muzzle(pos, dir, { scale = 1, light = false } = {}) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.life = 0.05;
    f.group.visible = true;
    f.group.position.copy(pos);
    f.group.quaternion.setFromUnitVectors(Z, dir);
    f.group.rotateZ(Math.random() * Math.PI * 2);
    f.group.scale.setScalar((0.2 + Math.random() * 0.1) * scale);
    if (light) {
      this.flashLight.position.copy(pos).addScaledVector(dir, 0.25);
      this.flashLight.intensity = 14;
      this.flashLightT = 0.06;
    }
    this.puff(v1.copy(pos).addScaledVector(dir, 0.12), v2.copy(dir).multiplyScalar(0.7).setY(0.35), 0.1, 0.28, 0xb9b3a8, 0.4);
  }

  tracer(from, to, color = 0xffe2a0) {
    const t = this.tracers.find((x) => !x.active) || this.tracers[0];
    t.from.copy(from);
    t.dir.copy(to).sub(from);
    t.len = t.dir.length();
    if (t.len < 0.6) return;
    t.dir.divideScalar(t.len);
    t.head = Math.min(1.2, t.len);
    t.active = true;
    t.mesh.material.color.setHex(color);
    t.mesh.quaternion.setFromUnitVectors(Z, t.dir);
    t.mesh.visible = true;
    this.placeTracer(t);
  }

  placeTracer(t) {
    const tail = Math.max(0, t.head - TRACER_LEN);
    const seg = Math.max(0.05, Math.min(t.head, t.len) - tail);
    t.mesh.scale.set(0.022, 0.022, seg);
    t.mesh.position.copy(t.from).addScaledVector(t.dir, tail + seg / 2);
  }

  spark(pos, vel, color, life) {
    const i = this.sparkNext;
    this.sparkNext = (i + 1) % this.sparkMax;
    this.sparkPos.set([pos.x, pos.y, pos.z], i * 3);
    this.sparkVel.set([vel.x, vel.y, vel.z], i * 3);
    this.sparkCol.set([color.r, color.g, color.b], i * 3);
    this.sparkLife[i] = life;
  }

  burst(pos, normal, count, color, speed = 5) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      v1.addScaledVector(normal, 0.9).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.75));
      this.spark(pos, v1, col, 0.18 + Math.random() * 0.3);
    }
  }

  puff(pos, vel, size, life, color = 0x9a958c, opacity = 0.55) {
    const p = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % this.puffs.length;
    p.life = p.max = life;
    p.size = size;
    p.opacity = opacity;
    p.vel.copy(vel);
    p.sprite.position.copy(pos);
    p.sprite.material.color.setHex(color);
    p.sprite.visible = true;
  }

  hole(pos, normal) {
    const m = this.holes[this.holeNext];
    this.holeNext = (this.holeNext + 1) % this.holes.length;
    m.position.copy(pos).addScaledVector(normal, 0.012);
    m.quaternion.setFromUnitVectors(Z, normal);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(0.11 + Math.random() * 0.05);
    m.visible = true;
  }

  // kind: "wall" | "ground" | "enemy"
  impact(pos, normal, kind, color = 0xffc070) {
    if (kind === "enemy") {
      this.burst(pos, normal, 12, color, 4.5);
      this.burst(pos, normal, 5, 0xffffff, 6);
      return;
    }
    this.burst(pos, normal, kind === "ground" ? 6 : 10, 0xffc878, 5.5);
    this.puff(v1.copy(pos).addScaledVector(normal, 0.06), v2.copy(normal).multiplyScalar(0.9).setY(normal.y * 0.9 + 0.3), 0.14, 0.45);
    this.hole(pos, normal);
  }

  casing(pos, right, up) {
    const c = this.casings[this.casingNext];
    this.casingNext = (this.casingNext + 1) % this.casings.length;
    c.mesh.position.copy(pos);
    c.mesh.visible = true;
    c.vel.copy(right).multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 2.2 + Math.random() * 0.8);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.life = 1.4;
  }

  update(dt) {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.group.visible = false;
    }
    if (this.flashLightT > 0) {
      this.flashLightT -= dt;
      this.flashLight.intensity = this.flashLightT > 0 ? 14 * (this.flashLightT / 0.06) : 0;
    }

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.head += TRACER_SPEED * dt;
      if (t.head - TRACER_LEN >= t.len) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      this.placeTracer(t);
    }

    let dirty = false;
    for (let i = 0; i < this.sparkMax; i++) {
      if (this.sparkLife[i] <= 0) continue;
      dirty = true;
      this.sparkLife[i] -= dt;
      const j = i * 3;
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[j + 1] = -999;
        continue;
      }
      this.sparkVel[j + 1] -= 13 * dt;
      this.sparkPos[j] += this.sparkVel[j] * dt;
      this.sparkPos[j + 1] += this.sparkVel[j + 1] * dt;
      this.sparkPos[j + 2] += this.sparkVel[j + 2] * dt;
      if (this.sparkPos[j + 1] < 0.02 && this.sparkVel[j + 1] < 0) {
        this.sparkPos[j + 1] = 0.02;
        this.sparkVel[j + 1] *= -0.35;
      }
    }
    if (dirty) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
    }

    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - Math.min(1, dt * 3));
      p.sprite.scale.setScalar(p.size * (1 + k * 3.2));
      p.sprite.material.opacity = p.opacity * (1 - k);
    }

    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vel.y -= 12 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.02) {
        c.mesh.position.y = 0.02;
        c.vel.y *= -0.35;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        c.spin.multiplyScalar(0.4);
      }
    }
  }

  reset() {
    for (const f of this.flashes) { f.life = 0; f.group.visible = false; }
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
    for (const h of this.holes) h.visible = false;
    for (const c of this.casings) { c.life = 0; c.mesh.visible = false; }
    for (const p of this.puffs) { p.life = 0; p.sprite.visible = false; }
    this.sparkLife.fill(0);
    this.sparkPos.fill(-999);
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.flashLight.intensity = 0;
  }
}

export { UP };
