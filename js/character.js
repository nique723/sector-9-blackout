import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// Skinned characters with motion-captured locomotion, plus a procedural upper
// body: the gun is placed where the shot actually leaves from, and the arms
// are solved onto it. So the barrel, the tracer and the crosshair always agree.
//
// SWAPPING A MODEL
// Point an entry below at a rigged GLB in assets/characters/. It needs a
// Mixamo-style skeleton (Hips, Spine, Spine1, Spine2, Head, Left/RightArm,
// ForeArm, Hand) and clips whose names contain "idle", "walk" and "run".
// Optional clips are picked up by name and replace the procedural versions:
// "hit" (flinch), "death" (one or more; one named "head" is used for
// headshots), "reload". Set `faces` to Math.PI if the model looks down -Z.
// Entries that share a file load it once.
const MODELS = {
  // Ghost: the Meshy "Crimson Sentinel" mesh bound to the Mixamo skeleton.
  // headFrac is how far up the body the head bone sits (hair adds height).
  ghost: { file: "ghost.glb", faces: Math.PI, walkSpeed: 1.5, runSpeed: 4.3, headFrac: 0.886 },
  // Stand-in for the Blackout Crew until the Mixamo militia is converted.
  crew: { file: "crew.glb", faces: Math.PI, walkSpeed: 1.5, runSpeed: 4.3 }
};

const UP = new THREE.Vector3(0, 1, 0);
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const vd = new THREE.Vector3();
const ve = new THREE.Vector3();
const m1 = new THREE.Matrix4();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

export async function loadCharacters(base = "assets/characters/") {
  const loader = new GLTFLoader();
  const files = {};
  const out = {};
  await Promise.all(Object.entries(MODELS).map(async ([key, spec]) => {
    files[spec.file] = files[spec.file] || loader.loadAsync(base + spec.file);
    const gltf = await files[spec.file];
    const find = (re) => gltf.animations.find((c) => re.test(c.name));
    const clips = { idle: find(/idle/i), walk: find(/walk/i), run: find(/run/i) };
    for (const [name, clip] of Object.entries(clips)) {
      if (!clip) throw new Error(`${spec.file} has no "${name}" animation`);
    }
    clips.hit = find(/hit|react/i) || null;
    clips.reload = find(/reload/i) || null;
    clips.deaths = gltf.animations.filter((c) => /death|dying|die/i.test(c.name));
    clips.headDeath = clips.deaths.find((c) => /head/i.test(c.name)) || null;
    out[key] = { scene: gltf.scene, clips, spec };
  }));
  return out;
}

function findBone(root, name) {
  const re = new RegExp("(^|[^A-Za-z])" + name + "$|mixamorig" + name + "$");
  let hit = null;
  root.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

// Rotate a bone by a world-space delta, optionally blended with the pose the
// animation gave it.
function applyWorldDelta(bone, delta, w = 1) {
  bone.getWorldQuaternion(q1);
  q2.copy(delta).multiply(q1);
  bone.parent.getWorldQuaternion(q3).invert();
  q2.premultiply(q3);
  if (w >= 0.999) bone.quaternion.copy(q2);
  else bone.quaternion.slerp(q2, w);
  bone.updateWorldMatrix(false, true);
}

// Two-bone IK: bend upper/fore so the wrist lands on `target`, with the elbow
// pushed towards `pole`.
function solveArm(upper, fore, hand, target, pole, w) {
  const S = upper.getWorldPosition(va);
  const E = fore.getWorldPosition(vb);
  const H = hand.getWorldPosition(vc);
  const a = S.distanceTo(E);
  const b = E.distanceTo(H);
  const toT = vd.copy(target).sub(S);
  const d = clamp(toT.length(), 0.05, (a + b) * 0.995);
  toT.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = ve.copy(pole).addScaledVector(toT, -pole.dot(toT));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0);
  p.normalize();
  const elbow = p.multiplyScalar(h).addScaledVector(toT, x).add(S);
  const cur = E.sub(S).normalize();
  const want = elbow.sub(S).normalize();
  applyWorldDelta(upper, q1.setFromUnitVectors(cur, want).clone(), w);
  const E2 = fore.getWorldPosition(va);
  const H2 = hand.getWorldPosition(vb);
  const cur2 = H2.sub(E2).normalize();
  const want2 = vc.copy(target).sub(E2).normalize();
  applyWorldDelta(fore, q1.setFromUnitVectors(cur2, want2).clone(), w);
}

function pointBone(bone, tip, dir, w) {
  const from = bone.getWorldPosition(va);
  const cur = tip.getWorldPosition(vb).sub(from).normalize();
  applyWorldDelta(bone, q1.setFromUnitVectors(cur, dir).clone(), w);
}

let shadowTex = null;
function blobShadow(radius) {
  if (!shadowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.62)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.025;
  mesh.renderOrder = 1;
  return mesh;
}

const metal = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.38, ...extra });

// Barrel along +Z, origin at the top of the grip.
function makePistol() {
  const g = new THREE.Group();
  const dark = metal(0x15171b);
  const steel = metal(0x3a3f47, { roughness: 0.3 });
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.03, 0.034, 0.2), steel, 0, 0.03, 0.065);
  add(new THREE.BoxGeometry(0.028, 0.022, 0.15), dark, 0, 0.004, 0.05);
  add(new THREE.BoxGeometry(0.03, 0.115, 0.046), dark, 0, -0.055, -0.016, 0.24);
  add(new THREE.BoxGeometry(0.008, 0.008, 0.052), dark, 0, -0.04, 0.05);
  add(new THREE.BoxGeometry(0.008, 0.034, 0.008), dark, 0, -0.024, 0.074);
  add(new THREE.BoxGeometry(0.006, 0.01, 0.012), dark, 0, 0.051, -0.02);
  add(new THREE.BoxGeometry(0.004, 0.009, 0.008), dark, 0, 0.051, 0.155);
  add(new THREE.BoxGeometry(0.02, 0.02, 0.012), metal(0x080809), 0, 0.03, 0.166);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, 0.18);
  g.userData.eject = new THREE.Vector3(0.02, 0.04, 0.03);
  g.scale.setScalar(1.25);
  return g;
}

// kind: "rifle" | "smg" | "heavy"
function makeRifle(glow, kind = "rifle") {
  const g = new THREE.Group();
  const dark = metal(0x1a1d22, { roughness: 0.45 });
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  };
  add(new THREE.BoxGeometry(0.05, 0.075, 0.42), dark, 0, 0.03, 0.12);
  add(new THREE.BoxGeometry(0.03, 0.03, 0.26), metal(0x0c0d0f), 0, 0.035, 0.45);
  add(new THREE.BoxGeometry(0.045, 0.06, 0.22), dark, 0, 0.015, -0.2);
  add(new THREE.BoxGeometry(0.035, 0.11, 0.045), dark, 0, -0.055, -0.01, 0.25);
  add(new THREE.BoxGeometry(0.035, 0.13, 0.06), dark, 0, -0.06, 0.15, -0.15);
  add(new THREE.BoxGeometry(0.052, 0.012, 0.3), new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.2 }), 0, 0.072, 0.12);
  g.userData.muzzle = new THREE.Vector3(0, 0.035, 0.58);
  if (kind === "smg") {
    g.scale.set(1, 1, 0.72);
  } else if (kind === "heavy") {
    g.scale.set(1.45, 1.3, 1.08);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), dark);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.07, 0.1);
    g.add(drum);
  }
  return g;
}

// Blade along +Z.
function makeKnife() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, 0.1), metal(0x111316, { metalness: 0.2, roughness: 0.8 }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.032, 0.17), metal(0xcfd6de, { metalness: 0.9, roughness: 0.2 }));
  blade.position.z = 0.135;
  g.add(handle, blade);
  return g;
}

// Long coat tails that hang from the hips. Each tail is three hinged strips,
// so it drapes and trails in a curve instead of swinging like a board.
function makeCoat() {
  const g = new THREE.Group();
  const outer = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.9, side: THREE.FrontSide });
  const inner = new THREE.MeshStandardMaterial({ color: 0x6e141c, roughness: 0.8, side: THREE.BackSide });
  const tails = [];
  const SEG = 3;
  const LEN = 0.84;
  // [x, z, yaw, width]
  const layout = [[-0.19, -0.06, -0.8, 0.26], [-0.075, -0.135, -0.16, 0.19], [0.075, -0.135, 0.16, 0.19], [0.19, -0.06, 0.8, 0.26]];
  for (const [x, z, yaw, width] of layout) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, z);
    pivot.rotation.y = Math.PI + yaw;
    const joints = [];
    let parent = pivot;
    for (let i = 0; i < SEG; i++) {
      const h = LEN / SEG;
      const top = width * (1 + (i / SEG) * 0.4);
      const bottom = width * (1 + ((i + 1) / SEG) * 0.4);
      const geo = new THREE.PlaneGeometry(1, h, 1, 1);
      geo.translate(0, -h / 2, 0);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) pos.setX(v, pos.getX(v) * (pos.getY(v) > -h / 2 ? top : bottom));
      geo.computeVertexNormals();
      const joint = new THREE.Group();
      joint.position.y = i === 0 ? 0 : -h;
      joint.add(new THREE.Mesh(geo, outer), new THREE.Mesh(geo, inner));
      parent.add(joint);
      parent = joint;
      joints.push(joint);
    }
    g.add(pivot);
    tails.push({ joints, phase: x * 9 });
  }
  g.userData.tails = tails;
  return g;
}

export class Rig {
  // opts: { height, weapon: "pistol" | "rifle", gun: "rifle" | "smg" | "heavy",
  //         mono, tint, body, glow, glowPower, coat, armband, bulk }
  constructor(asset, opts = {}) {
    this.spec = asset.spec;
    this.opts = opts;
    this.height = opts.height || 1.82;
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);
    this.model = cloneSkinned(asset.scene);
    this.model.rotation.y = this.spec.faces;
    this.tilt.add(this.model);

    this.mats = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = false;
      o.material = o.material.clone();
      const mat = o.material;
      const accent = /visor|joint/i.test(mat.name) || /visor|joint/i.test(o.name);
      if (accent && opts.glow !== undefined) {
        mat.color.setHex(0x101114);
        mat.emissive = new THREE.Color(opts.glow);
        mat.emissiveIntensity = opts.glowPower ?? 1.1;
      } else {
        if (opts.body !== undefined) {
          mat.color.setHex(opts.body);
          mat.metalness = 0.55;
          mat.roughness = 0.5;
        } else if (opts.tint !== undefined) {
          mat.color.setHex(opts.tint);
        } else if (opts.mono !== undefined) {
          // Keep the texture's detail but drop its colour, so the suit reads
          // as black tactical gear instead of the stock model's tan.
          mat.color.setHex(opts.mono);
          mat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              "#include <map_fragment>",
              "#include <map_fragment>\n  diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));"
            );
          };
          mat.customProgramCacheKey = () => "mono";
        }
        this.mats.push(mat);
      }
    });

    const b = (n) => findBone(this.model, n);
    this.bones = {
      hips: b("Hips"), spine: b("Spine"), spine1: b("Spine1"), spine2: b("Spine2"), head: b("Head"),
      armR: b("RightArm"), foreR: b("RightForeArm"), handR: b("RightHand"), tipR: b("RightHandMiddle1"),
      armL: b("LeftArm"), foreL: b("LeftForeArm"), handL: b("LeftHand"), tipL: b("LeftHandMiddle1")
    };
    for (const [k, v] of Object.entries(this.bones)) {
      if (!v) throw new Error(`${this.spec.file}: skeleton is missing the ${k} bone`);
    }

    this.clips = asset.clips;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.act = {};
    for (const key of ["idle", "walk", "run"]) {
      const a = this.mixer.clipAction(asset.clips[key]);
      a.play();
      a.setEffectiveWeight(key === "idle" ? 1 : 0);
      this.act[key] = a;
    }
    this.w = { idle: 1, walk: 0, run: 0 };
    this.phase = Math.random();
    this.idleT = Math.random() * 2;

    // Fit to height using the head bone in the idle pose.
    this.mixer.update(0);
    this.group.updateMatrixWorld(true);
    const headY = this.bones.head.getWorldPosition(va).y;
    this.model.scale.multiplyScalar((this.height * (this.spec.headFrac ?? 0.87)) / Math.max(0.01, headY));

    if (opts.bulk) this.model.scale.x *= opts.bulk, this.model.scale.z *= opts.bulk;

    // Glowing armbands: team colour readable at a glance from any angle.
    if (opts.armband !== undefined) {
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: opts.armband, emissiveIntensity: 2.6, side: THREE.DoubleSide });
      this.group.updateMatrixWorld(true);
      for (const [arm, fore] of [[this.bones.armL, this.bones.foreL], [this.bones.armR, this.bones.foreR]]) {
        const ws = arm.getWorldScale(va).x;
        const len = arm.getWorldPosition(vb).distanceTo(fore.getWorldPosition(vc));
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.1, 14, 1, true), bandMat);
        band.scale.setScalar(1 / ws);
        band.position.y = (len * 0.42) / ws;
        arm.add(band);
      }
    }

    this.weapon = opts.weapon === "rifle" ? makeRifle(opts.glow ?? 0xff3344, opts.gun) : makePistol();
    this.group.add(this.weapon);
    this.rifle = opts.weapon === "rifle";
    if (!this.rifle) {
      this.knife = makeKnife();
      this.knife.visible = false;
      this.group.add(this.knife);
    }
    if (opts.coat) {
      this.coat = makeCoat();
      this.group.add(this.coat);
    }
    this.shadow = blobShadow(0.62 * (this.height / 1.82));
    this.group.add(this.shadow);

    this.aimW = 0;
    this.poseW = 0;
    this.pose = "none";
    this.swingV = 0;
    this.muzzle = new THREE.Vector3();
    this.eject = new THREE.Vector3();
    this.gunDir = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.footDown = false;
    this.stepped = false;
    this.oneShot = null;     // { action, t, dur, hold }
    this.flinch = 0;
    this.deathPlayed = false;
  }

  // One-shot clips layered over locomotion. Returns false when the model has
  // no such clip, so the caller can fall back to the procedural version.
  playOnce(clip, hold = false) {
    if (!clip) return false;
    if (this.oneShot) this.oneShot.action.stop();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.oneShot = { action, t: 0, dur: clip.duration, hold };
    return true;
  }

  // Hit reaction: the clip if there is one, otherwise a procedural flinch.
  react(head = false) {
    this.flinch = head ? 1.25 : 1;
    if (this.clips.hit && !this.deathPlayed) this.playOnce(this.clips.hit);
  }

  // Start the death animation. Returns true if a clip is playing it.
  die(head = false) {
    const c = this.clips;
    const clip = (head && c.headDeath) || (c.deaths.length ? c.deaths[Math.floor(Math.random() * c.deaths.length)] : null);
    this.deathPlayed = this.playOnce(clip, true);
    return this.deathPlayed;
  }

  // Where a shot leaves from when aiming at `aimPoint`. Pure maths, no bones,
  // so gameplay can ask before the pose has caught up.
  aimFrame(pos, facing, aimPoint, out) {
    const H = this.height / 1.82;
    const rightV = out.right.set(-Math.cos(facing), 0, Math.sin(facing));
    const chest = out.chest.set(pos.x, pos.y + 1.4 * H, pos.z);
    const aimDir = out.aimDir.copy(aimPoint).sub(chest);
    if (aimDir.lengthSq() < 0.04) aimDir.set(Math.sin(facing), 0, Math.cos(facing));
    aimDir.normalize();
    aimDir.y = clamp(aimDir.y, -0.72, 0.72);
    aimDir.normalize();
    const reach = this.rifle ? 0.34 : 0.5;
    out.grip.copy(chest).addScaledVector(aimDir, reach * H).addScaledVector(rightV, (this.rifle ? 0.15 : 0.13) * H);
    out.grip.y += (this.rifle ? -0.04 : 0.07) * H;
    const gd = out.gunDir.copy(aimPoint).sub(out.grip);
    if (gd.lengthSq() < 1.2 || gd.clone().normalize().dot(aimDir) < 0.9) gd.copy(aimDir);
    gd.normalize();
    const mz = this.weapon.userData.muzzle;
    const s = this.weapon.scale.x;
    out.muzzle.copy(out.grip).addScaledVector(gd, mz.z * s).addScaledVector(UP, mz.y * s);
    return out;
  }

  flash(amount) {
    for (const m of this.mats) {
      if (m.emissive) m.emissive.setScalar(amount * 0.9);
    }
  }

  // s: { pos, facing, lower, speed, backward, aim, aimPoint, kick, pose, poseT, knife, snapAim }
  update(dt, s) {
    const B = this.bones;
    const H = this.height / 1.82;
    this.group.position.copy(s.pos);
    this.group.rotation.set(0, s.facing + (s.lower || 0), 0);

    // --- Locomotion: idle / walk / run blended by ground speed, with the
    // walk and run cycles phase-locked so feet never cross-fade out of step.
    const sp = s.pose === "dead" ? 0 : s.speed;
    const moveAmt = clamp(sp / 0.9, 0, 1);
    const runFrac = clamp((sp - this.spec.walkSpeed) / (this.spec.runSpeed - this.spec.walkSpeed), 0, 1);
    const target = { idle: 1 - moveAmt, walk: moveAmt * (1 - runFrac), run: moveAmt * runFrac };
    const k = 1 - Math.exp(-dt * 12);
    let sum = 0;
    for (const key of ["idle", "walk", "run"]) {
      this.w[key] += (target[key] - this.w[key]) * k;
      sum += this.w[key];
    }
    const walkClip = this.act.walk.getClip();
    const runClip = this.act.run.getClip();
    const stride = lerp(this.spec.walkSpeed * walkClip.duration, this.spec.runSpeed * runClip.duration, runFrac) * H;
    const prev = this.phase;
    this.phase = (this.phase + (s.backward ? -1 : 1) * (sp / stride) * dt + 1) % 1;
    this.stepped = sp > 1 && Math.floor(prev * 2) !== Math.floor(this.phase * 2);
    this.idleT = (this.idleT + dt) % this.act.idle.getClip().duration;
    this.act.idle.time = this.idleT;
    this.act.walk.time = this.phase * walkClip.duration;
    this.act.run.time = this.phase * runClip.duration;
    let shotW = 0;
    if (this.oneShot) {
      const o = this.oneShot;
      o.t += dt;
      const fadeIn = clamp(o.t / 0.08, 0, 1);
      const fadeOut = o.hold ? 1 : clamp((o.dur - o.t) / 0.15, 0, 1);
      shotW = fadeIn * fadeOut;
      o.action.time = Math.min(o.t, o.dur - 1e-3);
      o.action.setEffectiveWeight(shotW);
      if (!o.hold && o.t >= o.dur) {
        o.action.stop();
        this.oneShot = null;
        shotW = 0;
      }
    }
    for (const key of ["idle", "walk", "run"]) this.act[key].setEffectiveWeight((this.w[key] / sum) * (1 - shotW));
    this.mixer.update(0);

    // --- Whole-body poses with no clip behind them.
    let tiltX = 0;
    let dropY = 0;
    if (s.pose === "dead" && !this.deathPlayed) {
      const t = clamp(s.poseT, 0, 1);
      const fall = t * t;
      const bounce = t > 0.82 ? Math.sin((t - 0.82) / 0.18 * Math.PI) * 0.05 : 0;
      tiltX = -(fall - bounce) * Math.PI * 0.5;
      dropY = 0.11 * fall * H;
    } else if (s.pose === "dodge") {
      const a = Math.sin(clamp(s.poseT, 0, 1) * Math.PI);
      tiltX = 0.5 * a;
      dropY = -0.1 * a * H;
    }
    this.tilt.rotation.x = tiltX;
    this.tilt.position.y = dropY;
    this.shadow.material.opacity = s.pose === "dead" ? 1 - 0.6 * clamp(s.poseT, 0, 1) : 1;
    this.group.updateMatrixWorld(true);

    // No death clip, so let the arms fall open as the body goes down.
    if (s.pose === "dead" && !this.deathPlayed) {
      const open = smooth(clamp(s.poseT, 0, 1)) * 0.85;
      const axis = va.set(Math.sin(s.facing), 0, Math.cos(s.facing)).clone();
      applyWorldDelta(B.armR, q1.setFromAxisAngle(axis, open).clone());
      applyWorldDelta(B.armL, q1.setFromAxisAngle(axis, -open).clone());
    }

    // Legs follow the direction of travel, chest stays on target.
    if (s.lower) applyWorldDelta(B.spine, q1.setFromAxisAngle(UP, -s.lower).clone());

    // Procedural flinch: the chest snaps back and twists, then recovers.
    this.flinch = Math.max(0, this.flinch - dt * 5);
    if (this.flinch > 0.01 && !this.clips.hit && s.pose !== "dead") {
      const f = Math.sin(this.flinch * Math.PI * 0.5) * this.flinch;
      const r = va.set(-Math.cos(s.facing), 0, Math.sin(s.facing)).clone();
      applyWorldDelta(B.spine1, q1.setFromAxisAngle(r, -0.32 * f).clone());
      applyWorldDelta(B.spine2, q1.setFromAxisAngle(UP, 0.25 * f).clone());
      applyWorldDelta(B.head, q1.setFromAxisAngle(r, -0.3 * f).clone());
    }

    const dead = s.pose === "dead";
    const wantAim = !!s.aim && !!s.aimPoint && !dead && !s.knife;
    if (s.snapAim && wantAim) this.aimW = Math.max(this.aimW, 0.85);
    this.aimW += ((wantAim ? 1 : 0) - this.aimW) * (1 - Math.exp(-dt * (wantAim ? 20 : 9)));
    const posed = s.pose === "reload" || s.pose === "melee";
    if (posed) this.pose = s.pose;
    this.poseW += ((posed ? 1 : 0) - this.poseW) * (1 - Math.exp(-dt * 16));

    const fwd = vd.set(Math.sin(s.facing), 0, Math.cos(s.facing)).clone();
    const frame = this._frame || (this._frame = {
      right: new THREE.Vector3(), chest: new THREE.Vector3(), aimDir: new THREE.Vector3(),
      grip: new THREE.Vector3(), gunDir: new THREE.Vector3(), muzzle: new THREE.Vector3()
    });
    const aimPoint = s.aimPoint || va.copy(s.pos).addScaledVector(fwd, 10).setY(s.pos.y + 1.4 * H).clone();
    this.aimFrame(s.pos, s.facing, aimPoint, frame);
    const rightV = this.right.copy(frame.right);
    const kick = s.kick || 0;

    // Lean the spine into the aim pitch.
    if (this.aimW > 0.01) {
      const pitch = Math.asin(clamp(frame.aimDir.y, -1, 1)) * 0.3 * this.aimW;
      const lean = q1.setFromAxisAngle(rightV, pitch).clone();
      applyWorldDelta(B.spine1, lean);
      applyWorldDelta(B.spine2, lean);
    }

    // --- Weapon target for this frame.
    const grip = frame.grip.clone();
    const gunDir = frame.gunDir.clone();
    if (kick > 0) {
      gunDir.applyAxisAngle(rightV, kick * 0.16).normalize();
      grip.addScaledVector(frame.aimDir, -kick * 0.04).y += kick * 0.012;
    }
    let ikR = this.aimW;
    let ikL = this.aimW;
    const leftTarget = new THREE.Vector3();
    const pw = this.poseW;
    if (pw > 0.01 && this.pose === "reload") {
      const t = clamp(s.pose === "reload" ? s.poseT : 1, 0, 1);
      const rg = frame.chest.clone().addScaledVector(fwd, 0.3 * H).addScaledVector(rightV, 0.1 * H);
      rg.y -= 0.06 * H;
      const rd = fwd.clone().multiplyScalar(0.55).addScaledVector(UP, 0.8).addScaledVector(rightV, -0.22).normalize();
      grip.lerp(rg, pw);
      gunDir.lerp(rd, pw).normalize();
      ikR = Math.max(ikR, pw);
      ikL = Math.max(ikL, pw);
      // Left hand: drop to the belt for a fresh magazine, seat it, rack the slide.
      const belt = s.pos.clone().addScaledVector(rightV, -0.2 * H).addScaledVector(fwd, 0.1 * H);
      belt.y += 0.98 * H;
      const mag = rg.clone().addScaledVector(UP, -0.1 * H);
      const slide = rg.clone().addScaledVector(rd, 0.06).addScaledVector(UP, 0.03);
      if (t < 0.2) leftTarget.copy(mag);
      else if (t < 0.45) leftTarget.lerpVectors(mag, belt, smooth((t - 0.2) / 0.25));
      else if (t < 0.7) leftTarget.lerpVectors(belt, mag, smooth((t - 0.45) / 0.25));
      else leftTarget.lerpVectors(mag, slide, smooth(clamp((t - 0.7) / 0.15, 0, 1)));
    } else if (pw > 0.01 && this.pose === "melee") {
      const t = smooth(clamp(s.pose === "melee" ? s.poseT : 1, 0, 1));
      const a = frame.chest.clone().addScaledVector(rightV, 0.42 * H).addScaledVector(fwd, 0.12 * H);
      a.y += 0.22 * H;
      const c = frame.chest.clone().addScaledVector(rightV, -0.22 * H).addScaledVector(fwd, 0.42 * H);
      c.y -= 0.28 * H;
      const mid = frame.chest.clone().addScaledVector(rightV, 0.12 * H).addScaledVector(fwd, 0.62 * H);
      const p = a.multiplyScalar((1 - t) * (1 - t)).addScaledVector(mid, 2 * t * (1 - t)).addScaledVector(c, t * t);
      grip.lerp(p, pw);
      gunDir.lerp(fwd.clone().addScaledVector(rightV, lerp(0.6, -0.8, t)).addScaledVector(UP, lerp(0.4, -0.3, t)).normalize(), pw).normalize();
      ikR = Math.max(ikR, pw);
      ikL *= 1 - pw;
    }
    if (!(pw > 0.01 && this.pose === "reload")) {
      if (this.rifle) leftTarget.copy(grip).addScaledVector(gunDir, 0.27).addScaledVector(UP, -0.02);
      else leftTarget.copy(grip).addScaledVector(rightV, -0.045).addScaledVector(UP, -0.05).addScaledVector(gunDir, 0.005);
    }

    // --- Arms.
    const wrist = grip.clone().addScaledVector(gunDir, -0.05).addScaledVector(UP, -0.035);
    if (ikR > 0.01) {
      solveArm(B.armR, B.foreR, B.handR, wrist, va.set(0, -1, 0).addScaledVector(rightV, 0.55).addScaledVector(fwd, -0.2).clone(), ikR);
      pointBone(B.handR, B.tipR, gunDir, ikR);
    }
    if (ikL > 0.01) {
      solveArm(B.armL, B.foreL, B.handL, leftTarget, va.set(0, -1, 0).addScaledVector(rightV, -0.6).addScaledVector(fwd, -0.1).clone(), ikL);
      pointBone(B.handL, B.tipL, vb.copy(gunDir).addScaledVector(rightV, 0.7).normalize().clone(), ikL);
    }

    // --- Place the weapon. Lowered: it rides in the hand. Raised: it sits on
    // the aim line and the hands come to it.
    const handPos = B.handR.getWorldPosition(new THREE.Vector3());
    const fingers = B.tipR.getWorldPosition(new THREE.Vector3()).sub(handPos).normalize();
    const heldGrip = handPos.clone().addScaledVector(fingers, 0.06);
    const finalGrip = heldGrip.lerp(grip, ikR);
    const finalDir = fingers.lerp(gunDir, ikR).normalize();
    this.gunDir.copy(finalDir);
    const item = s.knife && this.knife ? this.knife : this.weapon;
    if (this.knife) {
      this.knife.visible = !!s.knife && !dead;
      this.weapon.visible = !s.knife;
    }
    m1.lookAt(finalDir, va.set(0, 0, 0), UP);
    const worldQ = q1.setFromRotationMatrix(m1);
    this.group.getWorldQuaternion(q2).invert();
    item.quaternion.copy(q2.multiply(worldQ));
    item.position.copy(this.group.worldToLocal(finalGrip.clone()));
    item.updateMatrixWorld(true);
    const mz = this.weapon.userData.muzzle;
    this.muzzle.copy(mz).applyMatrix4(this.weapon.matrixWorld);
    if (this.weapon.userData.eject) this.eject.copy(this.weapon.userData.eject).applyMatrix4(this.weapon.matrixWorld);

    // --- Coat tails hang from the hips, trail with speed and settle at rest.
    if (this.coat) {
      const hips = B.hips.getWorldPosition(va);
      this.coat.position.copy(this.group.worldToLocal(hips));
      this.coat.position.y += 0.02;
      this.coat.rotation.x = tiltX;
      const back = s.backward ? -0.4 : 1;
      const want = dead ? 0 : clamp(sp * 0.06, 0, 0.42) * back;
      this.swingV += (want - this.swingV) * (1 - Math.exp(-dt * 6));
      for (const tail of this.coat.userData.tails) {
        const flutter = Math.sin(this.phase * Math.PI * 4 + tail.phase) * 0.06 * moveAmt + Math.sin(this.idleT * 1.7 + tail.phase) * 0.015;
        tail.joints[0].rotation.x = 0.06 + this.swingV * 0.75 + flutter;
        tail.joints[1].rotation.x = this.swingV * 0.55 + flutter * 0.8;
        tail.joints[2].rotation.x = this.swingV * 0.45 - flutter * 0.6;
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.group.traverse((o) => {
      if (o.isMesh && o.material && o !== this.shadow) o.material.dispose();
    });
    this.group.removeFromParent();
  }
}
