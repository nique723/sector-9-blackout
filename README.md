# Sector 9: Caldosta Under Siege — Phase 1

Playable mobile-first third-person mission set in Sector 9 of the city of Caldosta. Mission 01: Blackout. The Blackout Crew cut the power; Ghost collects three power cells, clears a patrol, survives three waves, and activates the communications tower.

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

**Both models are stand-ins.** `assets/characters/ghost.glb` is the three.js sample soldier. Ghost uses it recoloured black with coat tails added in code; the Blackout Crew uses the same file in its own colours, with glowing armbands and visors per type. Neither is the Ghost in `assets/ghost-ref.png`.

Model files are mapped in `MODELS` at the top of `js/character.js`. To use real models: save a rigged GLB in `assets/characters/`, point the entry at it, and include clips named with "idle", "walk" and "run". Optional clips named "hit", "death" (one with "head" in the name is used for headshot kills) and "reload" replace the procedural versions automatically. If a model faces the wrong way, flip its `faces` value. Remove `mono` and `coat` from the `new Rig(chars.ghost, ...)` call in `js/game.js` once Ghost's model carries its own colours and coat.

## Enemies

The Blackout Crew, tuned in the `ENEMY` table in `js/game.js`:

- **Patrol** (red): rifle, single shots. Takes cover beside barricades and dumpsters that sit between it and the player.
- **Hunter** (cyan): SMG, 3-round bursts on the move. Circles to the player's side and switches sides.
- **Enforcer** (orange): heavy gun, 4-round bursts. Walks the player down.

All of them raise and steady before firing, every round can miss, and an empty magazine forces a reload. They call out contact, flanking and reloads.

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
