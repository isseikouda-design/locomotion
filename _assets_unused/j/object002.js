// HTML: <canvas id="canvas"></canvas>

import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { addCommonLights } from '../../lights.js'; 
import { RoomEnvironment } from 'https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';


// 既存の import 群、そのまま

const canvas = document.getElementById('canvas'); // ← 追加
const scene = new THREE.Scene();
addCommonLights(scene);

// renderer を canvas に紐づけ
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.06).texture;

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.5;

// ★ ここが重要：canvas（= viewer内）の実サイズで合わせる
function resizeToCanvas() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
    renderer.setSize(w, h, false);   // 第3引数falseでstyleを書き換えない
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// 初期呼び出し & 監視
resizeToCanvas();
window.addEventListener('resize', resizeToCanvas);
new ResizeObserver(resizeToCanvas).observe(canvas);

// モデル読込
const loader = new GLTFLoader();
loader.load('object002_2.glb', (gltf) => {
  const model = gltf.scene;
  scene.add(model);

  // センタリング
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  model.position.sub(center);

  model.scale.set(3, 3, 3);

  // カメラ距離
 // --- 初期ビュー（3/4 斜め）を作る ---
 const distance = Math.max(2, size * 1.5);    // 見やすい距離
 controls.target.set(0, 0, 0);                 // 注視点はモデル中心

 // 角度設定（度数で分かりやすく）
 const AZIMUTH_DEG = 100;   // 左右（+で右前方、-で左前方）
 const POLAR_DEG   = 20;   // 上下（90で水平、60ならやや見下ろし）

 // 球座標に変換してカメラ配置
 const sph = new THREE.Spherical(
  distance,
  THREE.MathUtils.degToRad(POLAR_DEG),
  THREE.MathUtils.degToRad(AZIMUTH_DEG)
 );
 camera.position.setFromSpherical(sph);
 camera.lookAt(controls.target);
 controls.update();


  // 最終的に一度サイズ調整を同期
  resizeToCanvas();
  animate();
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
