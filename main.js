import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('canvas'),
  alpha: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(light);

const loader = new GLTFLoader();
loader.load('object001.glb', function (gltf) {
  const model = gltf.scene;
  scene.add(model);
  model.rotation.y = Math.PI;
  camera.position.z = 2;

  function animate() {
    requestAnimationFrame(animate);
    model.rotation.y += 0.005;
    renderer.render(scene, camera);
  }

  animate();
});
