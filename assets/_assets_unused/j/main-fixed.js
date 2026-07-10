// main-fixed.js  ←このファイルを置き換え
import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { addCommonLights } from '../lights.js';

// 追加（アウトライン用ポストプロセス）
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass }    from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/OutputPass.js';
/* =========================
   基本セットアップ
========================= */
// ファイル先頭の他のimportの下あたりに追加
const clock = new THREE.Clock();
let rotSpeed = 0.2;  // 回転速度（お好みで 0.6〜1.2 くらい）
let currentSpinPart = null;

const scene = new THREE.Scene();
addCommonLights(scene);

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('canvas-home'),
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// 補助ライト（好みで調整/削除可）
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));

/* =========================
   Orthographic Camera
========================= */
function makeOrthoCamera(viewW, viewH, frustum = 3) {
  const aspect = viewW / viewH;
  const halfH = frustum / 2;
  const halfW = halfH * aspect;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.zoom = 1;
  cam.updateProjectionMatrix();
  return cam;
}
const camera = makeOrthoCamera(window.innerWidth, window.innerHeight, 3);

/* =========================
   Composer / OutlinePass
========================= */
let composer = new EffectComposer(renderer);
const renderPass  = new RenderPass(scene, camera);
composer.addPass(renderPass);

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
// お好みで
outlinePass.edgeStrength  = 2.0;
outlinePass.edgeGlow      = 0.3;
outlinePass.edgeThickness = 1.0;
outlinePass.pulsePeriod   = 0;
outlinePass.visibleEdgeColor.set(0x1e90ff);
outlinePass.hiddenEdgeColor.set(0x000000);
composer.addPass(outlinePass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

/* =========================
   Raycaster / Mouse（共通で使う）
========================= */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

/* =========================
   リサイズ
========================= */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);

  const aspect = w / h;
  const halfH = (camera.top - camera.bottom) / 2; // 現在の見える高さを維持
  const halfW = halfH * aspect;

  camera.left   = -halfW;
  camera.right  =  halfW;
  camera.top    =  halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();

  composer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

/* =========================
   クリック可能部位（名前でタグ付け）
========================= */
function tagClickablePart(root, item) {
  let tagged = 0;

  if (item.clickMeshName) {
    // 完全一致を拾う
    const exactMatches = [];
    root.traverse((n) => { if (n.name === item.clickMeshName) exactMatches.push(n); });
    exactMatches.forEach(node => {
      node.traverse(n => { if (n.isMesh) { n.userData = {...n.userData, URL: item.detail}; tagged++; }});
    });

    // 見つからなければ部分一致で拾う（保険）
    if (tagged === 0) {
      const partialMatches = [];
      root.traverse((n) => { if (typeof n.name === 'string' && n.name.includes(item.clickMeshName)) partialMatches.push(n); });
      partialMatches.forEach(node => {
        node.traverse(n => { if (n.isMesh) { n.userData = {...n.userData, URL: item.detail}; tagged++; }});
      });
      if (partialMatches.length > 0) {
        console.warn('[clickable:fallback-partial]', item.id, 'found:', partialMatches.map(n=>n.name));
      }
    }

    console.log('[clickable]', item.id, 'nameKey=', item.clickMeshName, 'taggedMeshes=', tagged);
  }

  if (tagged === 0) {
    console.warn('[clickable] target NOT found for', item.id, 'nameKey=', item.clickMeshName);
  }
}

/* =========================
   コントロール
========================= */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.minZoom = 0.4;
controls.maxZoom = 4.0;
controls.autoRotate = false;
controls.enablePan = true;

/* =========================
   モデル定義（ホームで差し替え）
========================= */
const MODELS = [
  {
    id: 'object001',
    glb: 'object001.glb',
    detail: 'object001.html',
    scale: 0.5,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.40, z: 0 },
    cam: {
      pos:    { x: 0,  y: 4,  z: 10 },
      target: { x: 0,  y: 0,  z: 0  },
      zoomMul: 1.00,
    },
    clickMeshName: 'Mesh_0013', // ← 修正済み
        // ★ 回転設定
    spin: {
      whole: false,           // ← 全体も回すなら true / 止めるなら false
      wholeSpeed: 0.05,       // 全体の角速度（ラジアン/秒）

      part: true,            // ← 部分（Mesh_0013）を回すなら true
      partName: 'Mesh_0013', // 対象メッシュ名
      partSpeed: 1.0         // 部分の角速度（全体より速く、など）
    },
  },
  {
    id: 'object002',
    glb: 'object002.glb',
    detail: 'object002.html',
    scale: 0.5,
    margin: 1.0,
    centerMode: 'box',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: -0.40, z: 0 },
    cam: {
      pos:    { x: 0,   y: 4,   z: 10 },
      target: { x: 0,   y: 0,   z: 0  },
      zoomMul: 0.8,
    },
  },
  {
    id: 'object003',
    glb: 'object003.glb',
    detail: 'object003.html',
    scale: 0.5,
    margin: 1.3,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.40, z: 0 },
    cam: {
      pos:    { x: 6,  y: 3,  z: 10 },
      target: { x: -0.2,  y: 0.2,  z: 0  },
      zoomMul: 1.00,
    },
    clickMeshName: 'Mesh_0013', // ← 修正済み
        // ★ 回転設定
    spin: {
      whole: false,           // ← 全体も回すなら true / 止めるなら false
      wholeSpeed: 0.05,       // 全体の角速度（ラジアン/秒）

      part: true,            // ← 部分（Mesh_0013）を回すなら true
      partName: 'Mesh_0013', // 対象メッシュ名
      partSpeed: 1.0         // 部分の角速度（全体より速く、など）
    },
  },
  {
    id: 'object004',
    glb: 'object004.glb',
    detail: 'object00.html',
    scale: 0.5,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.40, z: 0 },
    cam: {
      pos:    { x: 0,  y: 4,  z: 10 },
      target: { x: 0,  y: 0,  z: 0  },
      zoomMul: 1.00,
    },
    clickMeshName: 'Mesh_0013', // ← 修正済み
        // ★ 回転設定
    spin: {
      whole: false,           // ← 全体も回すなら true / 止めるなら false
      wholeSpeed: 0.05,       // 全体の角速度（ラジアン/秒）

      part: true,            // ← 部分（Mesh_0013）を回すなら true
      partName: 'Mesh_0013', // 対象メッシュ名
      partSpeed: 1.0         // 部分の角速度（全体より速く、など）
    },
  },
];

/* =========================
   ヘルパー
========================= */
// オルソカメラの表示サイズに合わせてズームを決める
function fitOrthoToObject(camera, object, margin = 1.2) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);

  const visibleW = camera.right - camera.left;
  const visibleH = camera.top - camera.bottom;

  const needZoomW = visibleW / (Math.max(size.x, 1e-6) * margin);
  const needZoomH = visibleH / (Math.max(size.y, 1e-6) * margin);
  camera.zoom = Math.min(needZoomW, needZoomH);
  camera.updateProjectionMatrix();
}

// モデルの“見た目中心”を原点へ移動（box or sphere + 追加オフセット）
function centerModel(model, mode = 'box', offset = {x:0,y:0,z:0}) {
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const boxCenter = box.getCenter(new THREE.Vector3());
  const sphereCenter = box.getBoundingSphere(new THREE.Sphere()).center.clone();
  const c = (mode === 'sphere') ? sphereCenter : boxCenter;

  model.position.sub(c);
  model.position.x += offset.x || 0;
  model.position.y += offset.y || 0;
  model.position.z += offset.z || 0;

  model.updateMatrixWorld(true);
}

/* =========================
   ローダ & 差し替え
========================= */
const loader = new GLTFLoader();
const pivot = new THREE.Group();   // ← 回転の軸（常に原点）
scene.add(pivot);

let currentModel = null;
let currentItem  = null;

function disposeModel(root) {
  root?.traverse?.((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        m.map?.dispose?.();
        m.normalMap?.dispose?.();
        m.roughnessMap?.dispose?.();
        m.metalnessMap?.dispose?.();
        m.envMap?.dispose?.();
        m.dispose?.();
      });
    }
  });
}

function clearCurrentModel() {
  if (!currentModel) return;
  pivot.remove(currentModel);
  disposeModel(currentModel);
  currentModel = null;
  currentItem = null;
}

function loadModelById(id) {
  const item = MODELS.find(m => m.id === id);
  if (!item) return;

  clearCurrentModel();

  loader.load(item.glb, (gltf) => {
    const model = gltf.scene;
    currentModel = model;
    currentItem  = item;

    // リセット
    pivot.rotation.set(0, 0, 0);
    pivot.position.set(0, 0, 0);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);

    // スケール → 中心合わせ
    const s = item.scale ?? 1;
    model.scale.set(s, s, s);
    centerModel(model, item.centerMode || 'box', item.offset || {x:0,y:0,z:0});

    // pivot にぶら下げ（自転の中心）
    pivot.add(model);

    // クリック対象のタグ付け（Mesh_0013 など）
    tagClickablePart(model, item);

    // 自動フィット + 追加ズーム
    fitOrthoToObject(camera, model, item.margin ?? 0.7);
    if (item.cam?.zoomMul && item.cam.zoomMul !== 1) {
      camera.zoom *= item.cam.zoomMul;
      camera.updateProjectionMatrix();
    }

    // 表示オフセット
    if (item.pivotOffset) {
      const { x = 0, y = 0, z = 0 } = item.pivotOffset;
      pivot.position.set(x, y, z);
    } else {
      pivot.position.set(0, item.lift ?? 0, 0);
    }

    // ★ 部分回転ターゲットを保持
    currentSpinPart = null;
    if (item.spin?.part && item.spin?.partName) {
    const found = model.getObjectByName(item.spin.partName);
    if (found) {
    currentSpinPart = found;
    } else {
    console.warn('[spin] partName not found:', item.spin.partName);
    }
    }

    // カメラ位置/注視点
    if (item.cam?.pos) {
      const { x = camera.position.x, y = camera.position.y, z = camera.position.z } = item.cam.pos;
      camera.position.set(x, y, z);
    }
    if (item.cam?.target) {
      const { x = 0, y = 0, z = 0 } = item.cam.target;
      controls.target.set(x, y, z);
    } else {
      controls.target.set(0, 0, 0);
    }
    controls.update();
  });
}

// 外部（scatter.js / 見出しクリック）から呼べるAPI
window.selectModel = loadModelById;

/* =========================
   ホバー：カーソル/発光/アウトライン
========================= */
const hoverState = { lastMesh: null, lastOrig: new Map() };

function setEmissive(mesh, colorHex = 0x2266ff, intensity = 0.35) {
  if (!mesh?.material) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    if ('emissive' in m) {
      if (!hoverState.lastOrig.has(m)) {
        hoverState.lastOrig.set(m, {
          color: m.emissive.clone(),
          intensity: m.emissiveIntensity ?? 1.0,
        });
      }
      m.emissive.setHex(colorHex);
      if ('emissiveIntensity' in m) m.emissiveIntensity = intensity;
    }
  });
}
function restoreEmissive(mesh) {
  if (!mesh?.material) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    const org = hoverState.lastOrig.get(m);
    if (org) {
      m.emissive.copy(org.color);
      if ('emissiveIntensity' in m) m.emissiveIntensity = org.intensity;
      hoverState.lastOrig.delete(m);
    }
  });
}

window.addEventListener('pointermove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  mouse.set(x, y);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true);

  let clickable = null;
  if (hits.length) {
    let t = hits[0].object;
    while (t && !t.userData?.URL) t = t.parent;
    if (t?.userData?.URL) clickable = t;
  }

  // カーソル
  renderer.domElement.style.cursor = clickable ? 'pointer' : 'default';

  // アウトライン
  outlinePass.selectedObjects = clickable ? [clickable] : [];

  // emissive（発光）
  if (hoverState.lastMesh && hoverState.lastMesh !== clickable) {
    restoreEmissive(hoverState.lastMesh);
  }
  if (clickable && hoverState.lastMesh !== clickable) {
    setEmissive(clickable, 0x2266ff, 0.35);
  }
  hoverState.lastMesh = clickable;
});

/* =========================
   ダブルクリックで詳細へ
========================= */
function onDblClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (hits.length) {
    let target = hits[0].object;
    while (target && !target.userData?.URL) target = target.parent;
    const url = target?.userData?.URL;
    if (url) window.location.href = url;
  }
}
window.addEventListener('dblclick', onDblClick);

/* =========================
   ループ
========================= */
// animate() を置き換え
function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  // ★ 全体回転（設定でONのときだけ）
  if (pivot.children.length && currentItem?.spin?.whole) {
    const s = currentItem.spin.wholeSpeed ?? rotSpeed; // 既定はrotSpeed
    pivot.rotation.y += dt * s;
  }

  // ★ 部分回転（設定でON & ターゲット見つかったときだけ）
  if (currentSpinPart && currentItem?.spin?.part) {
    const ps = currentItem.spin.partSpeed ?? (rotSpeed * 1.5);
    currentSpinPart.rotation.y += dt * ps;
  }

  controls.update();

  // アウトラインON時だけ composer、なければ素のrenderer
  if (outlinePass.selectedObjects.length > 0) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

animate();

/* =========================
   初期表示：object001
========================= */
loadModelById('object001');