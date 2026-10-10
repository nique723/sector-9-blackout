# Sector 9: City Under Siege — Phase 1

Playable mobile-first third-person mission. Mission 01: Blackout. Ghost collects three power cells, clears a patrol, survives three waves, and activates the communications tower.

Static HTML, CSS, and JavaScript. Three.js r170 is loaded from jsDelivr. No build step.

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in landscape. Tap **Start Mission** (that gesture unlocks audio).

Desktop test controls: click the view to capture the mouse, WASD move, mouse aim, left click fire (hold to keep firing), R reload, Shift sprint, Space dodge, E use, Q melee, F or 1 weapon swap, Esc pause.

## Phone / tablet

Serve the folder over HTTPS or localhost and open it in Safari or Chrome. Landscape only. Portrait shows a rotate prompt and pauses. The page does not force orientation.

## Deploy

This folder is a static site. On Vercel, set the framework to Other and the output directory to the project root. `vercel.json` is included.

## Characters

Ghost and the enemies are rigged, skinned GLB models with motion-captured idle, walk and run clips (`js/character.js`). The upper body is procedural: the pistol is placed on the line from the barrel to the crosshair and both arms are solved onto it, so the gun, the tracer and the crosshair always agree. Reload, melee, dodge and death are procedural poses, not clips.

**Both models are stand-ins.** `assets/characters/ghost.glb` is the three.js sample soldier (recoloured black, with coat tails added in code) and `assets/characters/enemy.glb` is the three.js sample mannequin. Neither is the Ghost in `assets/ghost-ref.png`.

To use the real Ghost: generate a 3D model from the reference art, rig it with a Mixamo-style skeleton, export one GLB containing clips named with "idle", "walk" and "run", and save it over `assets/characters/ghost.glb`. If it faces the wrong way, flip `faces` at the top of `js/character.js`. Remove `mono` and `coat` from the `new Rig(chars.ghost, ...)` call in `js/game.js` once the model carries its own colours and coat.

## Gun feel

All tuning values are constants at the top of `js/game.js`: fire rate, damage, headshot damage, spread, recoil, movement speeds, aim field of view, and the enemy table. Effects are in `js/fx.js` (muzzle flash, tracers, sparks, bullet holes, casings) and sounds are synthesised in `js/audio.js`.

Shots are hitscan. The crosshair decides what is hit (head or body), the round then travels from the barrel, so cover in front of the gun still blocks it. On touch devices the look stick slows slightly while the crosshair is on an enemy.

## Debug

Add `#test` to the URL for `window.S9.debug` (teleport, spawn, step, free camera).

## Checkpoints

Not included. Restart resets health, ammunition, pickups, enemies, waves, mission state, and held inputs.

## Dependencies

- Browser with WebGL and ES modules
- `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`
- `three/addons` GLTFLoader and SkeletonUtils from the same CDN version
- `assets/characters/ghost.glb` and `assets/characters/enemy.glb`
