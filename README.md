# Sector 9: City Under Siege — Phase 1

Playable mobile-first third-person mission. Mission 01: Blackout. Ghost collects three power cells, clears a patrol, survives three waves, and activates the communications tower.

Static HTML, CSS, and JavaScript. Three.js r170 is loaded from jsDelivr. No build step.

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in landscape. Tap **Start Mission** (that gesture unlocks audio).

Desktop test controls: click the view to capture the mouse, WASD move, mouse aim, left click fire, R reload, Shift sprint, Space dodge, E use, Q melee, F or 1 weapon swap, Esc pause.

## Phone / tablet

Serve the folder over HTTPS or localhost and open it in Safari or Chrome. Landscape only. Portrait shows a rotate prompt and pauses. The page does not force orientation.

## Deploy

This folder is a static site. On Vercel, set the framework to Other and the output directory to the project root. `vercel.json` is included.

## Character limitation

Ghost is an articulated primitive rig (hips, torso, coat with red lining, head, arms, legs, pistol, knife) with procedural states for idle, move, sprint, aim, shoot, reload, melee, dodge, and defeat. A chroma-keyed crop of the reference PNG is applied to the head when `assets/ghost-ref.png` is present. This is not a scanned or professionally rigged model, and it is not a flat billboard.

## Checkpoints

Not included. Restart resets health, ammunition, pickups, enemies, waves, mission state, and held inputs.

## Dependencies

- Browser with WebGL and ES modules
- `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`
- Optional local file `assets/ghost-ref.png` for the face crop
