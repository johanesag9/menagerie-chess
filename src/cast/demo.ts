import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSlotMaterial } from './material';
import { instantiate } from './kit';
import { getTemplate, KINDS } from './roster';
import { naturalTable } from './palettes';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f4e9d8');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 3, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
scene.add(sun, new THREE.HemisphereLight('#cfe8ff', '#e0c9a0', 0.8));
const floor = new THREE.Mesh(new THREE.CircleGeometry(20, 48), new THREE.MeshStandardMaterial({ color: '#e8d6b8' }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

(['land', 'sea'] as const).forEach((side, row) => {
  KINDS.forEach((kind, i) => {
    const t = getTemplate(side, kind);
    const { mesh } = instantiate(t.rig, createSlotMaterial(naturalTable(t.def)));
    mesh.position.set((i - 2.5) * 1.1, 0, row === 0 ? 0.8 : -0.8);
    scene.add(mesh);
  });
});
const q = new URLSearchParams(location.search);
if (q.get('cam')) { const [x, y, z, tx, ty, tz] = q.get('cam')!.split(',').map(Number); camera.position.set(x, y, z); controls.target.set(tx, ty, tz); }
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
(window as any).__cam = camera; (window as any).__ctl = controls;
