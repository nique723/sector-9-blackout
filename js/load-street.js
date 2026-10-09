// Use the same Three.js version for core and addons. For this game: 0.170.0.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadSector9Street(scene, base = './assets/sector9-street/') {
  const loader = new GLTFLoader();
  const [gltf, response] = await Promise.all([
    loader.loadAsync(base + 'sector9-blackout-street.glb'),
    fetch(base + 'street-layout.json')
  ]);
  if (!response.ok) throw new Error('Street layout failed: ' + response.status);
  const layout = await response.json();
  const group = new THREE.Group();
  group.name = 'Sector9BlackoutDistrict';
  group.add(gltf.scene);
  gltf.scene.traverse(o => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; }
  });
  scene.add(group);
  // Lighting is separate from the GLB; these are a readable baseline, not a device benchmark.
  const hemi = new THREE.HemisphereLight(0xc2d9ef, 0x666052, 1.8);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0xc2deff, 2.5);
  key.position.set(-20,40,20); group.add(key);
  const fill = new THREE.DirectionalLight(0xffc588, 1.8);
  fill.position.set(8,15,32); group.add(fill);
  // Limit actual point lights to four; all eight fixtures remain visible.
  const practicals = [2,3,6,7].map(i => {
    const spec = layout.lights[i];
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
    light.position.fromArray(spec.position); group.add(light); return light;
  });
  scene.background = new THREE.Color(0x263c50);
  scene.fog = new THREE.Fog(0x263c50, 50, 115);
  return { group, colliders: layout.colliders, layout, lights: practicals,
    dispose() {
      scene.remove(group);
      const geos = new Set(), mats = new Set(), textures = new Set();
      group.traverse(o => {
        if (o.geometry) geos.add(o.geometry);
        for (const mat of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
          mats.add(mat);
          for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
        }
      });
      textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose()); geos.forEach(g => g.dispose());
    }
  };
}
