import * as THREE from "three";
import { Sfx } from "./audio.js";
import { Input } from "./input.js";
import { makeCell, makePickup, resolve, blocked, segmentClear, rayHit } from "./world.js";
import { loadSector9Street } from "./load-street.js";
import { createGhost, applyFace, animateGhost, alignWeapon, createEnemy, animateEnemy } from "./actors.js";

const $ = (id) => document.getElementById(id);
const MAG = 12;
const START_RESERVE = 60;
const FIRE_CD = 0.2;
const RELOAD_T = 1.45;
const MELEE_CD = 0.55;
const DODGE_T = 0.36;
const DODGE_CD = 1.15;

const settings = loadSettings();
const input = new Input();
const sfx = new Sfx();
let renderer, scene, camera, clock;
let world, ghost, player, enemies, pickups, flashes, impacts;
let mode = "load";
let quality = settings.quality;
let fpsOn = settings.fps;
let fpsAcc = 0;
let fpsFrames = 0;
let bannerT = 0;
let camYaw = 0;
let camPitch = 0.22;
let shake = 0;
let mission;
let interact = null;
let hitCount = 0;
let shotTarget = null;
let recoil = 0;
let tracer = null;
let resumeGraceUntil = 0;
let forcePlay = false;
const aimDir = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const tmp = new THREE.Vector3();
const muzzle = new THREE.Vector3();
let aimRay = null;
let aimNdc = null;

const CELL_SPOTS = [
  { id: "c1", pos: new THREE.Vector3(-7, 0, 14) },
  { id: "c2", pos: new THREE.Vector3(7, 0, 0) },
  { id: "c3", pos: new THREE.Vector3(0, 0, -27) }
];

function loadSettings() {
  try {
    return Object.assign({ sensitivity: 1, quality: "medium", volume: 0.7, fps: false }, JSON.parse(localStorage.getItem("s9-settings") || "{}"));
  } catch {
    return { sensitivity: 1, quality: "medium", volume: 0.7, fps: false };
  }
}

function saveSettings() {
  localStorage.setItem("s9-settings", JSON.stringify({
    sensitivity: input.sensitivity,
    quality,
    volume: sfx.volume,
    fps: fpsOn
  }));
}

async function boot() {
  try {
    $("load-status").textContent = "Loading Sector 9 street…";
    renderer = new THREE.WebGLRenderer({ canvas: $("view"), antialias: quality !== "low", powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(58, 1, 0.1, 160);
    aimRay = new THREE.Raycaster();
    aimNdc = new THREE.Vector2();
    clock = new THREE.Clock();
    applyQuality();
    world = await loadSector9Street(scene, "assets/sector9-street/");
    ghost = createGhost();
    applyFace(ghost.parts);
    scene.add(ghost.group);
    flashes = [];
    impacts = makeImpacts();
    resetMission();
    input.bind();
    input.sensitivity = settings.sensitivity;
    sfx.volume = settings.volume;
    bindUi();
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    $("load-status").textContent = "District ready.";
    $("screen-load").hidden = true;
    $("screen-start").hidden = false;
    mode = "start";
    window.S9 = { get state() { return snapshot(); } };
    window.S9.fire = () => tryFire();
    window.S9.placeTarget = () => {
      const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      const spot = player.pos.clone().addScaledVector(forward, 8);
      spot.y = 1.25;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 2.0, 0.25),
        new THREE.MeshStandardMaterial({ color: 0xd24a3a, emissive: 0x5a140e, emissiveIntensity: 0.4 })
      );
      box.position.copy(spot);
      scene.add(box);
      shotTarget = {
        mesh: box,
        minX: spot.x - 0.75,
        maxX: spot.x + 0.75,
        minY: 0.2,
        maxY: 2.3,
        minZ: spot.z - 0.75,
        maxZ: spot.z + 0.75
      };
      camera.lookAt(spot);
      return { x: spot.x, y: spot.y, z: spot.z };
    };
    window.S9.startRec = () => {
      const stream = $("view").captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      window.S9._chunks = [];
      window.S9._recDone = null;
      rec.ondataavailable = (e) => { if (e.data.size) window.S9._chunks.push(e.data); };
      rec.onstop = () => { window.S9._recDone = true; };
      rec.start(100);
      window.S9._rec = rec;
    };
    window.S9.stopRec = () => new Promise((resolve) => {
      const rec = window.S9._rec;
      if (!rec) return resolve("");
      rec.onstop = async () => {
        const blob = new Blob(window.S9._chunks, { type: "video/webm" });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let raw = "";
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) raw += String.fromCharCode(...bytes.subarray(i, i + step));
        window.S9._lastB64 = btoa(raw);
        resolve(window.S9._lastB64.length);
      };
      rec.stop();
    });
    window.S9.frameClose = () => {
      player.state = "aim";
      const head = player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
      camera.position.set(player.pos.x + 1.35, 1.85, player.pos.z + 2.6);
      camera.lookAt(head.x + 0.15, 1.35, player.pos.z - 8);
    };
    if (location.hash === "#test") {
      window.S9.debug = {
        teleport: (x, z) => { player.pos.set(x, 0, z); },
        killAll: () => enemies.forEach((e) => { e.hp = 0; e.dead = true; }),
        hurt: (n) => { player.hp = Math.max(0, player.hp - n); player.hurtT = 0.2; },
        emptyMag: () => { player.mag = 0; }
      };
    }
    requestAnimationFrame(loop);
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent = "Asset/init error: " + err.message;
    $("build-stamp").textContent = "BUILD 8 ERROR";
    console.error(err);
  }
}

function applyQuality() {
  const cap = quality === "low" ? 1 : quality === "medium" ? 1.25 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  renderer.shadowMap.enabled = quality !== "low";
  renderer.shadowMap.type = THREE.BasicShadowMap;
}

function resetMission() {
  enemies = [];
  pickups = [];
  for (const child of [...scene.children]) {
    if (child.userData && child.userData.ephemeral) scene.remove(child);
  }
  player = {
    pos: new THREE.Vector3(0, 0, 30),
    yaw: Math.PI,
    hp: 100,
    mag: MAG,
    reserve: START_RESERVE,
    weapon: "pistol",
    state: "idle",
    fireCd: 0,
    reloadT: 0,
    reloadPending: false,
    meleeCd: 0,
    dodgeCd: 0,
    dodgeT: 0,
    iframes: 0,
    hurtT: 0,
    deadT: 0
  };
  camYaw = player.yaw;
  camPitch = 0.22;
  ghost.group.position.copy(player.pos);
  mission = {
    phase: "cell1",
    cells: 0,
    got: {},
    patrolSpawned: false,
    patrolDone: false,
    wave: 0,
    wavesDone: 0,
    queue: [],
    waveLive: false,
    xp: 0,
    objective: "COLLECT THE FIRST POWER CELL"
  };
  CELL_SPOTS.forEach((c) => {
    const item = makeCell(scene, c.pos, c.id);
    item.mesh.userData.ephemeral = true;
    pickups.push(item);
  });
  pickups.push(tag(makePickup(scene, new THREE.Vector3(6, 0, 22), "ammo")));
  pickups.push(tag(makePickup(scene, new THREE.Vector3(-6, 0, -12), "health")));
  input.clearHeld();
  setBanner("ENTER SECTOR 9");
  syncHud();
}

function tag(p) {
  p.mesh.userData.ephemeral = true;
  return p;
}

function bindUi() {
  $("btn-start").onclick = () => {
    sfx.unlock();
    $("screen-start").hidden = true;
    $("hud").hidden = false;
    if (isPortrait()) {
      mode = "pause";
      pauseReason = "portrait";
      input.blocked = true;
      const gate = $("portrait");
      if (gate) gate.hidden = false;
      return;
    }
    beginPlay();
  };
  $("btn-resume").onclick = resume;
  const enter = $("btn-unpause-vis");
  if (enter) enter.onclick = resume;
  const force = $("btn-force-play");
  if (force) force.onclick = resume;
  $("btn-restart").onclick = restart;
  $("btn-again").onclick = restart;
  $("sens").value = settings.sensitivity;
  $("sens").oninput = () => { input.sensitivity = Number($("sens").value); saveSettings(); };
  $("quality").value = quality;
  $("quality").onchange = () => {
    quality = $("quality").value;
    saveSettings();
    setBanner("GRAPHICS APPLY ON RESTART");
  };
  $("volume").value = settings.volume;
  $("volume").oninput = () => { sfx.volume = Number($("volume").value); saveSettings(); };
  $("show-fps").checked = fpsOn;
  $("show-fps").onchange = () => { fpsOn = $("show-fps").checked; $("fps").hidden = !fpsOn; saveSettings(); };
  $("view").addEventListener("click", () => {
    if (mode === "play" && !matchMedia("(pointer: coarse)").matches && document.pointerLockElement !== $("view")) {
      $("view").requestPointerLock?.();
    }
  });
}

function hide(id) {
  const el = $(id);
  if (el) el.hidden = true;
}

function beginPlay() {
  hide("screen-start");
  hide("screen-pause");
  hide("screen-load");
  hide("resume-lock");
  hide("portrait");
  $("hud").hidden = false;
  mode = "play";
  pauseReason = null;
  input.blocked = false;
  resumeGraceUntil = performance.now() + 700;
  if (clock) clock.getDelta();
  setBanner("MISSION LIVE");
}

function restart() {
  hide("screen-end");
  hide("screen-pause");
  hide("resume-lock");
  hide("portrait");
  resetMission();
  sfx.unlock();
  beginPlay();
}

function pause(reason) {
  if (mode !== "play") return;
  if (reason === "tab" && performance.now() < resumeGraceUntil) return;
  mode = "pause";
  pauseReason = reason;
  input.blocked = true;
  input.clearHeld();
  hide("screen-pause");
  hide("resume-lock");
  hide("portrait");
  if (reason === "portrait") {
    const gate = $("portrait");
    if (gate) gate.hidden = false;
  } else if (reason === "tab") {
    const lock = $("resume-lock");
    if (lock) lock.hidden = false;
  } else {
    $("screen-pause").hidden = false;
  }
  document.exitPointerLock?.();
}

function resume() {
  sfx.unlock();
  if (isPortrait()) {
    mode = "pause";
    pauseReason = "portrait";
    input.blocked = true;
    hide("resume-lock");
    const gate = $("portrait");
    if (gate) gate.hidden = false;
    return;
  }
  beginPlay();
}

function onVis() {
  if (document.hidden) pause("tab");
}

function isPortrait() {
  return window.innerHeight > window.innerWidth + 80;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (isPortrait() && mode === "play") pause("portrait");
  if (mode === "play") update(dt);
  else if (ghost) animateGhost(ghost.parts, player?.state || "idle", clock.elapsedTime, false);
  renderer.render(scene, camera);
  if (fpsOn) {
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.4) {
      $("fps").hidden = false;
      $("fps").textContent = "FPS " + Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }
}

function update(dt) {
  if (input.take("pause")) pause("user");
  const look = input.consumeLook();
  camYaw -= look.dx;
  camPitch = Math.max(-0.55, Math.min(0.85, camPitch - look.dy));
  player.yaw = camYaw;

  if (player.hp <= 0) {
    player.deadT += dt;
    player.state = "dead";
    animateGhost(ghost.parts, "dead", clock.elapsedTime, false);
    if (player.deadT > 1.1) end(false);
    return;
  }

  player.fireCd = Math.max(0, player.fireCd - dt);
  player.meleeCd = Math.max(0, player.meleeCd - dt);
  player.dodgeCd = Math.max(0, player.dodgeCd - dt);
  player.iframes = Math.max(0, player.iframes - dt);
  player.hurtT = Math.max(0, player.hurtT - dt);
  recoil = Math.max(0, recoil - dt * 1.8);
  if (player.reloadT > 0) {
    player.reloadT = Math.max(0, player.reloadT - dt);
    if (player.reloadT === 0 && player.reloadPending) {
      const need = MAG - player.mag;
      const take = Math.min(need, player.reserve);
      player.mag += take;
      player.reserve -= take;
      player.reloadPending = false;
    }
  }
  if (player.dodgeT > 0) player.dodgeT = Math.max(0, player.dodgeT - dt);

  const wish = input.wishMove();
  const sprint = input.sprinting() && player.dodgeT <= 0;
  const speed = player.dodgeT > 0 ? 11 : sprint ? 7.2 : 4.6;
  const forward = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();
  move.addScaledVector(right, wish.x);
  move.addScaledVector(forward, -wish.y);
  if (move.lengthSq() > 0) move.normalize();
  player.pos.addScaledVector(move, speed * dt);
  resolve(player.pos, 0.42, world.colliders);
  ghost.group.position.copy(player.pos);
  ghost.group.rotation.y = player.yaw;

  if (input.take("dodge") && player.dodgeCd <= 0) {
    player.dodgeT = DODGE_T;
    player.dodgeCd = DODGE_CD;
    player.iframes = 0.42;
    sfx.melee();
  }
  if (input.take("reload")) tryReload();
  if (input.take("weapon")) {
    player.weapon = player.weapon === "pistol" ? "knife" : "pistol";
    setBanner(player.weapon === "knife" ? "KNIFE READY" : "PISTOL READY");
  }
  if (input.take("melee") || (player.weapon === "knife" && input.firing() && player.meleeCd <= 0)) doMelee();
  if (player.weapon === "pistol" && input.firing()) tryFire();
  if (input.take("use")) tryUse();

  const moving = move.lengthSq() > 0.01;
  player.state = player.hp <= 0 ? "dead" : player.dodgeT > 0 ? "dodge" : player.reloadT > 0 ? "reload" : player.fireCd > 0.12 ? "shoot" : (input.firing() ? "aim" : moving ? (sprint ? "sprint" : "move") : "idle");
  if (window.S9 && window.S9.holdCam) player.state = player.fireCd > 0.12 ? "shoot" : "aim";
  animateGhost(ghost.parts, player.state, clock.elapsedTime, moving && player.dodgeT <= 0);
  if (player.state === "aim" || player.state === "shoot") {
    alignWeapon(ghost.parts, crosshairAimPoint(), recoil);
  }
  updateCamera(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateMission();
  updateFx(dt);
  syncHud();
  $("dmg").classList.toggle("on", player.hurtT > 0);
  $("btn-sprint").classList.toggle("on", input.sprint);
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $("banner").hidden = true;
  }
}

function updateCamera(dt) {
  if (window.S9 && window.S9.holdCam) return;
  const shoulder = 0.85;
  const dist = 2.15;
  const forward = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const lookDir = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  );
  const head = player.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
  const aim = head.clone().addScaledVector(lookDir, 9);
  const desired = head.clone()
    .addScaledVector(forward, -dist)
    .addScaledVector(right, shoulder)
    .add(new THREE.Vector3(0, 0.55, 0));
  const dir = desired.clone().sub(head);
  const len = dir.length();
  dir.normalize();
  const hit = rayHit(head, dir, len, world.colliders);
  const used = hit ? Math.max(1.05, hit.t - 0.3) : len;
  camTarget.copy(head).addScaledVector(dir, used);
  if (shake > 0) {
    camTarget.x += (Math.random() - 0.5) * shake;
    camTarget.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.4);
  }
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
  camera.lookAt(aim);
  camera.getWorldDirection(aimDir);
}

function crosshairAimPoint() {
  aimNdc.set(0, 0.08);
  aimRay.setFromCamera(aimNdc, camera);
  const wall = rayHit(aimRay.ray.origin, aimRay.ray.direction, 48, world.colliders);
  return aimRay.ray.origin.clone().addScaledVector(aimRay.ray.direction, wall ? wall.t : 42);
}

function tryFire() {
  if (player.reloadT > 0 || player.fireCd > 0 || player.dodgeT > 0) return;
  if (player.mag <= 0) {
    tryReload();
    return;
  }
  player.mag -= 1;
  player.fireCd = FIRE_CD;
  recoil = 0.08;
  sfx.shot();
  shake = Math.min(0.1, shake + 0.04);
  alignWeapon(ghost.parts, crosshairAimPoint(), recoil);
  ghost.parts.muzzle.updateWorldMatrix(true, false);
  ghost.parts.muzzle.getWorldPosition(muzzle);
  const barrelDir = new THREE.Vector3(0, 0, 1).applyQuaternion(ghost.parts.muzzle.getWorldQuaternion(new THREE.Quaternion()));
  const aimPoint = crosshairAimPoint();
  const shotDir = aimPoint.clone().sub(muzzle);
  const span = shotDir.length();
  if (span < 0.05) return;
  shotDir.normalize();
  const align = barrelDir.dot(shotDir);
  window.S9.lastShot = { align: Number(align.toFixed(3)), span: Number(span.toFixed(2)) };
  const wall = rayHit(muzzle, shotDir, Math.min(42, span + 0.2), world.colliders);
  let best = wall ? wall.t : Math.min(42, span);
  let hitEnemy = null;
  let hitTarget = false;
  if (shotTarget) {
    const center = shotTarget.mesh.position.clone();
    const toCenter = center.clone().sub(muzzle);
    const dist = toCenter.length();
    toCenter.normalize();
    const aimed = toCenter.dot(shotDir);
    if (aimed > 0.96 && dist < best) {
      best = dist;
      hitTarget = true;
    }
  }
  for (const e of enemies) {
    if (e.dead) continue;
    const to = e.pos.clone().setY(1.2).sub(muzzle);
    const dist = to.length();
    if (dist > best) continue;
    const dir = to.clone().normalize();
    if (dir.dot(shotDir) < 0.985) continue;
    const lateral = to.addScaledVector(shotDir, -dist).length();
    if (lateral < 0.55) {
      best = dist;
      hitEnemy = e;
    }
  }
  const impactAt = muzzle.clone().addScaledVector(shotDir, Math.max(0.35, best));
  spawnFlash(muzzle);
  spawnTracer(muzzle, impactAt);
  spawnImpact(impactAt, hitEnemy || hitTarget ? 0xff4455 : 0xffe0a0);
  if (hitTarget) {
    hitCount += 1;
    spawnMark(impactAt);
    syncHud();
  }
  if (hitEnemy) damageEnemy(hitEnemy, 15);
  if (player.mag === 0) tryReload();
}

function tryReload() {
  if (player.weapon !== "pistol" || player.reloadT > 0 || player.mag >= MAG || player.reserve <= 0) return;
  player.reloadT = RELOAD_T;
  player.reloadPending = true;
  sfx.reload();
}

function doMelee() {
  if (player.meleeCd > 0 || player.dodgeT > 0) return;
  player.meleeCd = MELEE_CD;
  player.state = "melee";
  sfx.melee();
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.pos.clone().sub(player.pos);
    d.y = 0;
    if (d.length() < 1.85 && d.normalize().dot(forward) > 0.25) damageEnemy(e, 34);
  }
}

function damageEnemy(e, amount) {
  e.hp -= amount;
  e.hitT = 0.15;
  sfx.hit();
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    mission.xp += 10;
    if (Math.random() < 0.55) pickups.push(tag(makePickup(scene, e.pos.clone(), Math.random() < 0.5 ? "ammo" : "health")));
  }
}

function tryUse() {
  if (!interact) return;
  if (interact.kind === "cell") {
    interact.item.taken = true;
    scene.remove(interact.item.mesh);
    mission.cells += 1;
    mission.got[interact.item.id] = true;
    mission.xp += 25;
    sfx.pickup();
    if (mission.phase === "cell1") {
      mission.phase = "patrol";
      mission.objective = "CLEAR THE PATROL";
      spawnPatrol();
      setBanner("PATROL INBOUND");
    } else {
      mission.objective = mission.cells < 3 ? "RECOVER THE REMAINING POWER CELLS" : mission.objective;
    }
  } else if (interact.kind === "tower") {
    mission.phase = "activating";
    setBanner("TOWER LINKING");
    sfx.win();
    setTimeout(() => end(true), 1200);
  }
}

function updatePickups(dt) {
  interact = null;
  for (const p of pickups) {
    if (p.taken) continue;
    p.mesh.rotation.y += dt * 1.5;
    p.mesh.position.y = 0.7 + Math.sin(clock.elapsedTime * 3 + p.pos.x) * 0.08;
    const d = Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
    if (p.type === "cell") {
      const allowed = p.id === "c1" ? mission.phase === "cell1" : mission.patrolDone && !mission.got[p.id];
      if (allowed && d < 1.6) interact = { kind: "cell", item: p };
    } else if (d < 1.3) {
      p.taken = true;
      scene.remove(p.mesh);
      if (p.type === "health") player.hp = Math.min(100, player.hp + 35);
      if (p.type === "ammo") player.reserve = Math.min(90, player.reserve + 18);
      sfx.pickup();
    }
  }
  if (mission.phase === "tower") {
    const d = Math.hypot(player.pos.x, player.pos.z + 34.8);
    if (d < 2.8) interact = { kind: "tower" };
  }
}

function spawnPatrol() {
  mission.patrolSpawned = true;
  queueSpawns(["patrol", "patrol", "patrol"]);
}

function queueSpawns(types) {
  mission.queue.push(...types);
}

function updateEnemies(dt) {
  while (mission.queue.length && enemies.filter((e) => !e.dead).length < 5) {
    const type = mission.queue.shift();
    const e = createEnemy(type);
    const spots = [new THREE.Vector3(-6, 0, 8), new THREE.Vector3(6, 0, -4), new THREE.Vector3(0, 0, -16), new THREE.Vector3(4, 0, 20)];
    e.pos.copy(spots[Math.floor(Math.random() * spots.length)]);
    e.pos.x += Math.random() * 2;
    resolve(e.pos, 0.5, world.colliders);
    e.group.position.copy(e.pos);
    e.group.userData.ephemeral = true;
    scene.add(e.group);
    enemies.push(e);
    mission.waveLive = true;
  }
  for (const e of enemies) {
    e.attackT -= dt;
    e.hitT = Math.max(0, e.hitT - dt);
    if (e.dead) {
      e.group.position.y = Math.max(-0.4, e.group.position.y - dt);
      animateEnemy(e, clock.elapsedTime, false);
      continue;
    }
    const to = player.pos.clone().sub(e.pos);
    to.y = 0;
    const dist = to.length();
    const sees = dist < 18 && segmentClear(e.pos, player.pos, world.colliders, 0.15);
    let moving = false;
    if (sees && dist > e.melee) {
      to.normalize();
      let dir = to;
      if (blocked(e.pos, dir, 1.2, 0.45, world.colliders)) {
        const left = new THREE.Vector3(-dir.z, 0, dir.x);
        const right = left.clone().multiplyScalar(-1);
        dir = blocked(e.pos, left, 1.2, 0.45, world.colliders) ? right : left;
      }
      e.pos.addScaledVector(dir, e.speed * dt);
      resolve(e.pos, 0.45, world.colliders);
      e.group.rotation.y = Math.atan2(dir.x, dir.z);
      moving = true;
    } else if (!sees) {
      const wander = new THREE.Vector3(Math.sin(clock.elapsedTime + e.pos.x), 0, Math.cos(clock.elapsedTime * 0.7));
      if (!blocked(e.pos, wander, 1, 0.45, world.colliders)) e.pos.addScaledVector(wander, e.speed * 0.35 * dt);
      moving = true;
    }
    e.group.position.x = e.pos.x;
    e.group.position.z = e.pos.z;
    if (sees && dist < e.range && e.attackT <= 0 && player.iframes <= 0) {
      const shotFrom = e.pos.clone().setY(1.3);
      const shotTo = player.pos.clone().setY(1.2);
      if (segmentClear(shotFrom, shotTo, world.colliders, 0.05)) {
        player.hp = Math.max(0, player.hp - e.dmg);
        player.hurtT = 0.25;
        e.attackT = e.cd;
        sfx.hurt();
        shake = 0.1;
      }
    }
    animateEnemy(e, clock.elapsedTime, moving);
  }
}

function updateMission() {
  const alive = enemies.some((e) => !e.dead) || mission.queue.length > 0;
  if (mission.phase === "patrol" && mission.patrolSpawned && mission.waveLive && !alive) {
    mission.waveLive = false;
    mission.patrolDone = true;
    mission.phase = "cells";
    mission.objective = "RECOVER TWO MORE POWER CELLS";
    setBanner("PATROL CLEARED");
  }
  if (mission.phase === "cells" && mission.cells >= 3) {
    mission.phase = "wave";
    mission.wave = 1;
    mission.waveLive = false;
    mission.objective = "SURVIVE WAVE 1 / 3";
    queueSpawns(["patrol", "patrol", "patrol"]);
    setBanner("WAVE 1");
    sfx.wave();
  }
  if (mission.phase === "wave" && mission.waveLive && !alive) {
    mission.waveLive = false;
    mission.wavesDone += 1;
    if (mission.wavesDone >= 3) {
      mission.phase = "tower";
      mission.objective = "ACTIVATE THE COMMUNICATIONS TOWER";
      setBanner("TOWER UNLOCKED");
    } else {
      mission.phase = "wave";
      mission.wave = mission.wavesDone + 1;
      mission.objective = `SURVIVE WAVE ${mission.wave} / 3`;
      const packs = [
        ["patrol", "patrol", "hunter", "hunter"],
        ["hunter", "hunter", "enforcer", "patrol"]
      ];
      queueSpawns(packs[mission.wavesDone - 1]);
      setBanner("WAVE " + mission.wave);
      sfx.wave();
    }
  }
  if (mission.phase === "cell1") mission.objective = "COLLECT THE FIRST POWER CELL";
}

function updateFx(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt;
    flashes[i].light.intensity = Math.max(0, flashes[i].life * 40);
    if (flashes[i].burst) flashes[i].burst.scale.setScalar(Math.max(0.2, flashes[i].life * 12));
    if (flashes[i].life <= 0) {
      scene.remove(flashes[i].light);
      if (flashes[i].burst) scene.remove(flashes[i].burst);
      flashes.splice(i, 1);
    }
  }
  if (tracer) {
    tracer.userData.life -= dt;
    if (tracer.userData.life <= 0) {
      scene.remove(tracer);
      tracer.geometry.dispose();
      tracer = null;
    }
  }
  const dummy = new THREE.Object3D();
  impacts.items = impacts.items.filter((it) => (it.life -= dt) > 0);
  impacts.mesh.count = impacts.items.length;
  impacts.items.forEach((it, i) => {
    dummy.position.copy(it.pos);
    dummy.scale.setScalar(Math.max(0.2, it.life * 5));
    dummy.updateMatrix();
    impacts.mesh.setMatrixAt(i, dummy.matrix);
  });
  impacts.mesh.instanceMatrix.needsUpdate = true;
}

function rayAabbHit(origin, dir, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const mins = [box.minX, box.minY, box.minZ];
  const maxs = [box.maxX, box.maxY, box.maxZ];
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return null;
    } else {
      let t1 = (mins[i] - o[i]) / d[i];
      let t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : null;
}

function spawnMark(pos) {
  const mark = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
  );
  mark.position.copy(pos);
  scene.add(mark);
}
  function spawnFlash(pos) {
  const light = new THREE.PointLight(0xfff1c4, 18, 8, 2);
  light.position.copy(pos);
  const burst = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff6d0 })
  );
  burst.position.copy(pos);
  scene.add(light, burst);
  flashes.push({ light, burst, life: 0.22 });
}

function spawnTracer(from, to) {
  if (tracer) {
    scene.remove(tracer);
    tracer.geometry.dispose();
  }
  const dir = to.clone().sub(from);
  const len = Math.max(0.2, dir.length());
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, len, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff1b0 })
  );
  mesh.position.copy(from).addScaledVector(dir.normalize(), len * 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  tracer = mesh;
  tracer.userData.life = 0.28;
  scene.add(tracer);
}

function makeImpacts() {
  const geo = new THREE.SphereGeometry(0.16, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
  const mesh = new THREE.InstancedMesh(geo, mat, 24);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  return { mesh, items: [] };
}

function spawnImpact(pos) {
  impacts.items.push({ pos: pos.clone(), life: 0.35 });
  if (impacts.items.length > 24) impacts.items.shift();
  const dummy = new THREE.Object3D();
  impacts.mesh.count = impacts.items.length;
  impacts.items.forEach((it, i) => {
    dummy.position.copy(it.pos);
    dummy.scale.setScalar(it.life * 4);
    dummy.updateMatrix();
    impacts.mesh.setMatrixAt(i, dummy.matrix);
  });
  impacts.mesh.instanceMatrix.needsUpdate = true;
}

function syncHud() {
  $("hp-fill").style.width = player.hp + "%";
  $("hp-text").textContent = Math.ceil(player.hp) + " HP";
  $("weapon-name").textContent = player.weapon === "knife" ? "KNIFE" : "PISTOL";
  $("ammo-text").textContent = player.weapon === "knife" ? "READY" : `${player.mag} / ${player.reserve}`;
  $("objective").textContent = mission.objective;
  $("wave-pill").textContent = mission.wave ? `WAVE ${mission.wave} / 3` : "WAVE — / 3";
  $("cell-pill").textContent = `CELLS ${mission.cells} / 3`;
  $("xp-pill").textContent = `XP ${mission.xp}`;
  const hits = $("hit-pill");
  if (hits) hits.textContent = `HITS ${hitCount}`;
  $("btn-use").classList.toggle("ready", !!interact);
  const target = currentTarget();
  const marker = $("marker");
  if (!target) {
    marker.hidden = true;
    return;
  }
  const projected = target.clone().project(camera);
  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  const behind = projected.z > 1;
  const m = 28;
  const cx = Math.max(m, Math.min(window.innerWidth - m, behind ? window.innerWidth - x : x));
  const cy = Math.max(m, Math.min(window.innerHeight - m, behind ? window.innerHeight - y : y));
  marker.hidden = false;
  marker.style.left = cx + "px";
  marker.style.top = cy + "px";
}

function currentTarget() {
  if (mission.phase === "cell1") return CELL_SPOTS[0].pos.clone().setY(1.4);
  if (mission.phase === "cells") {
    const next = CELL_SPOTS.find((c) => !mission.got[c.id]);
    return next ? next.pos.clone().setY(1.4) : null;
  }
  if (mission.phase === "tower" || mission.phase === "activating") return new THREE.Vector3(0, 4, -38);
  return null;
}

function setBanner(text) {
  $("banner").hidden = false;
  $("banner").textContent = text;
  bannerT = 2.2;
}

function end(win) {
  if (mode === "end") return;
  mode = "end";
  input.blocked = true;
  input.clearHeld();
  $("hud").hidden = true;
  $("screen-end").hidden = false;
  $("end-title").textContent = win ? "MISSION COMPLETE" : "GHOST DOWN";
  $("end-copy").textContent = win
    ? `Communications restored. XP ${mission.xp}. No checkpoints — restart replays the full mission.`
    : "Sector 9 holds. Restart resets health, ammo, cells, waves, and inputs.";
  if (win) sfx.win(); else sfx.lose();
  document.exitPointerLock?.();
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  applyQuality();
  renderer.setSize(w, h, false);
}

function snapshot() {
  return {
    mode,
    hp: player?.hp,
    mag: player?.mag,
    reserve: player?.reserve,
    cells: mission?.cells,
    phase: mission?.phase,
    wave: mission?.wave,
    wavesDone: mission?.wavesDone,
    enemies: enemies?.filter((e) => !e.dead).length,
    pos: player ? { x: player.pos.x, z: player.pos.z } : null
  };
}

boot();
