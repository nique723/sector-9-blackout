# Sector 9: Caldosta Under Siege — Phase 1

Playable mobile-first third-person mission set in Sector 9 of the city of Caldosta. Mission 01: Blackout. The Blackout Crew cut the power; Ghost collects three power cells, clears a patrol, survives three waves, and activates the communications tower.

Static HTML, CSS, and JavaScript. Three.js r170 is loaded from jsDelivr. No build step.

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in landscape. Tap **Start Mission** (that gesture unlocks audio).

Desktop test controls: click the view to capture the mouse, WASD move, mouse aim, left click fire (hold to keep firing), R reload, Shift sprint, Space dodge, E use, Q punch (tap twice for the 1-2), F or 1 weapon swap, Esc pause.

## Phone / tablet

Serve the folder over HTTPS or localhost and open it in Safari or Chrome. Landscape only. Portrait shows a rotate prompt and pauses. On phones that allow it (Android Chrome), Start Mission goes full screen and holds landscape. iPhone Safari does not allow that; adding the page to the Home Screen is what removes its browser bars and edge-swipe there. During play the page blocks the browser's own touch gestures (edge swipe, pull, pinch, double-tap zoom, long-press menu), and menus scroll if they are taller than the screen.

## Deploy

This folder is a static site. On Vercel, set the framework to Other and the output directory to the project root. `vercel.json` is included.

## Characters

Ghost and the enemies are rigged, skinned GLB models with motion-captured idle, walk and run clips (`js/character.js`). The upper body is procedural: the pistol is placed on the line from the barrel to the crosshair and both arms are solved onto it, so the gun, the tracer and the crosshair always agree. Reload, the knife slash, the jab, the cross, the boxing guard, dodge and death are procedural poses, not clips.

**Ghost is the real model.** `assets/characters/ghost.glb` is the Meshy "Crimson Sentinel" mesh (26k triangles, coat and colours baked in) bound to the Mixamo skeleton, so it plays the same idle, walk and run clips as the crew. Textures are packed inside the file (2K colour, 1K normal and roughness/metal). The four fingers are skinned as one block to the Middle1-3 bones (`fist: true` in `MODELS`), so the rig closes the hands itself: a grip on the pistol, fists to box, loose otherwise. The thumb is not rigged. The coat is skinned to the legs rather than simulated.

**The Blackout Crew is still a stand-in.** `assets/characters/crew.glb` is the three.js sample soldier, recoloured per type with glowing armbands and visors.

Model files are mapped in `MODELS` at the top of `js/character.js`. To use another model: save a rigged GLB in `assets/characters/`, point the entry at it, and include clips named with "idle", "walk" and "run". Optional clips named "hit", "death" (one with "head" in the name is used for headshot kills) and "reload" replace the procedural versions automatically. If a model faces the wrong way, flip its `faces` value. `headFrac` is the head bone's height as a fraction of the model's full height (default 0.87); set it if a model comes out too short or too tall.

## Enemies

The Blackout Crew, tuned in the `ENEMY` table in `js/game.js`:

- **Patrol** (red): rifle, single shots. Takes cover beside barricades and dumpsters that sit between it and the player.
- **Hunter** (cyan): SMG, 3-round bursts on the move. Circles to the player's side and switches sides.
- **Enforcer** (orange): heavy gun, 4-round bursts. Walks the player down.

**Ambushes.** On top of the patrol and the three waves, stragglers pop up at random through the whole mission: one or two at a time, either standing up from behind a barricade or dumpster that sits between them and Ghost, or stepping in from outside the camera's view. During a patrol or wave at most two extra join, so the fight still ends. Timing, group size and distances are in the `AMBUSH` table in `js/game.js`.

All of them raise and steady before firing, every round can miss, and an empty magazine forces a reload. They call out contact, flanking and reloads.

## Boxing

PUNCH throws the jab with the lead (left) hand. Press again during the jab or within about half a second and the rear (right) hand throws the cross, with the shoulders turning into it. Ghost steps in on the nearest enemy in front of him, the pistol is holstered while the fists are up, and the hands stay in guard for a moment afterwards. Jab 16, cross 32: a clean 1-2 drops a Patrol. The cross also staggers and shoves. Values are in the `PUNCH` table in `js/game.js`. With the knife equipped (SWAP) the same button slashes instead.

## Aim lock

While FIRE is held, the view snaps to the target nearest the crosshair and follows him as he moves. The lock only steers left and right once the crosshair is between chest and head, so headshots are still aimed by hand. A fast drag breaks the lock, and the next press picks up whoever is then nearest the crosshair. It needs line of sight. It can be switched off in the pause menu. Values are in the `AIM_LOCK` table in `js/game.js`.

## Camera

The camera stays inside the street. A wall beside Ghost slides the camera in behind him, a wall or the street's end behind him pulls it closer, and when it is too close to see past him Ghost is hidden rather than filling the screen.

## Gun feel

All tuning values are constants at the top of `js/game.js`: fire rate, damage, headshot damage, spread, recoil, movement speeds, aim field of view, and the enemy table. Effects are in `js/fx.js` (muzzle flash, tracers, sparks, bullet holes, casings) and sounds are synthesised in `js/audio.js`.

Shots are hitscan. The crosshair decides what is hit (head or body), the round then travels from the barrel, so cover in front of the gun still blocks it. On touch devices the look stick slows slightly while the crosshair is on an enemy.

## Debug

Add `#test` to the URL for `window.S9.debug` (teleport, spawn, ambush, step, free camera).

## Checkpoints

Not included. Restart resets health, ammunition, pickups, enemies, waves, mission state, and held inputs.

## Dependencies

- Browser with WebGL and ES modules
- `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`
- `three/addons` GLTFLoader and SkeletonUtils from the same CDN version
- `assets/characters/ghost.glb` and `assets/characters/crew.glb`
