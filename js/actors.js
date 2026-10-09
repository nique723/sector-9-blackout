import * as THREE from "three";

const SKIN = 0x5a3b2a;
const COAT = 0x121418;
const LINING = 0x6d1420;
const ARMOR = 0x2a3038;
const METAL = 0x3c434c;

export function createGhost() {
  const group = new THREE.Group();
  const parts = {};
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.18, ...extra });

  const hips = new THREE.Group();
  hips.position.y = 0.95;
  group.add(hips);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.24), mat(ARMOR));
  hips.add(pelvis);

  const torso = new THREE.Group();
  torso.position.y = 0.28;
  hips.add(torso);
  torso.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.28), mat(ARMOR, { metalness: 0.35 })));
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.08), mat(0x1a1e24));
  chest.position.set(0, 0.08, 0.16);
  torso.add(chest);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.04), mat(0xff3344, { emissive: 0x661018, emissiveIntensity: 0.7 }));
  accent.position.set(0.12, 0.02, 0.18);
  torso.add(accent);

  const coat = new THREE.Group();
  const coatL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.15, 0.06), mat(COAT, { roughness: 0.8 }));
  coatL.position.set(-0.22, -0.25, -0.12);
  const coatR = coatL.clone();
  coatR.position.x = 0.22;
  const coatB = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.2, 0.05), mat(COAT, { roughness: 0.8 }));
  coatB.position.set(0, -0.28, -0.16);
  const lining = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 0.02), mat(LINING, { emissive: 0x3a0a10, emissiveIntensity: 0.35 }));
  lining.position.set(0, -0.22, -0.12);
  coat.add(coatL, coatR, coatB, lining);
  torso.add(coat);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 8), mat(SKIN));
  neck.position.y = 0.34;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.48;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(SKIN, { roughness: 0.55, metalness: 0.02 }));
  skull.scale.set(1, 1.08, 0.95);
  head.add(skull);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 8), mat(0x16120f, { roughness: 0.9 }));
  hair.position.y = 0.05;
  hair.scale.set(1.02, 0.7, 1.02);
  head.add(hair);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), mat(0x120e0c));
  brow.position.set(0, 0.04, 0.14);
  head.add(brow);
  torso.add(head);

  const armL = limb(mat, -1);
  const armR = limb(mat, 1);
  torso.add(armL.pivot, armR.pivot);

  const legL = leg(mat, -1);
  const legR = leg(mat, 1);
  hips.add(legL.pivot, legR.pivot);

  const pistol = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), mat(0xd5dbe3, { metalness: 0.7, roughness: 0.3 }));
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), mat(0x1a1c20));
  grip.position.set(0, -0.07, 0.04);
  pistol.add(slide, grip);
  pistol.position.set(0, -0.28, 0.12);
  armR.lower.add(pistol);

  const knife = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.04), mat(0xcfd6de, { metalness: 0.8, roughness: 0.25 }));
  knife.position.set(0.16, -0.15, 0.12);
  knife.rotation.z = 0.4;
  hips.add(knife);

  parts.hips = hips;
  parts.torso = torso;
  parts.head = head;
  parts.coat = coat;
  parts.armL = armL;
  parts.armR = armR;
  parts.legL = legL;
  parts.legR = legR;
  parts.pistol = pistol;
  parts.skull = skull;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group, parts };
}

function limb(mat, side) {
  const pivot = new THREE.Group();
  pivot.position.set(0.28 * side, 0.18, 0);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), mat(ARMOR));
  upper.position.y = -0.16;
  pivot.add(upper);
  const lower = new THREE.Group();
  lower.position.y = -0.32;
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 8), mat(0x1c2128));
  forearm.position.y = -0.14;
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat(0x15181d));
  glove.position.y = -0.3;
  lower.add(forearm, glove);
  pivot.add(lower);
  return { pivot, lower };
}

function leg(mat, side) {
  const pivot = new THREE.Group();
  pivot.position.set(0.12 * side, -0.12, 0);
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.28, 4, 8), mat(0x1a1e24));
  thigh.position.y = -0.22;
  pivot.add(thigh);
  const lower = new THREE.Group();
  lower.position.y = -0.42;
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 4, 8), mat(0x15191e));
  shin.position.y = -0.18;
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.26), mat(0x0e1014, { roughness: 0.4, metalness: 0.3 }));
  boot.position.set(0, -0.36, 0.04);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), mat(METAL, { emissive: 0x33080c, emissiveIntensity: 0.3 }));
  pad.position.set(0, 0.02, 0.08);
  lower.add(shin, boot, pad);
  pivot.add(lower);
  return { pivot, lower };
}

export function applyFace(parts) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, img.width * 0.4, img.height * 0.02, img.width * 0.2, img.height * 0.14, 0, 0, 128, 128);
    const data = ctx.getImageData(0, 0, 128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      if (g > 120 && g > r * 1.35 && g > b * 1.35) data.data[i + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    parts.skull.material = parts.skull.material.clone();
    parts.skull.material.map = tex;
    parts.skull.material.needsUpdate = true;
  };
  img.src = "assets/ghost-ref.png";
}

export function animateGhost(parts, state, t, moving) {
  const swing = moving ? Math.sin(t * (state === "sprint" ? 12 : 8)) : 0;
  parts.legL.pivot.rotation.x = swing * 0.7;
  parts.legR.pivot.rotation.x = -swing * 0.7;
  parts.legL.lower.rotation.x = Math.max(0, -swing) * 0.6;
  parts.legR.lower.rotation.x = Math.max(0, swing) * 0.6;
  parts.armL.pivot.rotation.x = -swing * 0.45;
  parts.coat.rotation.z = Math.sin(t * 2) * 0.03 + (moving ? 0.04 : 0);
  parts.torso.rotation.x = moving ? 0.06 : 0;
  if (state === "aim" || state === "shoot") {
    parts.armR.pivot.rotation.x = -1.35;
    parts.armR.lower.rotation.x = -0.2;
    parts.armL.pivot.rotation.x = -0.9;
  } else if (state === "reload") {
    parts.armR.pivot.rotation.x = -0.8;
    parts.armR.lower.rotation.x = -1.1;
  } else if (state === "melee") {
    parts.armR.pivot.rotation.x = -0.4 + Math.sin(t * 22) * 0.8;
    parts.torso.rotation.y = Math.sin(t * 18) * 0.3;
  } else if (state === "dodge") {
    parts.torso.rotation.z = 0.35;
    parts.hips.position.y = 0.75;
  } else if (state === "dead") {
    parts.hips.rotation.x = 1.2;
    parts.hips.position.y = 0.4;
  } else {
    parts.armR.pivot.rotation.x = swing * 0.4;
    parts.armR.lower.rotation.x = 0.15;
    parts.torso.rotation.y = 0;
    parts.torso.rotation.z = 0;
    parts.hips.position.y = 0.95;
    parts.hips.rotation.x = 0;
  }
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
