import * as THREE from "three";

export function createWorld(scene, quality) {
  const colliders = [];
  const lights = [];

  scene.background = new THREE.Color(0x9aa7b5);
  scene.fog = new THREE.Fog(0x9aa7b5, 28, 78);

  const groundTex = makeNoise();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshStandardMaterial({
      color: 0x1a242e,
      roughness: 0.42,
      metalness: 0.38,
      roughnessMap: groundTex,
      map: groundTex
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x8d8680, 1.6);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xffffff, 1.35);
  moon.position.set(-12, 28, 10);
  if (quality !== "low") {
    moon.castShadow = true;
    moon.shadow.mapSize.set(quality === "high" ? 1024 : 512, quality === "high" ? 1024 : 512);
    moon.shadow.camera.near = 2;
    moon.shadow.camera.far = 80;
    moon.shadow.camera.left = -30;
    moon.shadow.camera.right = 30;
    moon.shadow.camera.top = 30;
    moon.shadow.camera.bottom = -30;
  }
  scene.add(moon);

  const blocks = [
    [-32, -9, -34, -8, 14, 0x171c24],
    [9, 32, -34, -8, 16, 0x141920],
    [-32, -9, 8, 34, 12, 0x1a2028],
    [9, 32, 8, 34, 13, 0x151b22],
    [14, 24, -28, -18, 9, 0x191f27]
  ];
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x222833, roughness: 0.86, metalness: 0.08 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a1016, roughness: 0.7, emissive: 0x3a1016, emissiveIntensity: 0.25 });
  blocks.forEach(([x0, x1, z0, z1, h, color]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), wallMat.clone());
    mesh.material.color.setHex(color);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    mesh.castShadow = quality !== "low";
    mesh.receiveShadow = true;
    scene.add(mesh);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.1, 0.35, 0.25), trimMat);
    trim.position.set(mesh.position.x, 2.2, z1 + 0.05);
    scene.add(trim);
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY: h });
  });

  addWindows(scene, blocks, quality);
  addProps(scene, colliders, quality);
  const tower = addTower(scene, colliders, lights, quality);
  addAccentLights(scene, lights, quality);
  addStreetDressing(scene, colliders, quality);

  return { colliders, lights, tower, ground };
}

function addWindows(scene, blocks, quality) {
  const geo = new THREE.PlaneGeometry(0.7, 1.1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x89c7ff,
    emissive: 0x1d4d66,
    emissiveIntensity: 0.8,
    roughness: 0.4
  });
  const count = quality === "low" ? 40 : 80;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  let n = 0;
  blocks.forEach(([x0, x1, z0, z1, h]) => {
    const faceZ = z1;
    for (let x = x0 + 2; x < x1 - 1 && n < count; x += 3) {
      dummy.position.set(x, 3 + (n % 3), faceZ + 0.08);
      dummy.lookAt(x, 3, faceZ + 2);
      dummy.updateMatrix();
      mesh.setMatrixAt(n++, dummy.matrix);
    }
  });
  mesh.count = n;
  scene.add(mesh);
}

function addProps(scene, colliders, quality) {
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.8 });
  const crates = [[-6, 12, 1.1], [5.5, -14, 0.8], [-4, -8, 1.3], [18, 2, 1], [-16, 2, 0.9]];
  crates.forEach(([x, z, s]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    m.position.set(x, s / 2, z);
    m.castShadow = quality !== "low";
    scene.add(m);
    colliders.push({ minX: x - s / 2, maxX: x + s / 2, minZ: z - s / 2, maxZ: z + s / 2, minY: 0, maxY: s });
  });
  const barrier = new THREE.MeshStandardMaterial({ color: 0x3a1218, emissive: 0x5a1018, emissiveIntensity: 0.2 });
  [[-3, 20], [3, 20], [-3, -16], [3, -16]].forEach(([x, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.4), barrier);
    m.position.set(x, 0.5, z);
    scene.add(m);
    colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.25, maxZ: z + 0.25, minY: 0, maxY: 1 });
  });
  const bannerMat = new THREE.MeshStandardMaterial({ color: 0x8d1c28, roughness: 0.6, side: THREE.DoubleSide });
  [[-8.6, 6, 0], [8.6, -10, Math.PI]].forEach(([x, z, rot]) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4), bannerMat);
    b.position.set(x, 4, z);
    b.rotation.y = rot;
    scene.add(b);
  });
}

function addTower(scene, colliders, lights, quality) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x242b34, metalness: 0.4, roughness: 0.45 })
  );
  base.position.y = 4;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.5, 14, 6),
    new THREE.MeshStandardMaterial({ color: 0x303844, metalness: 0.5, roughness: 0.4 })
  );
  mast.position.y = 14;
  const dish = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.7),
    new THREE.MeshStandardMaterial({ color: 0x39e0ff, emissive: 0x147a88, emissiveIntensity: 1.4 })
  );
  dish.position.y = 21;
  g.add(base, mast, dish);
  g.position.set(0, 0, -38);
  scene.add(g);
  colliders.push({ minX: -3, maxX: 3, minZ: -41, maxZ: -35, minY: 0, maxY: 8 });
  if (quality !== "low") {
    const pl = new THREE.PointLight(0x39e0ff, 2.2, 16, 2);
    pl.position.set(0, 8, -38);
    scene.add(pl);
    lights.push(pl);
  }
  return g;
}

function addStreetDressing(scene, colliders, quality) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2a313a, roughness: 0.9 });
  const curb = new THREE.Mesh(new THREE.BoxGeometry(18, 0.16, 7.4), concrete);
  curb.position.set(0, 0.08, 22);
  curb.receiveShadow = true;
  scene.add(curb);
  const walkL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 62), concrete);
  walkL.position.set(-8.2, 0.06, -4);
  const walkR = walkL.clone();
  walkR.position.x = 8.2;
  scene.add(walkL, walkR);

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x242a32, metalness: 0.4, roughness: 0.45 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffb15a, emissiveIntensity: 1.4 });
  [[-7.2, 10], [7.2, -4], [-7.2, -18], [7.2, -30]].forEach(([x, z], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6), lampMat);
    pole.position.set(x, 2.2, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.28), glow);
    head.position.set(x + (x < 0 ? 0.3 : -0.3), 4.3, z);
    scene.add(pole, head);
    if (quality !== "low" && i % 2 === 0) {
      const pl = new THREE.PointLight(0xffb15a, 0.85, 9, 2);
      pl.position.set(x, 4.1, z);
      scene.add(pl);
    }
  });

  const barrier = new THREE.MeshStandardMaterial({ color: 0x6a1c24, roughness: 0.7 });
  [[-3.2, 16], [3.4, 12], [-2.4, -8]].forEach(([x, z]) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.7), barrier);
    box.position.set(x, 0.4, z);
    scene.add(box);
    colliders.push({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.35, maxZ: z + 0.35, minY: 0, maxY: 0.8 });
  });

  const banner = new THREE.MeshStandardMaterial({ color: 0x8d1d2a, roughness: 0.6, emissive: 0x3a0c12, emissiveIntensity: 0.25 });
  [[-8.6, 6], [8.6, -16]].forEach(([x, z]) => {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), banner);
    cloth.position.set(x, 3.4, z);
    cloth.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(cloth);
  });
}

function addAccentLights(scene, lights, quality) {
  const spots = quality === "low" ? [[0, 6, 0, 0xff3344]] : [[-10, 5, 8, 0xff3344], [12, 5, -6, 0xff3344], [0, 4, 18, 0x88d8ff]];
  spots.forEach(([x, y, z, color]) => {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 })
    );
    lamp.position.set(x, y, z);
    scene.add(lamp);
    const pl = new THREE.PointLight(color, quality === "high" ? 1.4 : 0.7, 10, 2);
    pl.position.set(x, y, z);
    scene.add(pl);
    lights.push(pl);
  });
}

export function makeCell(scene, position, id) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x7af6ff, emissive: 0x1ec8d6, emissiveIntensity: 1.6 })
  );
  core.position.y = 0.7;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.04, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xff4455, emissive: 0x661018, emissiveIntensity: 0.6 })
  );
  ring.position.y = 0.7;
  ring.rotation.x = Math.PI / 2;
  g.add(core, ring);
  g.position.copy(position);
  scene.add(g);
  return { id, type: "cell", mesh: g, pos: position.clone(), taken: false };
}

export function makePickup(scene, position, type) {
  const color = type === "health" ? 0x37e08a : 0xf0c14a;
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 })
  );
  mesh.position.copy(position);
  mesh.position.y = 0.6;
  scene.add(mesh);
  return { type, mesh, pos: mesh.position.clone(), taken: false };
}

export function resolve(pos, radius, colliders) {
  for (let n = 0; n < 2; n++) {
    for (const c of colliders) {
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - nx;
      let dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 < 1e-8) {
          const left = pos.x - c.minX;
          const right = c.maxX - pos.x;
          const back = pos.z - c.minZ;
          const fwd = c.maxZ - pos.z;
          const m = Math.min(left, right, back, fwd);
          if (m === left) pos.x = c.minX - radius;
          else if (m === right) pos.x = c.maxX + radius;
          else if (m === back) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        } else {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        }
      }
    }
  }
  pos.x = Math.max(-9.3, Math.min(9.3, pos.x));
  pos.z = Math.max(-35.2, Math.min(37.2, pos.z));
}

export function blocked(pos, dir, dist, radius, colliders) {
  const end = { x: pos.x + dir.x * dist, z: pos.z + dir.z * dist };
  return !segmentClear(pos, end, colliders, radius * 0.6);
}

export function segmentClear(a, b, colliders, pad = 0.2) {
  for (const c of colliders) {
    if (segmentHitsAabb(a.x, a.z, b.x, b.z, c.minX - pad, c.maxX + pad, c.minZ - pad, c.maxZ + pad)) return false;
  }
  return true;
}

function segmentHitsAabb(x0, z0, x1, z1, minX, maxX, minZ, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const checks = [
    [-dx, x0 - minX],
    [dx, maxX - x0],
    [-dz, z0 - minZ],
    [dz, maxZ - z0]
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export function rayHit(origin, dir, maxDist, colliders) {
  let best = maxDist;
  let hit = null;
  for (const c of colliders) {
    const r = rayAabb(origin, dir, c, maxDist);
    if (r !== null && r.t < best) {
      best = r.t;
      hit = r;
      hit.collider = c;
    }
  }
  if (hit) {
    hit.point = origin.clone().addScaledVector(dir, hit.t);
    hit.normal = new THREE.Vector3();
    if (hit.axis >= 0) hit.normal.setComponent(hit.axis, hit.sign);
    else hit.normal.copy(dir).negate();
  }
  return hit;
}

// Slab test. Returns the entry distance plus which face was entered, so
// impacts and bullet holes can sit flat on the surface that was hit.
function rayAabb(origin, dir, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 0;
  const mins = [box.minX, box.minY ?? 0, box.minZ];
  const maxs = [box.maxX, box.maxY ?? 8, box.maxZ];
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return null;
    } else {
      let t1 = (mins[i] - o[i]) / d[i];
      let t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = d[i] > 0 ? -1 : 1; }
      tmax = Math.min(tmax, t2);
      if (tmax < tmin) return null;
    }
  }
  return { t: tmin, axis, sign };
}

function makeNoise() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 40 + Math.random() * 50;
    img.data[i] = n;
    img.data[i + 1] = n + 6;
    img.data[i + 2] = n + 12;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}
