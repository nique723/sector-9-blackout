import * as THREE from "three";

const SKIN = 0x6a4630;
const HAIR = 0x14110f;
const COAT = 0x1a1d22;
const LINING = 0x8a1c28;
const ARMOR = 0x2c323a;
const BOOT = 0x121418;

export function createGhost() {
  const group = new THREE.Group();
  const parts = {};
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.16, ...extra });

  const hips = new THREE.Group();
  hips.position.y = 0.98;
  group.add(hips);
  hips.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.22), mat(ARMOR)));

  const torso = new THREE.Group();
  torso.position.y = 0.24;
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 4, 8), mat(ARMOR, { metalness: 0.28 }));
  chest.position.y = 0.22;
  torso.add(chest);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.04), mat(0x23282f));
  plate.position.set(0, 0.24, 0.15);
  torso.add(plate);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.02), mat(0xc43a44, { emissive: 0x5a1218, emissiveIntensity: 0.45 }));
  stripe.position.set(0.1, 0.22, 0.16);
  torso.add(stripe);

  const coat = new THREE.Group();
  const tailGeo = new THREE.BoxGeometry(0.22, 1.05, 0.045);
  const tailMat = mat(COAT, { roughness: 0.78 });
  const lineMat = mat(LINING, { emissive: 0x4a1016, emissiveIntensity: 0.28, roughness: 0.55 });
  const tailL = new THREE.Group();
  tailL.position.set(-0.16, -0.42, -0.08);
  const tailLOuter = new THREE.Mesh(tailGeo, tailMat);
  const tailLInner = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.92, 0.012), lineMat);
  tailLInner.position.z = 0.02;
  tailL.add(tailLOuter, tailLInner);
  const tailR = tailL.clone();
  tailR.position.x = 0.16;
  coat.add(tailL, tailR);
  torso.add(coat);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 8), mat(SKIN, { roughness: 0.7, metalness: 0 }));
  neck.position.y = 0.46;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.56;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), mat(SKIN, { roughness: 0.62, metalness: 0 }));
  skull.scale.set(0.96, 1.08, 0.92);
  head.add(skull);
  const hair = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat(HAIR, { roughness: 0.9 }));
    const a = (i / 7) * Math.PI * 1.4 - 0.4;
    tuft.position.set(Math.sin(a) * 0.07, 0.08 + (i % 3) * 0.015, Math.cos(a) * 0.04);
    hair.add(tuft);
  }
  head.add(hair);
  torso.add(head);

  const armL = limb(mat, -1);
  const armR = limb(mat, 1);
  torso.add(armL.pivot, armR.pivot);

  const legL = leg(mat, -1);
  const legR = leg(mat, 1);
  hips.add(legL.pivot, legR.pivot);

  const pistol = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.2), mat(0xd7dde6, { metalness: 0.72, roughness: 0.28 }));
  slide.position.z = 0.04;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.045), mat(0x1a1c20));
  grip.position.set(0, -0.06, -0.02);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), mat(0xb7c0ca, { metalness: 0.8, roughness: 0.25 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.16;
  const muzzleMark = new THREE.Object3D();
  muzzleMark.position.z = 0.2;
  pistol.add(slide, grip, barrel, muzzleMark);
  armR.hand.add(pistol);

  const knife = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.03), mat(0xcfd6de, { metalness: 0.8, roughness: 0.25 }));
  knife.position.set(-0.14, -0.08, 0.08);
  knife.rotation.z = 0.5;
  hips.add(knife);

  parts.hips = hips;
  parts.torso = torso;
  parts.head = head;
  parts.coat = coat;
  parts.tailL = tailL;
  parts.tailR = tailR;
  parts.armL = armL;
  parts.armR = armR;
  parts.legL = legL;
  parts.legR = legR;
  parts.pistol = pistol;
  parts.muzzle = muzzleMark;
  parts.skull = skull;
  parts.asset = "procedural-ghost-v2";
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, parts };
}

function limb(mat, side) {
  const pivot = new THREE.Group();
  pivot.position.set(0.24 * side, 0.32, 0);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), mat(ARMOR));
  upper.position.y = -0.14;
  pivot.add(upper);
  const lower = new THREE.Group();
  lower.position.y = -0.28;
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), mat(0x242a31));
  forearm.position.y = -0.12;
  const hand = new THREE.Group();
  hand.position.y = -0.24;
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), mat(0x16191e));
  hand.add(glove);
  lower.add(forearm, hand);
  pivot.add(lower);
  return { pivot, lower, hand };
}

function leg(mat, side) {
  const pivot = new THREE.Group();
  pivot.position.set(0.11 * side, -0.08, 0);
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 4, 8), mat(0x1c2128));
  thigh.position.y = -0.2;
  pivot.add(thigh);
  const lower = new THREE.Group();
  lower.position.y = -0.38;
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 4, 8), mat(0x171b20));
  shin.position.y = -0.16;
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.22), mat(BOOT, { roughness: 0.45, metalness: 0.22 }));
  boot.position.set(0, -0.32, 0.04);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), mat(0x3a414a, { emissive: 0x3a1014, emissiveIntensity: 0.2 }));
  pad.position.set(0, 0.02, 0.06);
  lower.add(shin, boot, pad);
  pivot.add(lower);
  return { pivot, lower };
}

export function applyFace() {
  // The reference PNG is not a texture source. Identity is carried by the mesh colors and hair.
}

export function animateGhost(parts, state, t, moving) {
  const swing = moving ? Math.sin(t * (state === "sprint" ? 12 : 8)) : 0;
  parts.legL.pivot.rotation.x = swing * 0.65;
  parts.legR.pivot.rotation.x = -swing * 0.65;
  parts.legL.lower.rotation.x = Math.max(0, -swing) * 0.55;
  parts.legR.lower.rotation.x = Math.max(0, swing) * 0.55;
  parts.tailL.rotation.x = 0.08 + Math.sin(t * 2.2) * 0.04;
  parts.tailR.rotation.x = 0.08 + Math.sin(t * 2.2 + 0.6) * 0.04;
  parts.tailL.rotation.z = 0.08;
  parts.tailR.rotation.z = -0.08;
  parts.torso.rotation.x = moving ? 0.05 : 0;
  parts.torso.rotation.y = 0;
  parts.torso.rotation.z = 0;
  const aiming = state === "aim" || state === "shoot";
  if (aiming) {
    parts.armR.pivot.rotation.set(-1.15, -0.35, 0.15);
    parts.armR.lower.rotation.set(-0.35, 0, 0);
    parts.armL.pivot.rotation.set(-1.05, 0.45, -0.2);
    parts.armL.lower.rotation.set(-0.4, 0, 0);
  } else if (state === "reload") {
    parts.armR.pivot.rotation.set(-0.7, 0, 0);
    parts.armR.lower.rotation.set(-1.05, 0, 0);
    parts.armL.pivot.rotation.set(-0.8, 0.2, 0);
  } else if (state === "melee") {
    parts.armR.pivot.rotation.x = -0.3 + Math.sin(t * 22) * 0.7;
    parts.torso.rotation.y = Math.sin(t * 18) * 0.25;
    parts.armL.pivot.rotation.x = swing * 0.2;
  } else if (state === "dodge") {
    parts.torso.rotation.z = 0.3;
    parts.hips.position.y = 0.78;
    parts.armL.pivot.rotation.x = 0.2;
    parts.armR.pivot.rotation.x = 0.2;
  } else if (state === "dead") {
    parts.hips.rotation.x = 1.15;
    parts.hips.position.y = 0.35;
  } else {
    parts.armR.pivot.rotation.set(swing * 0.35, 0, 0);
    parts.armR.lower.rotation.set(0.12, 0, 0);
    parts.armL.pivot.rotation.set(-swing * 0.35, 0, 0);
    parts.armL.lower.rotation.set(0.1, 0, 0);
    parts.hips.position.y = 0.98;
    parts.hips.rotation.x = 0;
  }
}

export function alignWeapon(parts, aimPoint, recoil) {
  if (!parts.muzzle || !aimPoint) return;
  parts.pistol.rotation.set(0, 0, 0);
  parts.pistol.position.set(0, 0, 0);
  parts.muzzle.updateWorldMatrix(true, false);
  const origin = new THREE.Vector3();
  parts.muzzle.getWorldPosition(origin);
  const dir = aimPoint.clone().sub(origin);
  if (dir.lengthSq() < 0.01) return;
  dir.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Matrix4().lookAt(origin, origin.clone().add(dir), up);
  const parent = parts.pistol.parent;
  parent.updateWorldMatrix(true, false);
  const parentInv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const local = new THREE.Matrix4().multiplyMatrices(parentInv, look);
  parts.pistol.quaternion.setFromRotationMatrix(local);
  parts.pistol.position.z = -recoil;
}

export function createEnemy(type) {
  const spec = {
    patrol: { color: 0x2c333c, eye: 0xff3344, scale: 1, hp: 46, speed: 2.5, dmg: 8, range: 8.5, cd: 1.15, melee: 1.7 },
    hunter: { color: 0x243038, eye: 0x39e0ff, scale: 0.86, hp: 28, speed: 4.1, dmg: 7, range: 7.2, cd: 0.75, melee: 1.5 },
    enforcer: { color: 0x3a4048, eye: 0xff5533, scale: 1.25, hp: 96, speed: 1.7, dmg: 16, range: 9.5, cd: 1.55, melee: 2.05 }
  }[type];
  const g = new THREE.Group();
  g.scale.setScalar(spec.scale);
  const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.45, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), mat);
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.32), mat);
  head.position.y = 1.78;
  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.06, 0.04),
    new THREE.MeshStandardMaterial({ color: spec.eye, emissive: spec.eye, emissiveIntensity: 2 })
  );
  eye.position.set(0, 1.8, 0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), mat);
  gun.position.set(0.32, 1.2, 0.3);
  g.add(body, head, eye, gun);
  if (type === "enforcer") {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.12), mat);
    plate.position.set(0, 1.2, 0.24);
    g.add(plate);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return {
    type,
    group: g,
    hp: spec.hp,
    maxHp: spec.hp,
    speed: spec.speed,
    dmg: spec.dmg,
    range: spec.range,
    cd: spec.cd,
    melee: spec.melee,
    attackT: 0.6 + Math.random(),
    hitT: 0,
    dead: false,
    pos: new THREE.Vector3()
  };
}

export function animateEnemy(enemy, t, moving) {
  const bob = moving ? Math.sin(t * 8) * 0.06 : 0;
  enemy.group.position.y = bob;
  if (enemy.hitT > 0) enemy.group.rotation.z = Math.sin(t * 40) * 0.08;
  else enemy.group.rotation.z = 0;
  if (enemy.dead) enemy.group.rotation.x = 1.15;
}
