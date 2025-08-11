import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { addCommonLights } from './lights.js'; 

const scene = new THREE.Scene();
addCommonLights(scene);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('canvas-home'),
  alpha: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // なめらかに
controls.dampingFactor = 0.05;
controls.enableZoom = true;

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(light);

const loader = new GLTFLoader();
loader.load('object001.glb', function (gltf) {
  const model = gltf.scene;

  // 👇 モデルをラップするグループを作成
  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);

  model.scale.set(0.5, 0.5, 0.5);

  // モデル中心を取得し原点に移動
  model.updateMatrixWorld(true); // ← scale後に必要
  const box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.set(-center.x, -center.y, -center.z);

  pivot.position.y += 0.4;

  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  function animate() {
    requestAnimationFrame(animate);
    pivot.rotation.y += 0.0025; // ← グループを回転、自転のようになる！
    controls.update();
    renderer.render(scene, camera);
  }

  animate();

  // ↓ モデルクリックで遷移設定
  model.traverse((child) => {
    if (child.isMesh) {
      child.userData = { URL: 'object001.html' };
    }
  });

  const raycaster = new THREE.Raycaster();
 const mouse = new THREE.Vector2();

 function onDblClick(event) {
  // canvas(=renderer.domElement)基準で正規化座標に変換
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  mouse.set(x, y);

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (hits.length > 0) {
    // 子メッシュに当たった場合も親まで遡って userData.URL を探す
    let target = hits[0].object;
    while (target && !target.userData?.URL) target = target.parent;
    const url = target?.userData?.URL;
    if (url) window.location.href = url;
    }
  }
 // window.addEventListener('click', onClick);
 window.addEventListener('dblclick', onDblClick);

});
