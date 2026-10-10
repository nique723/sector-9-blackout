import * as THREE from "three";
import { Sfx } from "./audio.js";
import { Input } from "./input.js";
import { Fx } from "./fx.js";
import { makeCell, makePickup, resolve, blocked, segmentClear, rayHit } from "./world.js";
import { loadSector9Street } from "./load-street.js";
import { loadCharacters, Rig } from "./character.js";

const $ = (id) => document.getElementById(id);

// --- Tuning. Everything that changes how the game feels lives here. ---------
const MAG = 12;
const START_RESERVE = 60;
const FIRE_CD = 0.17;          // seconds between shots while FIRE is held
const RELOAD_T = 1.4;
const BODY_DMG = 16;
const HEAD_DMG = 36;
const MELEE_DMG = 34;
const MELEE_CD = 0.55;
const MELEE_T = 0.3;
const DODGE_T = 0.38;
const DODGE_CD = 1.1;
const DODGE_SPEED = 10.5;
const RUN_SPEED = 4.3;
const SPRINT_SPEED = 6.6;
const AIM_SPEED = 2.8;         // you slow down while the gun is up
const ACCEL = 30;
const AIM_HOLD = 0.9;          // gun stays raised this long after the last shot
const SPREAD_BASE = 0.0025;    // radians
const SPREAD_MOVE = 0.009;
const SPREAD_PER_SHOT = 0.011;
const SPREAD_MAX = 0.05;
const RECOIL_PITCH = 0.017;    // camera kick per shot, radians
const FOV_BASE = 58;
const FOV_AIM = 51;
const FOV_SPRINT = 63;
const PITCH_MIN = -0.85;
const PITCH_MAX = 0.8;

// The Blackout Crew. `role` decides how each type fights:
//   hold  - finds a barricade or dumpster between you and them, trades shots from it
//   flank - circles to your side and fires short bursts on the move
//   push  - walks straight at you and fires long bursts
// dmg is per round; burst is rounds per trigger pull; mag forces a reload.
const ENEMY = {
  patrol: { role: "hold", tint: 0xa39c8e, glow: 0xff3344, scale: 1, bulk: 1, gun: "rifle", hp: 46, speed: 2.7, dmg: 8, range: 14, hold: 8, mag: 6, burst: 1, burstGap: 0, cd: 1.05, xp: 10 },
  hunter: { role: "flank", tint: 0x6d777d, glow: 0x39e0ff, scale: 0.95, bulk: 0.93, gun: "smg", hp: 30, speed: 4.5, dmg: 5, range: 10, hold: 5, mag: 9, burst: 3, burstGap: 0.09, cd: 1, xp: 10 },
  enforcer: { role: "push", tint: 0x5b544d, glow: 0xff8a1e, scale: 1.16, bulk: 1.16, gun: "heavy", hp: 110, speed: 1.9, dmg: 6, range: 12, hold: 3.5, mag: 12, burst: 4, burstGap: 0.11, cd: 1.35, xp: 20 }
};
// Boxing. The punch button throws the jab; press again inside the window for
// the cross. A clean 1-2 drops a Patrol. Times are seconds, distances metres.
const PUNCH = {
  jab: { t: 0.26, hit: 0.34, dmg: 16, stagger: 0.3, push: 0.12, shake: 0.03 },
  cross: { t: 0.38, hit: 0.36, dmg: 32, stagger: 0.55, push: 0.45, shake: 0.08 },
  window: 0.55,     // after a jab lands or misses, how long the cross stays loaded
  reach: 1.25,      // fist range from Ghost's centre
  lunge: 1.6,       // extra distance he will step in to close on a target
  cone: 0.45,       // cos of the half-angle in front that counts as a target
  stand: 0.95,      // he stops stepping in at this distance
  guard: 0.7        // hands stay up this long after the last punch
};

// Aim lock. While FIRE is held, the crosshair snaps to the nearest target near
// it and stays on him as he moves. Drag hard to break off or switch target.
// Angles are radians.
const AIM_LOCK = {
  acquire: 0.24,    // how close to the crosshair a target must be to lock
  keep: 0.42,       // how far he can drift before the lock drops
  range: 34,
  track: 11,        // how fast the view follows a moving target
  breakDrag: 1.3,   // drag faster than this (radians a second) to break the lock
  breakTime: 0.35,
  chest: 1.2,       // lock sits between chest and head, times enemy scale
  head: 1.62
};

// Ambushes: Blackout Crew stragglers that pop up at random, from behind cover
// or from wherever Ghost is not looking. Times are seconds, distances metres.
const AMBUSH = {
  first: [8, 14],   // before the first one
  gap: [10, 18],    // between ambushes
  pair: 0.35,       // chance that two come at once
  quiet: 3,         // outside a fight, hold off while this many are alive
  maxAlive: 5,      // during a patrol or wave, never stack past this
  perFight: 2,      // extra bodies allowed per patrol or wave
  near: 10,
  far: 24,
  rise: 0.45        // time to stand up from behind cover
};
const CAM_PAD = 0.3;            // lens stays this far off any wall
const CAM_EDGE = 0.25;          // how far past the kerb line the lens may sit
const WINDUP = 0.42;           // enemy raises and steadies before each burst
const ENEMY_RELOAD = 1.8;      // the window to push them

const settings = loadSettings();
const input = new Input();
const sfx = new Sfx();
const touch = matchMedia("(pointer: coarse)").matches;

let renderer, scene, camera, clock;
let world, chars, ghost, fx, player, enemies, pickups;
let mode = "load";
let pauseReason = null;
let quality = settings.quality;
let fpsOn = settings.fps;
let aimLockOn = settings.aimLock !== false;
let lockTarget = null;
let lockBreakT = 0;
let camBoom = 3.3;
let fpsAcc = 0;
let fpsFrames = 0;
let bannerT = 0;
let camYaw = 0;
let camPitch = -0.06;
let shake = 0;
let fovKick = 0;
let aimAmt = 0;
let mission;
let interact = null;
let resumeGraceUntil = 0;
let hitMarkT = 0;
let wasFiring = false;
let floaters = [];
let coverPoints = [];
let calloutT = 0;
let hurtDirT = 0;

const camPivot = new THREE.Vector3();
const lookDir = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const aimInfo = { point: new THREE.Vector3(), kind: "none", enemy: null, head: false, normal: new THREE.Vector3(0, 1, 0), t: 0 };
const shotFrame = {
  right: new THREE.Vector3(), chest: new THREE.Vector3(), aimDir: new THREE.Vector3(),
  grip: new THREE.Vector3(), gunDir: new THREE.Vector3(), muzzle: new THREE.Vector3()
};

const CELL_SPOTS = [
  { id: "c1", pos: new THREE.Vector3(-7, 0, 14) },
  { id: "c2", pos: new THREE.Vector3(7, 0, 0) },
  { id: "c3", pos: new THREE.Vector3(0, 0, -27) }
];
const SPAWN_SPOTS = [
  new THREE.Vector3(-6, 0, 8), new THREE.Vector3(6, 0, -4), new THREE.Vector3(0, 0, -16),
  new THREE.Vector3(4, 0, 20), new THREE.Vector3(-5, 0, -30), new THREE.Vector3(5, 0, 32)
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function loadSettings() {
  const base = { sensitivity: 1, quality: "medium", volume: 0.7, fps: false, aimLock: true };
  try {
    return Object.assign(base, JSON.parse(localStorage.getItem("s9-settings") || "{}"));
  } catch {
    return base;
  }
}

function saveSettings() {
  try {
    localStorage.setItem("s9-settings", JSON.stringify({ sensitivity: input.sensitivity, quality, volume: sfx.volume, fps: fpsOn, aimLock: aimLockOn }));
  } catch { /* private mode */ }
}

async function boot() {
  try {
    $("load-status").textContent = "Loading Sector 9, Caldosta…";
    renderer = new THREE.WebGLRenderer({ canvas: $("view"), antialias: quality !== "low", powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 160);
    clock = new THREE.Clock();
    applyQuality();
    [world, chars] = await Promise.all([
      loadSector9Street(scene, "assets/sector9-street/"),
      loadCharacters("assets/characters/")
    ]);
    buildCover();
    ghost = new Rig(chars.ghost, { height: 1.84, weapon: "pistol" });
    scene.add(ghost.group);
    fx = new Fx(scene, quality);
    enemies = [];
    pickups = [];
    resetMission();
    input.bind();
    input.sensitivity = settings.sensitivity;
    sfx.volume = settings.volume;
    bindUi();
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    // Compile every shader up front so the first shot and first enemy do not hitch.
    const warm = makeEnemy("patrol");
    warm.rig.group.position.set(0, -50, 0);
    const hidden = [];
    fx.root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    renderer.compile(scene, camera);
    hidden.forEach((o) => { o.visible = false; });
    removeEnemy(warm);
    $("load-status").textContent = "District ready.";
    $("screen-load").hidden = true;
    $("screen-start").hidden = false;
    mode = "start";
    window.S9 = { get state() { return snapshot(); } };
    if (location.hash === "#test") installDebug();
    requestAnimationFrame(loop);
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent = "Asset/init error: " + err.message;
    $("build-stamp").textContent += " ERROR";
    console.error(err);
  }
}

// Developer hooks, only with #test on the URL.
function installDebug() {
  window.S9.debug = {
    teleport: (x, z) => { player.pos.set(x, 0, z); },
    look: (yaw, pitch) => { camYaw = yaw; camPitch = pitch; },
    spawn: (type, x, z) => { const e = makeEnemy(type); e.pos.set(x, 0, z); e.facing = Math.atan2(player.pos.x - x, player.pos.z - z); e.passive = true; enemies.push(e); mission.waveLive = false; return enemies.length; },
    enemyState: () => enemies.map((e) => ({ type: e.type, hp: e.hp, dead: e.dead, x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2), cover: !!e.cover, ammo: e.ammo, reloading: e.reloadT > 0 })),
    cover: () => coverPoints.map((c) => [+c.pos.x.toFixed(2), +c.pos.z.toFixed(2)]),
    wake: () => enemies.forEach((e) => { e.passive = false; }),
    ambush: (n = 1) => spawnAmbush(n),
    punch: () => tryPunch(),
    lock: () => (lockTarget ? enemies.indexOf(lockTarget) : -1),
    setAimLock: (on) => { aimLockOn = on; },
    playerState: () => ({ state: player.state, punch: player.punch && player.punch.kind, comboT: +player.comboT.toFixed(2), facing: +player.facing.toFixed(2), yaw: +camYaw.toFixed(3), pitch: +camPitch.toFixed(3), boom: +camBoom.toFixed(2), cam: camera.position.toArray().map((v) => +v.toFixed(2)) }),
    ambushIn: (t) => { mission.ambushT = t; },
    killAll: () => enemies.forEach((e) => { if (!e.dead) damageEnemy(e, 999, false, e.pos.clone().setY(1.2), new THREE.Vector3(0, 0, 1)); }),
    hurt: (n) => hurtPlayer(n),
    emptyMag: () => { player.mag = 0; },
    aim: () => ({ kind: aimInfo.kind, head: aimInfo.head, t: aimInfo.t }),
    enemies: () => enemies.map((e) => ({ type: e.type, hp: e.hp, dead: e.dead })),
    reset: () => resetMission(),
    freeze: (on = true) => { window.S9.frozen = on; },
    step: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) if (mode === "play") update(dt); },
    cam: (x, y, z, tx, ty, tz) => { window.S9.freeCam = x === undefined ? null : [x, y, z, tx, ty, tz]; }
  };
}

function applyQuality() {
  const cap = quality === "low" ? 1 : quality === "medium" ? 1.25 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
}

function resetMission() {
  for (const e of enemies) e.rig.dispose();
  enemies = [];
  for (const c of coverPoints) c.owner = null;
  calloutT = 0;
  for (const p of pickups) scene.remove(p.mesh);
  pickups = [];
  floaters.forEach((f) => f.el.remove());
  floaters = [];
  fx.reset();
  player = {
    pos: new THREE.Vector3(0, 0, 30),
    vel: new THREE.Vector3(),
    facing: Math.PI,
    lower: 0,
    backward: false,
    hp: 100,
    mag: MAG,
    reserve: START_RESERVE,
    weapon: "pistol",
    state: "idle",
    fireCd: 0,
    aimHold: 0,
    bloom: 0,
    recoilP: 0,
    recoilY: 0,
    kick: 0,
    snapAim: false,
    reloadT: 0,
    meleeT: 0,
    meleeCd: 0,
    punch: null,        // { kind, t, hit, target }
    punchQueued: false,
    comboT: 0,          // > 0 means the cross is loaded
    guardT: 0,
    dodgeCd: 0,
    dodgeT: 0,
    dodgeDir: new THREE.Vector3(),
    iframes: 0,
    hurtT: 0,
    deadT: 0
  };
  camYaw = player.facing;
  camPitch = -0.06;
  lockTarget = null;
  lockBreakT = 0;
  aimAmt = 0;
  fovKick = 0;
  shake = 0;
  camPivot.copy(player.pos).setY(1.52);
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
    ambushT: lerp(AMBUSH.first[0], AMBUSH.first[1], Math.random()),
    ambushFight: 0,
    ambushes: 0,
    xp: 0,
    objective: "COLLECT THE FIRST POWER CELL"
  };
  CELL_SPOTS.forEach((c) => pickups.push(makeCell(scene, c.pos, c.id)));
  pickups.push(makePickup(scene, new THREE.Vector3(6, 0, 22), "ammo"));
  pickups.push(makePickup(scene, new THREE.Vector3(-6, 0, -12), "health"));
  input.clearHeld();
  updateCamera(1);
  updateAim();
  poseGhost(0);
  setBanner("ENTER SECTOR 9");
  syncHud();
}

function bindUi() {
  // Stop the browser's own gestures (edge swipe, pull, pinch, double-tap zoom,
  // long-press menu) from sliding or zooming the page in the middle of a fight.
  const guard = (e) => { if (mode === "play" && !(e.target.closest && e.target.closest(".screen"))) e.preventDefault(); };
  for (const type of ["touchstart", "touchmove", "touchend"]) document.addEventListener(type, guard, { passive: false });
  for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick", "contextmenu"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  window.addEventListener("scroll", () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

  $("btn-start").onclick = () => {
    sfx.unlock();
    // Phones that allow it: go full screen and hold landscape, so there is no
    // browser bar or edge gesture left to fight with.
    if (touch && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" })
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape"))
        .catch(() => { /* not allowed here; the page still plays */ });
    }
    $("screen-start").hidden = true;
    $("hud").hidden = false;
    if (isPortrait()) {
      mode = "pause";
      pauseReason = "portrait";
      input.blocked = true;
      $("portrait").hidden = false;
      return;
    }
    beginPlay();
  };
  $("btn-resume").onclick = resume;
  $("btn-unpause-vis").onclick = resume;
  $("btn-restart").onclick = restart;
  $("btn-again").onclick = restart;
  $("sens").value = settings.sensitivity;
  $("sens").oninput = () => { input.sensitivity = Number($("sens").value); saveSettings(); };
  $("quality").value = quality;
  $("quality").onchange = () => {
    quality = $("quality").value;
    saveSettings();
    applyQuality();
    resize();
  };
  $("volume").value = settings.volume;
  $("volume").oninput = () => { sfx.volume = Number($("volume").value); saveSettings(); };
  $("show-fps").checked = fpsOn;
  $("show-fps").onchange = () => { fpsOn = $("show-fps").checked; $("fps").hidden = !fpsOn; saveSettings(); };
  $("aim-lock").checked = aimLockOn;
  $("aim-lock").onchange = () => { aimLockOn = $("aim-lock").checked; saveSettings(); };
  $("view").addEventListener("click", () => {
    if (mode === "play" && !touch && document.pointerLockElement !== $("view")) {
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
  if (reason === "portrait") $("portrait").hidden = false;
  else if (reason === "tab") $("resume-lock").hidden = false;
  else $("screen-pause").hidden = false;
  document.exitPointerLock?.();
}

function resume() {
  sfx.unlock();
  if (isPortrait()) {
    mode = "pause";
    pauseReason = "portrait";
    input.blocked = true;
    hide("resume-lock");
    hide("screen-pause");
    $("portrait").hidden = false;
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
  else if (!isPortrait() && mode === "pause" && pauseReason === "portrait") resume();
  if (mode === "play") { if (!(window.S9 && window.S9.frozen)) update(dt); }
  else if (mode === "start") poseGhost(dt);
  const free = window.S9 && window.S9.freeCam;
  if (free) {
    // Debug only: view the scene from a fixed offset. Aiming still uses the game camera.
    camera.position.set(player.pos.x + free[0], free[1], player.pos.z + free[2]);
    camera.lookAt(player.pos.x + free[3], free[4], player.pos.z + free[5]);
  }
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
  if (input.take("pause")) { pause("user"); return; }

  // --- Look. On touch, the stick slows a little while the crosshair is on a
  // target so a thumb can actually hold it there.
  const look = input.consumeLook();
  const friction = touch && aimInfo.enemy ? 0.55 : 1;
  camYaw -= look.dx * friction;
  camPitch = clamp(camPitch - look.dy * friction, PITCH_MIN, PITCH_MAX);
  updateAimLock(dt, look);

  if (player.hp <= 0) {
    player.deadT += dt;
    player.state = "dead";
    player.vel.set(0, 0, 0);
    poseGhost(dt);
    updateCamera(dt);
    updateEnemies(dt);
    fx.update(dt);
    updateFloaters(dt);
    if (player.deadT > 1.6) end(false);
    return;
  }

  // --- Timers.
  player.fireCd = Math.max(0, player.fireCd - dt);
  player.meleeCd = Math.max(0, player.meleeCd - dt);
  player.meleeT = Math.max(0, player.meleeT - dt);
  player.dodgeCd = Math.max(0, player.dodgeCd - dt);
  player.dodgeT = Math.max(0, player.dodgeT - dt);
  player.iframes = Math.max(0, player.iframes - dt);
  player.hurtT = Math.max(0, player.hurtT - dt);
  player.aimHold = Math.max(0, player.aimHold - dt);
  player.comboT = Math.max(0, player.comboT - dt);
  player.guardT = Math.max(0, player.guardT - dt);
  player.bloom = Math.max(0, player.bloom - dt * (0.02 + player.bloom * 4.5));
  player.recoilP *= Math.exp(-dt * 8);
  player.recoilY *= Math.exp(-dt * 8);
  player.kick *= Math.exp(-dt * 16);
  fovKick *= Math.exp(-dt * 12);
  if (player.reloadT > 0) {
    player.reloadT = Math.max(0, player.reloadT - dt);
    if (player.reloadT === 0) {
      const take = Math.min(MAG - player.mag, player.reserve);
      player.mag += take;
      player.reserve -= take;
    }
  }

  const firing = input.firing();
  const pistolUp = player.weapon === "pistol" && player.reloadT <= 0 && player.dodgeT <= 0 && !player.punch;
  if (firing && pistolUp) player.aimHold = AIM_HOLD;
  const aiming = pistolUp && player.aimHold > 0;

  // --- Move. Velocity eases towards the stick instead of snapping to it.
  const wish = input.wishMove();
  const fwdX = Math.sin(camYaw);
  const fwdZ = Math.cos(camYaw);
  const move = tmpA.set(-fwdZ * wish.x - fwdX * wish.y, 0, fwdX * wish.x - fwdZ * wish.y);
  const stick = Math.min(1, move.length());
  if (stick > 0) move.normalize();
  const sprint = input.sprinting() && !aiming && stick > 0.2 && player.dodgeT <= 0;

  if (input.take("dodge") && player.dodgeCd <= 0 && player.reloadT <= 0) {
    player.dodgeT = DODGE_T;
    player.dodgeCd = DODGE_CD;
    player.iframes = DODGE_T + 0.06;
    player.aimHold = 0;
    player.punch = null;
    player.punchQueued = false;
    player.guardT = 0;
    if (stick > 0.2) player.dodgeDir.copy(move);
    else player.dodgeDir.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    sfx.dodge();
  }

  if (player.dodgeT > 0) {
    player.vel.copy(player.dodgeDir).multiplyScalar(DODGE_SPEED * (0.55 + 0.45 * (player.dodgeT / DODGE_T)));
  } else {
    const top = aiming ? AIM_SPEED : sprint ? SPRINT_SPEED : RUN_SPEED;
    const want = tmpB.copy(move).multiplyScalar(top * stick);
    const dv = want.sub(player.vel);
    const step = ACCEL * dt;
    if (dv.length() <= step) player.vel.add(dv);
    else player.vel.addScaledVector(dv.normalize(), step);
  }
  const before = tmpB.copy(player.pos);
  player.pos.addScaledVector(player.vel, dt);
  resolve(player.pos, 0.42, world.colliders);
  // If a wall stopped us, drop the speed so the legs stop running in place.
  const moved = before.distanceTo(player.pos);
  const speed = dt > 0 ? Math.min(player.vel.length(), moved / dt + 0.3) : 0;
  const moving = speed > 0.25;

  // --- Camera first, so this frame's shot uses this frame's view.
  updateCamera(dt, aiming, sprint && moving);
  updateAim();

  // --- Actions.
  if (input.take("reload")) tryReload();
  if (input.take("weapon") && player.reloadT <= 0) {
    player.weapon = player.weapon === "pistol" ? "knife" : "pistol";
    player.aimHold = 0;
    setBanner(player.weapon === "knife" ? "KNIFE READY" : "PISTOL READY");
  }
  if (player.weapon === "knife") {
    if (input.take("melee") || firing) doMelee();
  } else if (input.take("melee")) {
    tryPunch();
  }
  updatePunch(dt);
  if (player.weapon === "pistol" && firing && !player.punch) tryFire(!wasFiring);
  wasFiring = firing;
  if (input.take("use")) tryUse();

  // --- Body. Aiming squares the chest to the crosshair and lets the legs
  // follow the stick; otherwise the whole body turns into the run.
  const squared = aiming || player.meleeT > 0;
  let lowerWant = 0;
  player.backward = false;
  if (player.dodgeT > 0) {
    player.facing = Math.atan2(player.dodgeDir.x, player.dodgeDir.z);
  } else if (player.punch || player.guardT > 0) {
    // Fists up: stay square to whoever is being hit, or to the camera.
    const t = player.punch && player.punch.target && !player.punch.target.dead ? player.punch.target : null;
    const want = t ? Math.atan2(t.pos.x - player.pos.x, t.pos.z - player.pos.z) : player.punch ? player.facing : camYaw;
    player.facing += wrapPi(want - player.facing) * ease(22, dt);
    if (moving) {
      let off = wrapPi(Math.atan2(player.vel.x, player.vel.z) - player.facing);
      if (Math.abs(off) > 1.75) { player.backward = true; off = wrapPi(off - Math.PI); }
      lowerWant = clamp(off, -1.05, 1.05);
    }
  } else if (squared) {
    player.facing += wrapPi(camYaw - player.facing) * (player.snapAim ? 1 : ease(24, dt));
    if (moving) {
      let off = wrapPi(Math.atan2(player.vel.x, player.vel.z) - player.facing);
      if (Math.abs(off) > 1.75) {
        player.backward = true;
        off = wrapPi(off - Math.PI);
      }
      lowerWant = clamp(off, -1.05, 1.05);
    }
  } else if (moving) {
    player.facing += wrapPi(Math.atan2(player.vel.x, player.vel.z) - player.facing) * ease(13, dt);
  }
  player.lower += (lowerWant - player.lower) * ease(14, dt);

  player.state = player.dodgeT > 0 ? "dodge" : player.punch ? "punch" : player.reloadT > 0 ? "reload" : player.meleeT > 0 ? "melee" : aiming ? "aim" : moving ? (sprint ? "sprint" : "move") : "idle";
  poseGhost(dt, speed, aiming);
  player.snapAim = false;
  if (ghost.stepped && player.dodgeT <= 0) sfx.step();

  updateEnemies(dt);
  updatePickups(dt);
  updateMission();
  fx.update(dt);
  updateFloaters(dt);
  syncHud(dt, speed);
  $("dmg").classList.toggle("on", player.hurtT > 0);
  $("btn-sprint").classList.toggle("on", input.sprint);
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $("banner").hidden = true;
  }
  if (hurtDirT > 0) {
    hurtDirT -= dt;
    if (hurtDirT <= 0) $("hurt-dir").classList.remove("on");
  }
}

function poseGhost(dt, speed = 0, aiming = false) {
  let pose = "none";
  let poseT = 0;
  if (player.hp <= 0) { pose = "dead"; poseT = player.deadT / 0.55; }
  else if (player.dodgeT > 0) { pose = "dodge"; poseT = 1 - player.dodgeT / DODGE_T; }
  else if (player.punch) { pose = player.punch.kind; poseT = player.punch.t / PUNCH[player.punch.kind].t; }
  else if (player.reloadT > 0 && player.guardT <= 0) { pose = "reload"; poseT = 1 - player.reloadT / RELOAD_T; }
  else if (player.meleeT > 0) { pose = "melee"; poseT = 1 - player.meleeT / MELEE_T; }
  ghost.update(dt, {
    pos: player.pos,
    facing: player.facing,
    lower: player.lower,
    backward: player.backward,
    speed,
    aim: aiming,
    aimPoint: aimInfo.point,
    kick: player.kick,
    pose,
    poseT,
    knife: player.weapon === "knife" || player.meleeT > 0,
    snapAim: player.snapAim,
    guard: player.guardT > 0,
    punchAt: player.punch ? punchPoint(player.punch.target) : null
  });
}

// Over-the-right-shoulder camera. Ghost sits left of centre so the crosshair,
// and the right thumb, are never on top of him.
function updateCamera(dt, aiming = false, sprinting = false) {
  aimAmt += ((aiming ? 1 : 0) - aimAmt) * ease(11, dt);
  const fovWant = lerp(sprinting ? FOV_SPRINT : FOV_BASE, FOV_AIM, aimAmt) + fovKick;
  camera.fov += (fovWant - camera.fov) * ease(10, dt);
  camera.updateProjectionMatrix();

  const yaw = camYaw + player.recoilY;
  const pitch = clamp(camPitch + player.recoilP, PITCH_MIN, PITCH_MAX + 0.1);
  lookDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const right = tmpA.set(-Math.cos(yaw), 0, Math.sin(yaw));

  tmpB.copy(player.pos).setY(player.pos.y + 1.52);
  camPivot.x = tmpB.x;
  camPivot.z = tmpB.z;
  camPivot.y += (tmpB.y - camPivot.y) * ease(14, dt);

  const dist = lerp(3.3, 2.45, aimAmt);
  // Keep the lens inside the street. A wall beside Ghost slides the camera in
  // behind him; a wall behind him pulls it closer. It never goes through one.
  const b = world.layout.bounds;
  let side = lerp(0.72, 0.6, aimAmt);
  const sideHit = rayHit(camPivot, right, side + CAM_PAD, world.colliders);
  if (sideHit) side = Math.min(side, sideHit.t - CAM_PAD);
  const edge = right.x > 0 ? (b.maxX + CAM_EDGE - camPivot.x) / right.x : right.x < 0 ? (b.minX - CAM_EDGE - camPivot.x) / right.x : Infinity;
  side = Math.max(0, Math.min(side, edge - 0.1));
  const shoulder = new THREE.Vector3().copy(camPivot).addScaledVector(right, side);
  shoulder.y += 0.2;
  const back = lookDir.clone().negate();
  let boom = dist;
  // Five rays: the centre of the lens and its four corners.
  const camUp = new THREE.Vector3().crossVectors(right, lookDir).normalize();
  for (const [ox, oy] of [[0, 0], [0.28, 0.16], [-0.28, 0.16], [0.28, -0.16], [-0.28, -0.16]]) {
    const from = tmpB.copy(shoulder).addScaledVector(right, ox * Math.min(1, side / 0.3 + 0.2)).addScaledVector(camUp, oy);
    const hit = rayHit(from, back, dist + CAM_PAD, world.colliders);
    if (hit) boom = Math.min(boom, hit.t - CAM_PAD);
  }
  // Street ends and the building line, where there is no collider to hit.
  for (const [o, d, lo, hi] of [[shoulder.x, back.x, b.minX - CAM_EDGE, b.maxX + CAM_EDGE], [shoulder.z, back.z, b.minZ - 0.4, b.maxZ + 0.2]]) {
    if (d > 1e-5) boom = Math.min(boom, (hi - o) / d);
    else if (d < -1e-5) boom = Math.min(boom, (lo - o) / d);
  }
  // Floor: stop the boom before it dips under the street.
  if (back.y < -1e-5) boom = Math.min(boom, (0.3 - shoulder.y) / back.y);
  boom = Math.max(0.12, boom);
  // In at once, back out gently.
  camBoom = boom < camBoom ? boom : camBoom + (boom - camBoom) * ease(7, dt);
  camera.position.copy(shoulder).addScaledVector(back, camBoom);
  // Too close to see past him: drop Ghost out of the picture rather than fill it with coat.
  if (ghost) ghost.model.visible = camBoom > 0.85;
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.2);
  }
  camera.lookAt(tmpB.copy(camera.position).add(lookDir));
  camera.updateMatrixWorld();
}

// --- Ray casting -----------------------------------------------------------

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

// Vertical capsule from (x, y0, z) to (x, y1, z).
function rayCapsule(o, d, x, z, y0, y1, r) {
  const bay = y1 - y0;
  const oax = o.x - x, oay = o.y - y0, oaz = o.z - z;
  const baba = bay * bay;
  const bard = bay * d.y;
  const baoa = bay * oay;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0 || Math.abs(a) < 1e-9) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t;
  const cy = y <= 0 ? y0 : y1;
  return raySphere(o, d, { x, y: cy, z }, r);
}

// First thing a ray touches: enemy (head or body), wall, or the street.
// `pad` fattens enemy hit shapes; used for a little bullet magnetism on touch.
function trace(origin, dir, maxDist, pad, out) {
  let best = maxDist;
  out.kind = "none";
  out.enemy = null;
  out.head = false;
  out.normal.copy(dir).negate();
  const wall = rayHit(origin, dir, maxDist, world.colliders);
  if (wall && wall.t < best) {
    best = wall.t;
    out.kind = "wall";
    out.normal.copy(wall.normal);
  }
  if (dir.y < -1e-4) {
    const tg = -origin.y / dir.y;
    if (tg > 0 && tg < best) {
      best = tg;
      out.kind = "ground";
      out.normal.set(0, 1, 0);
    }
  }
  for (const e of enemies) {
    if (e.dead) continue;
    const s = e.scale;
    const th = raySphere(origin, dir, { x: e.pos.x, y: 1.66 * s, z: e.pos.z }, 0.15 * s + pad * 0.6);
    const tb = rayCapsule(origin, dir, e.pos.x, e.pos.z, 0.3 * s, 1.36 * s, 0.27 * s + pad);
    let t = -1;
    let head = false;
    if (th > 0 && (tb < 0 || th <= tb + 0.12)) { t = th; head = true; }
    else if (tb > 0) t = tb;
    if (t > 0 && t < best) {
      best = t;
      out.kind = "enemy";
      out.enemy = e;
      out.head = head;
      out.normal.copy(dir).negate();
    }
  }
  out.t = best;
  out.point.copy(origin).addScaledVector(dir, best);
  return out;
}

// What the crosshair is on right now. The ray starts just past Ghost so the
// camera never targets something sitting between the lens and his back.
function updateAim(spread = 0, out = aimInfo) {
  const dir = camera.getWorldDirection(tmpA);
  if (spread > 0) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const camRight = tmpB.setFromMatrixColumn(camera.matrixWorld, 0);
    dir.addScaledVector(camRight, Math.cos(a) * r);
    dir.addScaledVector(tmpB.setFromMatrixColumn(camera.matrixWorld, 1), Math.sin(a) * r);
    dir.normalize();
  }
  const skip = Math.max(0.5, camera.position.distanceTo(camPivot) * 0.9);
  const origin = camera.position.clone().addScaledVector(dir, skip);
  trace(origin, dir, 70, touch ? 0.1 : 0.03, out);
  out.t += skip;
  return out;
}

// --- Player weapons --------------------------------------------------------

const shotInfo = { point: new THREE.Vector3(), kind: "none", enemy: null, head: false, normal: new THREE.Vector3(), t: 0 };

function tryFire(pressed) {
  if (player.reloadT > 0 || player.fireCd > 0 || player.dodgeT > 0) return;
  if (player.mag <= 0) {
    if (player.reserve > 0) tryReload();
    else if (pressed) { sfx.dry(); setBanner("OUT OF AMMO"); }
    return;
  }
  player.mag -= 1;
  player.fireCd = FIRE_CD;
  player.aimHold = AIM_HOLD;
  player.snapAim = true;

  // Where the round goes: the crosshair, plus spread from movement and from
  // how fast you are pulling the trigger.
  const moveSpread = clamp(player.vel.length() / RUN_SPEED, 0, 1) * SPREAD_MOVE;
  const hit = updateAim(SPREAD_BASE + moveSpread + player.bloom, shotInfo);

  // It leaves from the barrel, so cover in front of the gun still stops it.
  ghost.aimFrame(player.pos, camYaw, hit.point, shotFrame);
  const muzzle = shotFrame.muzzle;
  const dir = tmpA.copy(hit.point).sub(muzzle);
  const span = dir.length();
  dir.normalize();
  let end = hit.point;
  let kind = hit.kind;
  let normal = hit.normal;
  let target = hit.enemy;
  const cover = span > 0.3 ? rayHit(muzzle, dir, span - 0.12, world.colliders) : null;
  if (cover) {
    end = cover.point;
    kind = "wall";
    normal = cover.normal;
    target = null;
  }

  fx.muzzle(muzzle, dir, { light: true });
  fx.tracer(muzzle, end);
  fx.casing(tmpB.copy(muzzle).addScaledVector(dir, -0.16), shotFrame.right, UP);
  sfx.shot();
  if (navigator.vibrate && touch) navigator.vibrate(12);

  if (target) {
    fx.impact(end, normal, "enemy", ENEMY[target.type].glow);
    damageEnemy(target, hit.head ? HEAD_DMG : BODY_DMG, hit.head, end, dir);
  } else if (kind !== "none") {
    fx.impact(end, normal, kind);
    if (span < 30) sfx.ricochet();
  }

  // Kick: the view jumps and settles back, the gun snaps up, the crosshair blooms.
  player.recoilP += RECOIL_PITCH * (0.85 + Math.random() * 0.3);
  player.recoilY += (Math.random() - 0.5) * 0.012;
  player.kick = 1;
  player.bloom = Math.min(SPREAD_MAX, player.bloom + SPREAD_PER_SHOT);
  fovKick = 1.3;
  shake = Math.min(0.05, shake + 0.022);
  if (player.mag === 0 && player.reserve > 0) tryReload();
}

function tryReload() {
  if (player.weapon !== "pistol" || player.reloadT > 0 || player.mag >= MAG || player.reserve <= 0) return;
  player.reloadT = RELOAD_T;
  player.aimHold = 0;
  sfx.reload(RELOAD_T);
}

// --- Boxing ----------------------------------------------------------------

// Where the fist is going: the target's chin, or straight ahead.
function punchPoint(e) {
  if (!e || e.dead) return null;
  const p = new THREE.Vector3(e.pos.x, 1.5 * e.scale, e.pos.z);
  // Stop at the near side of his head, not its centre.
  const back = tmpA.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
  if (back.lengthSq() > 1e-4) p.addScaledVector(back.normalize(), 0.16 * e.scale);
  return p;
}

// Nearest live enemy in front of Ghost that a punch could reach.
function punchTarget(maxDist) {
  const fx_ = Math.sin(camYaw);
  const fz_ = Math.cos(camYaw);
  let best = null;
  let bestD = maxDist;
  for (const e of enemies) {
    if (e.dead || e.riseT > 0) continue;
    const dx = e.pos.x - player.pos.x;
    const dz = e.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.7 && (dx * fx_ + dz * fz_) / d < PUNCH.cone) continue;
    best = e;
    bestD = d;
  }
  return best;
}

function tryPunch() {
  if (player.dodgeT > 0 || player.hp <= 0) return;
  if (player.punch) {
    // Buffer the next one so a quick double tap is always a 1-2.
    if (player.punch.kind === "jab") player.punchQueued = true;
    return;
  }
  startPunch(player.comboT > 0 ? "cross" : "jab");
}

function startPunch(kind) {
  const target = punchTarget(PUNCH.reach + PUNCH.lunge);
  player.punch = { kind, t: 0, hit: false, target };
  player.punchQueued = false;
  player.comboT = 0;
  player.aimHold = 0;
  player.guardT = PUNCH.guard + PUNCH[kind].t;
  if (player.reloadT > 0) { player.reloadT = 0; }       // a punch drops the reload
  if (!target) player.facing = camYaw;
  sfx.melee();
}

function updatePunch(dt) {
  const p = player.punch;
  if (!p) return;
  const spec = PUNCH[p.kind];
  p.t += dt;
  const target = p.target && !p.target.dead ? p.target : null;
  // Step in behind the punch until he is at arm's length.
  if (!p.hit) {
    const dir = target
      ? tmpA.set(target.pos.x - player.pos.x, 0, target.pos.z - player.pos.z)
      : tmpA.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    const d = dir.length();
    dir.normalize();
    const room = target ? d - PUNCH.stand : 0.3;
    if (room > 0) {
      const stepSpeed = (target ? PUNCH.lunge + 0.4 : 0.3) / (spec.t * spec.hit);
      player.pos.addScaledVector(dir, Math.min(room, stepSpeed * dt));
      resolve(player.pos, 0.42, world.colliders);
    }
  }
  if (!p.hit && p.t >= spec.t * spec.hit) {
    p.hit = true;
    const e = target && Math.hypot(target.pos.x - player.pos.x, target.pos.z - player.pos.z) <= PUNCH.reach + 0.15 ? target : punchTarget(PUNCH.reach);
    if (e) {
      const dir = new THREE.Vector3(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z).normalize();
      const at = punchPoint(e) || e.pos.clone().setY(1.5 * e.scale);
      fx.impact(at, dir.clone().negate(), "enemy", ENEMY[e.type].glow);
      damageEnemy(e, spec.dmg, false, at, dir);
      if (!e.dead) {
        e.stagger = Math.max(e.stagger, spec.stagger);
        e.attackT = Math.max(e.attackT, spec.stagger + 0.25);
        e.pos.addScaledVector(dir, spec.push);
        resolve(e.pos, 0.45, world.colliders);
      }
      shake = Math.min(0.12, shake + spec.shake);
      if (p.kind === "cross") fovKick = 1.6;
      if (navigator.vibrate && touch) navigator.vibrate(p.kind === "cross" ? 28 : 12);
    }
  }
  if (p.t >= spec.t) {
    player.punch = null;
    player.guardT = PUNCH.guard;
    if (p.kind === "jab") {
      player.comboT = PUNCH.window;
      if (player.punchQueued) startPunch("cross");
    }
    player.punchQueued = false;
  }
}

// --- Aim lock --------------------------------------------------------------

const lockDir = new THREE.Vector3();
const lockEye = new THREE.Vector3();

// Where the camera will sit for a given yaw and pitch, ignoring walls.
function camEyeFor(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  const dist = lerp(3.3, 2.45, aimAmt);
  const side = lerp(0.72, 0.6, aimAmt);
  out.set(
    player.pos.x - Math.cos(yaw) * side - Math.sin(yaw) * cp * Math.min(dist, camBoom),
    camPivot.y + 0.2 - Math.sin(pitch) * Math.min(dist, camBoom),
    player.pos.z + Math.sin(yaw) * side - Math.cos(yaw) * cp * Math.min(dist, camBoom)
  );
  return out;
}

function lockVisible(e, eye) {
  for (const h of [AIM_LOCK.head, AIM_LOCK.chest]) {
    lockDir.set(e.pos.x - eye.x, h * e.scale - eye.y, e.pos.z - eye.z);
    const d = lockDir.length();
    lockDir.divideScalar(d);
    if (!rayHit(eye, lockDir, d - 0.3, world.colliders)) return true;
  }
  return false;
}

// Angle between the view and an enemy's chest, from where the camera sits.
function lockAngle(e, eye) {
  lockDir.set(e.pos.x - eye.x, AIM_LOCK.chest * e.scale - eye.y, e.pos.z - eye.z).normalize();
  return Math.acos(clamp(lockDir.dot(lookDir), -1, 1));
}

function updateAimLock(dt, look) {
  lockBreakT = Math.max(0, lockBreakT - dt);
  const firing = input.firing();
  const active = aimLockOn && player.hp > 0 && player.weapon === "pistol" && !player.punch && player.reloadT <= 0 &&
    player.dodgeT <= 0 && (firing || player.aimHold > 0);
  if (!active) { lockTarget = null; return; }
  if (Math.hypot(look.dx, look.dy) > AIM_LOCK.breakDrag * Math.max(dt, 1 / 120)) { lockTarget = null; lockBreakT = AIM_LOCK.breakTime; }
  if (lockBreakT > 0) return;

  const eye = camera.position;
  lookDir.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const ok = (e, cone) => e && !e.dead && e.riseT <= 0 && e.pos.distanceTo(player.pos) <= AIM_LOCK.range &&
    lockAngle(e, eye) <= cone && lockVisible(e, eye);
  let fresh = false;
  if (!ok(lockTarget, AIM_LOCK.keep)) {
    lockTarget = null;
    let best = Infinity;
    for (const e of enemies) {
      if (!ok(e, AIM_LOCK.acquire)) continue;
      const score = lockAngle(e, eye) + e.pos.distanceTo(player.pos) * 0.003;
      if (score < best) { best = score; lockTarget = e; }
    }
    fresh = !!lockTarget;
  }
  if (!lockTarget) return;

  // Yaw goes to the target. Pitch is left alone while the crosshair is
  // anywhere between chest and head, so headshots are still yours to take.
  const e = lockTarget;
  const snap = fresh || (firing && !wasFiring);
  const k = snap ? 1 : ease(AIM_LOCK.track, dt);
  for (let i = 0; i < (snap ? 4 : 1); i++) {
    const from = snap ? camEyeFor(camYaw, camPitch, lockEye) : eye;
    const dx = e.pos.x - from.x;
    const dz = e.pos.z - from.z;
    const flat = Math.max(0.5, Math.hypot(dx, dz));
    const yAim = from.y + Math.tan(camPitch) * flat;
    const yWant = clamp(yAim, AIM_LOCK.chest * e.scale, AIM_LOCK.head * e.scale);
    camYaw += wrapPi(Math.atan2(dx, dz) - camYaw) * k;
    camPitch = clamp(camPitch + (Math.atan2(yWant - from.y, flat) - camPitch) * k, PITCH_MIN, PITCH_MAX);
  }
}

function doMelee() {
  if (player.meleeCd > 0 || player.dodgeT > 0 || player.reloadT > 0) return;
  player.meleeCd = MELEE_CD;
  player.meleeT = MELEE_T;
  player.facing = camYaw;
  sfx.melee();
  const forward = tmpA.set(Math.sin(camYaw), 0, Math.cos(camYaw)).clone();
  let landed = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.pos.clone().sub(player.pos);
    d.y = 0;
    const dist = d.length();
    if (dist < 2 && d.normalize().dot(forward) > 0.2) {
      const at = e.pos.clone().setY(1.25 * e.scale);
      fx.impact(at, forward.clone().negate(), "enemy", ENEMY[e.type].glow);
      damageEnemy(e, MELEE_DMG, false, at, forward);
      landed = true;
    }
  }
  if (landed) shake = Math.min(0.08, shake + 0.05);
}

function damageEnemy(e, amount, head, at, dir) {
  if (e.dead) return;
  e.hp -= amount;
  e.hitT = 0.14;
  e.stagger = head ? 0.4 : 0.22;
  e.windup = 0;
  e.attackT = Math.max(e.attackT, 0.35);
  e.passive = false;
  e.alert = 4;
  // Shove them along the shot.
  e.pos.x += dir.x * (head ? 0.16 : 0.1);
  e.pos.z += dir.z * (head ? 0.16 : 0.1);
  resolve(e.pos, 0.45, world.colliders);
  const killed = e.hp <= 0;
  if (!killed) e.rig.react(head);
  floatText(at, String(amount), head ? "crit" : "");
  hitMarker(killed ? "kill" : head ? "crit" : "");
  if (killed) {
    e.dead = true;
    e.deadT = 0;
    e.facing = Math.atan2(-dir.x, -dir.z);
    releaseCover(e);
    e.rig.die(head);
    mission.xp += ENEMY[e.type].xp + (head ? 5 : 0);
    sfx.kill();
    if (Math.random() < 0.55) pickups.push(makePickup(scene, e.pos.clone(), player.reserve < 24 || Math.random() < 0.5 ? "ammo" : "health"));
  } else if (head) {
    sfx.headshot();
  } else {
    sfx.hit();
  }
}

function hurtPlayer(amount, from) {
  player.hp = Math.max(0, player.hp - amount);
  if (from) {
    // Point the damage arc at whoever fired, relative to where the camera faces.
    const rel = wrapPi(Math.atan2(from.x - player.pos.x, from.z - player.pos.z) - camYaw);
    const el = $("hurt-dir");
    el.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
    el.classList.add("on");
    hurtDirT = 0.9;
  }
  player.hurtT = 0.28;
  sfx.hurt();
  shake = Math.min(0.14, shake + 0.09);
  if (navigator.vibrate && touch) navigator.vibrate(30);
}

// --- HUD feedback ----------------------------------------------------------

function hitMarker(kind) {
  const el = $("hitmarker");
  el.className = kind;
  // Restart the CSS animation.
  void el.offsetWidth;
  el.classList.add("show");
  hitMarkT = 0.25;
}

function floatText(pos, text, cls) {
  const el = document.createElement("div");
  el.className = "floater " + cls;
  el.textContent = text;
  $("floaters").appendChild(el);
  floaters.push({ el, pos: pos.clone(), life: 0.7, drift: (Math.random() - 0.5) * 30 });
  if (floaters.length > 10) floaters.shift().el.remove();
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) {
      f.el.remove();
      floaters.splice(i, 1);
      continue;
    }
    const p = tmpA.copy(f.pos).project(camera);
    if (p.z > 1) { f.el.style.opacity = 0; continue; }
    const k = 1 - f.life / 0.7;
    const x = (p.x * 0.5 + 0.5) * window.innerWidth + f.drift * k;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight - 46 * k - 12;
    f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(1.25 - 0.35 * k).toFixed(2)})`;
    f.el.style.opacity = String(Math.min(1, f.life * 3.2));
  }
}

// --- Mission ---------------------------------------------------------------

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
    setTimeout(() => { if (mission.phase === "activating") end(true); }, 1200);
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
      if (p.type === "health" && player.hp >= 100) continue;
      if (p.type === "ammo" && player.reserve >= 90) continue;
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
  mission.ambushFight = 0;
}

// --- Enemies ---------------------------------------------------------------

function makeEnemy(type) {
  const spec = ENEMY[type];
  const rig = new Rig(chars.crew, {
    height: 1.82 * spec.scale, weapon: "rifle", gun: spec.gun, tint: spec.tint,
    glow: spec.glow, glowPower: 0.55, armband: spec.glow, bulk: spec.bulk
  });
  scene.add(rig.group);
  return {
    type,
    role: spec.role,
    rig,
    scale: spec.scale,
    hp: spec.hp,
    maxHp: spec.hp,
    speed: spec.speed,
    dmg: spec.dmg,
    range: spec.range,
    hold: spec.hold,
    cd: spec.cd,
    ammo: spec.mag,
    burstLeft: 0,
    burstT: 0,
    reloadT: 0,
    attackT: 0.8 + Math.random() * 0.8,
    windup: 0,
    aimHold: 0,
    kick: 0,
    hitT: 0,
    stagger: 0,
    alert: 0,
    seen: false,
    cover: null,
    coverT: 0,
    flankSide: Math.random() < 0.5 ? -1 : 1,
    flankT: 1.5 + Math.random() * 2,
    lastSeen: new THREE.Vector3(),
    dead: false,
    deadT: 0,
    passive: false,
    ambush: false,
    riseT: 0,
    facing: 0,
    curSpeed: 0,
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeT: 1 + Math.random() * 2,
    pos: new THREE.Vector3()
  };
}

function removeEnemy(e) {
  releaseCover(e);
  e.rig.dispose();
}

function spawnEnemy(type, at = null) {
  const e = makeEnemy(type);
  if (at) {
    e.pos.copy(at);
  } else {
    // Come in from somewhere the player is not standing.
    const far = SPAWN_SPOTS.filter((s) => s.distanceTo(player.pos) > 13);
    const pool = far.length ? far : SPAWN_SPOTS;
    e.pos.copy(pool[Math.floor(Math.random() * pool.length)]);
    e.pos.x += (Math.random() - 0.5) * 2.4;
    e.pos.z += (Math.random() - 0.5) * 2.4;
    resolve(e.pos, 0.5, world.colliders);
    mission.waveLive = true;
  }
  e.facing = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  e.lastSeen.copy(player.pos);
  enemies.push(e);
  return e;
}

// --- Ambushes --------------------------------------------------------------

// Where an ambusher appears. Either a cover spot whose barricade or dumpster
// sits between it and Ghost (they stand up from behind it), or open ground
// outside the camera's view.
function ambushSpot(taken) {
  const inRange = (p) => {
    const d = p.distanceTo(player.pos);
    return d >= AMBUSH.near && d <= AMBUSH.far && taken.every((t) => t.distanceTo(p) > 1.6);
  };
  const cover = coverPoints.filter((c) => (!c.owner || c.owner.dead) && inRange(c.pos) && covers(c, player.pos));
  const b = world.layout.bounds;
  const open = [];
  for (let i = 0; i < 30 && open.length < 4; i++) {
    const p = new THREE.Vector3(lerp(b.minX + 1, b.maxX - 1, Math.random()), 0, lerp(b.minZ + 1, b.maxZ - 1, Math.random()));
    if (!inRange(p)) continue;
    const q = p.clone();
    resolve(q, 0.5, world.colliders);
    if (q.distanceTo(p) > 0.05) continue;
    const dx = p.x - camera.position.x;
    const dz = p.z - camera.position.z;
    const facing = (dx * lookDir.x + dz * lookDir.z) / Math.max(0.001, Math.hypot(dx, dz));
    if (facing < 0.2) open.push(p);
  }
  const useCover = cover.length && (!open.length || Math.random() < 0.6);
  if (useCover) return { pos: cover[Math.floor(Math.random() * cover.length)].pos.clone(), rise: true };
  if (open.length) return { pos: open[Math.floor(Math.random() * open.length)], rise: false };
  return null;
}

function ambushType() {
  const late = mission.wavesDone > 0 || mission.phase === "wave" || mission.phase === "tower";
  const r = Math.random();
  if (late) return r < 0.4 ? "patrol" : r < 0.82 ? "hunter" : "enforcer";
  return r < 0.7 ? "patrol" : "hunter";
}

function spawnAmbush(count) {
  const taken = [];
  for (let i = 0; i < count; i++) {
    const spot = ambushSpot(taken);
    if (!spot) break;
    const e = spawnEnemy(ambushType(), spot.pos);
    e.ambush = true;
    if (spot.rise) { e.riseT = AMBUSH.rise; e.pos.y = -1; }
    e.attackT = Math.max(e.attackT, 1.1);
    taken.push(spot.pos);
  }
  if (!taken.length) return 0;
  mission.ambushes += taken.length;
  setBanner("AMBUSH");
  sfx.wave();
  return taken.length;
}

function updateAmbush(dt) {
  if (player.hp <= 0 || mission.phase === "activating") return;
  mission.ambushT -= dt;
  if (mission.ambushT > 0) return;
  const live = enemies.filter((e) => !e.dead).length + mission.queue.length;
  const fight = mission.phase === "patrol" || mission.phase === "wave";
  // In a fight they reinforce it, a couple at most, so the fight still ends.
  const room = fight
    ? live > 0 && live < AMBUSH.maxAlive && mission.ambushFight < AMBUSH.perFight
    : live < AMBUSH.quiet;
  if (!room) { mission.ambushT = 2; return; }
  let count = Math.random() < AMBUSH.pair ? 2 : 1;
  if (fight) count = Math.min(count, AMBUSH.perFight - mission.ambushFight, AMBUSH.maxAlive - live);
  const n = spawnAmbush(count);
  if (fight) mission.ambushFight += n;
  mission.ambushT = n ? lerp(AMBUSH.gap[0], AMBUSH.gap[1], Math.random()) : 3;
}

// Cover: standing spots beside every waist-high object in the street
// (barricades, dumpsters). A spot counts as cover when its object sits
// between it and the player.
function buildCover() {
  coverPoints = [];
  const probe = new THREE.Vector3();
  for (const c of world.colliders) {
    const h = (c.maxY ?? 0) - (c.minY ?? 0);
    if (h < 0.8 || h > 1.6) continue;
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const off = 0.7;
    const spots = [[c.minX - off, cz], [c.maxX + off, cz], [cx, c.minZ - off], [cx, c.maxZ + off]];
    for (const [x, z] of spots) {
      probe.set(x, 0, z);
      resolve(probe, 0.45, world.colliders);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.08) continue;
      coverPoints.push({ pos: new THREE.Vector3(x, 0, z), collider: c, owner: null });
    }
  }
}

function covers(point, target) {
  return !segmentClear(point.pos, target, [point.collider], 0.02);
}

function releaseCover(e) {
  if (e.cover && e.cover.owner === e) e.cover.owner = null;
  e.cover = null;
}

function pickCover(e) {
  let best = null;
  let bestScore = Infinity;
  for (const p of coverPoints) {
    if (p.owner && p.owner !== e && !p.owner.dead) continue;
    if (!covers(p, player.pos)) continue;
    const dPlayer = p.pos.distanceTo(player.pos);
    if (dPlayer < 4.5 || dPlayer > e.range - 0.5) continue;
    const dSelf = p.pos.distanceTo(e.pos);
    if (dSelf > 16) continue;
    const score = dSelf + Math.abs(dPlayer - e.hold) * 0.6;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function callout(e, text) {
  if (calloutT > 0) return;
  calloutT = 1.4;
  floatText(e.pos.clone().setY(2.15 * e.scale), text, "callout");
}

// Walk towards `goal`, sidestepping whatever is in the way.
function steer(e, goal, speed, dt) {
  const dir = tmpB.copy(goal).sub(e.pos);
  dir.y = 0;
  const len = dir.length();
  if (len < 0.2) return null;
  dir.divideScalar(len);
  if (blocked(e.pos, dir, 1.2, 0.45, world.colliders)) {
    const left = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(e.strafe);
    if (!blocked(e.pos, left, 1.2, 0.45, world.colliders)) dir.copy(left);
    else dir.copy(left.multiplyScalar(-1));
  }
  e.pos.addScaledVector(dir, Math.min(speed * dt, len));
  return dir.clone();
}

function updateEnemies(dt) {
  updateAmbush(dt);
  while (mission.queue.length && enemies.filter((e) => !e.dead).length < 5) spawnEnemy(mission.queue.shift());
  calloutT = Math.max(0, calloutT - dt);

  const chest = new THREE.Vector3(player.pos.x, 1.3, player.pos.z);
  const playerSpeed = player.vel.length();
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.hitT = Math.max(0, e.hitT - dt);
    e.kick *= Math.exp(-dt * 14);
    e.rig.flash(e.hitT > 0 ? e.hitT / 0.14 : 0);
    if (e.riseT > 0) {
      // Standing up from behind cover.
      e.riseT = Math.max(0, e.riseT - dt);
      const k = e.riseT / AMBUSH.rise;
      e.pos.y = -k * k;
    }

    if (e.dead) {
      e.deadT += dt;
      if (e.deadT > 4.2) e.pos.y -= dt * 0.5;
      if (e.deadT > 6) {
        removeEnemy(e);
        enemies.splice(i, 1);
        continue;
      }
      e.rig.update(dt, { pos: e.pos, facing: e.facing, speed: 0, pose: "dead", poseT: e.deadT / 0.5 });
      continue;
    }

    e.attackT -= dt;
    e.stagger = Math.max(0, e.stagger - dt);
    e.aimHold = Math.max(0, e.aimHold - dt);
    e.alert = Math.max(0, e.alert - dt);
    const to = tmpA.copy(player.pos).sub(e.pos);
    to.y = 0;
    const dist = to.length();
    to.divideScalar(Math.max(dist, 0.001));
    const los = !e.passive && player.hp > 0 && segmentClear(e.pos, player.pos, world.colliders, 0.15);
    const sees = los && (dist < 22 || e.alert > 0);
    if (sees) {
      e.alert = 3;
      e.lastSeen.copy(player.pos);
      if (!e.seen) { e.seen = true; callout(e, "CONTACT"); }
    }
    const firing = e.windup > 0 || e.burstLeft > 0;
    const reloading = e.reloadT > 0;
    const before = e.pos.clone();
    let moved = null;
    let speed = e.speed * (reloading ? 0.7 : 1);

    if (e.passive || e.stagger > 0) {
      // Standing still: idle, or reeling from a hit.
    } else if (!sees) {
      // Lost sight: go to where the player was last seen.
      releaseCover(e);
      moved = steer(e, e.alert > 0 ? e.lastSeen : player.pos, speed * 0.8, dt);
    } else if (e.role === "hold") {
      e.coverT -= dt;
      if (e.coverT <= 0 || (e.cover && !covers(e.cover, player.pos))) {
        e.coverT = 0.8;
        const next = pickCover(e);
        if (next !== e.cover) {
          releaseCover(e);
          if (next) { next.owner = e; e.cover = next; }
        }
      }
      if (e.cover) {
        // Get there even while shooting is pending; hold still once in place.
        if (!firing || e.pos.distanceTo(e.cover.pos) > 1.2) moved = steer(e, e.cover.pos, speed, dt);
      } else if (!firing) {
        if (dist > e.hold) moved = steer(e, player.pos, speed, dt);
        else if (dist < e.range) {
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 1.2 + Math.random() * 2; }
          const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(e.strafe);
          if (blocked(e.pos, side, 1, 0.45, world.colliders)) e.strafe *= -1;
          else { e.pos.addScaledVector(side, speed * 0.4 * dt); moved = side; }
        }
      }
    } else if (e.role === "flank") {
      // Circle to the player's side, swapping sides every few seconds.
      e.flankT -= dt;
      if (e.flankT <= 0) {
        e.flankSide *= -1;
        e.flankT = 2.5 + Math.random() * 2;
        callout(e, "FLANKING");
      }
      const around = new THREE.Vector3(-to.x, 0, -to.z).applyAxisAngle(UP, e.flankSide * 1.15).multiplyScalar(e.hold);
      const goal = around.add(player.pos);
      goal.x = clamp(goal.x, -8.8, 8.8);
      moved = steer(e, goal, speed * (firing ? 0.55 : 1), dt);
    } else if (!firing && dist > e.hold) {
      moved = steer(e, player.pos, speed, dt);
    }

    // Keep them off each other.
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const dx = e.pos.x - o.pos.x;
      const dz = e.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.1 && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const push = (1.05 - d) * 0.5;
        e.pos.x += (dx / d) * push;
        e.pos.z += (dz / d) * push;
      }
    }
    resolve(e.pos, 0.45, world.colliders);
    e.curSpeed += (before.distanceTo(e.pos) / Math.max(dt, 1e-4) - e.curSpeed) * ease(12, dt);
    const faceWant = sees ? Math.atan2(to.x, to.z) : moved ? Math.atan2(moved.x, moved.z) : e.facing;
    e.facing += wrapPi(faceWant - e.facing) * ease(9, dt);

    // Attack: raise and steady, then a burst. Every round can miss, and moving,
    // sprinting or dodging makes you harder to hit. Empty mags force a reload.
    const inRange = sees && dist < e.range;
    if (inRange && !reloading) e.aimHold = 0.5;
    if (reloading) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) e.ammo = ENEMY[e.type].mag;
    } else if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        if (inRange) enemyFire(e, chest, dist, playerSpeed);
        e.ammo -= 1;
        e.burstLeft -= 1;
        e.burstT = ENEMY[e.type].burstGap;
        if (e.burstLeft === 0 || !inRange) {
          e.burstLeft = 0;
          e.attackT = e.cd * (0.85 + Math.random() * 0.3);
        }
        if (e.ammo <= 0) {
          e.burstLeft = 0;
          e.reloadT = ENEMY_RELOAD;
          e.aimHold = 0;
          sfx.enemyReload(dist);
          callout(e, "RELOADING");
        }
      }
    } else if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) {
        if (inRange) { e.burstLeft = Math.min(ENEMY[e.type].burst, e.ammo); e.burstT = 0; }
        else e.attackT = 0.3;
      }
    } else if (inRange && e.attackT <= 0 && e.stagger <= 0) {
      e.windup = WINDUP;
    }

    e.rig.update(dt, {
      pos: e.pos,
      facing: e.facing,
      speed: e.curSpeed,
      aim: e.aimHold > 0,
      aimPoint: chest,
      kick: e.kick,
      pose: reloading ? "reload" : "none",
      poseT: reloading ? 1 - e.reloadT / ENEMY_RELOAD : 0
    });
  }
}

function enemyFire(e, chest, dist, playerSpeed) {
  const muzzle = e.rig.muzzle;
  const from = muzzle.clone();
  if (!segmentClear(from, chest, world.colliders, 0.05)) return;
  let chance = 0.82 - dist * 0.022;
  if (playerSpeed > 5) chance -= 0.3;
  else if (playerSpeed > 1.5) chance -= 0.14;
  if (ENEMY[e.type].burst > 1) chance -= 0.12;
  chance = clamp(chance, 0.1, 0.9);
  const hit = player.iframes <= 0 && Math.random() < chance;
  const dir = chest.clone().sub(from).normalize();
  let end;
  if (hit) {
    end = chest.clone();
  } else {
    // A miss goes past: offset sideways and up or down, then keep going.
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6));
    const aim = chest.clone().add(side);
    aim.y += (Math.random() - 0.4) * 0.7;
    const d2 = aim.sub(from).normalize();
    const wall = rayHit(from, d2, 60, world.colliders);
    const ground = d2.y < -1e-3 ? -from.y / d2.y : Infinity;
    const t = Math.min(wall ? wall.t : 60, ground);
    end = from.clone().addScaledVector(d2, t);
    if (t < 60) fx.impact(end, wall && wall.t <= ground ? wall.normal : UP, wall && wall.t <= ground ? "wall" : "ground");
    sfx.whiz();
  }
  e.kick = 1;
  fx.muzzle(from, dir, { scale: ENEMY[e.type].gun === "heavy" ? 1.6 : 1.2 });
  fx.tracer(from, end, ENEMY[e.type].glow);
  sfx.enemyShot(dist);
  if (hit) hurtPlayer(e.dmg, e.pos);
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
}

// --- HUD -------------------------------------------------------------------

function syncHud(dt = 0, speed = 0) {
  $("hp-fill").style.width = player.hp + "%";
  $("hp-text").textContent = Math.ceil(player.hp) + " HP";
  $("weapon-name").textContent = player.weapon === "knife" ? "KNIFE" : "PISTOL";
  const ammo = $("ammo-text");
  ammo.textContent = player.weapon === "knife" ? "READY" : player.reloadT > 0 ? "RELOADING" : `${player.mag} / ${player.reserve}`;
  ammo.classList.toggle("low", player.weapon === "pistol" && player.mag <= 3 && player.reloadT <= 0);
  $("objective").textContent = mission.objective;
  $("wave-pill").textContent = mission.wave ? `WAVE ${mission.wave} / 3` : "WAVE — / 3";
  $("cell-pill").textContent = `CELLS ${mission.cells} / 3`;
  $("xp-pill").textContent = `XP ${mission.xp}`;
  $("btn-use").classList.toggle("ready", !!interact);

  // Crosshair: opens with spread, turns red on a target.
  const ret = $("reticle");
  const spread = SPREAD_BASE + clamp(speed / RUN_SPEED, 0, 1) * SPREAD_MOVE + player.bloom;
  const pxPerRad = window.innerHeight / (camera.fov * Math.PI / 180);
  ret.style.setProperty("--gap", (5 + spread * pxPerRad).toFixed(1) + "px");
  ret.classList.toggle("on-target", !!aimInfo.enemy);
  const lock = $("lock");
  if (lockTarget && !lockTarget.dead) {
    const lp = tmpA.set(lockTarget.pos.x, 1.3 * lockTarget.scale, lockTarget.pos.z).project(camera);
    lock.hidden = lp.z > 1;
    lock.style.transform = `translate(${((lp.x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px, ${((-lp.y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px)`;
  } else {
    lock.hidden = true;
  }
  const meleeLabel = player.weapon === "knife" ? "SLASH" : player.comboT > 0 || (player.punch && player.punch.kind === "jab") ? "CROSS" : "PUNCH";
  if ($("btn-melee").textContent !== meleeLabel) $("btn-melee").textContent = meleeLabel;
  $("btn-melee").classList.toggle("ready", player.comboT > 0);
  ret.classList.toggle("off", player.weapon === "knife" || player.reloadT > 0);
  if (hitMarkT > 0) {
    hitMarkT -= dt;
    if (hitMarkT <= 0) $("hitmarker").classList.remove("show");
  }

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
  marker.hidden = false;
  marker.style.left = clamp(behind ? window.innerWidth - x : x, m, window.innerWidth - m) + "px";
  marker.style.top = clamp(behind ? window.innerHeight - y : y, m, window.innerHeight - m) + "px";
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
    ? `Caldosta is back online. XP ${mission.xp}. No checkpoints — restart replays the full mission.`
    : "The Blackout Crew holds Sector 9. Restart resets health, ammo, cells, waves, and inputs.";
  if (win) sfx.win(); else sfx.lose();
  document.exitPointerLock?.();
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Browser bars sliding in and out can leave the page scrolled. Pin it.
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
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
    ambushes: mission?.ambushes,
    xp: mission?.xp,
    enemies: enemies?.filter((e) => !e.dead).length,
    pos: player ? { x: player.pos.x, z: player.pos.z } : null
  };
}

boot();
