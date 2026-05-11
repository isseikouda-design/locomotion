// main-fixed.js （このファイルを置き換え）
// ------------------------------------------------------------
// Three.js
// ------------------------------------------------------------
import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/RGBELoader.js';

// Postprocess (Outline)
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/OutputPass.js';

// Your lights
import { addCommonLights } from './lights.js';

/* =========================================================
   基本セットアップ
========================================================= */
const clock = new THREE.Clock();
let rotSpeed = 0.2;

let currentSpinPart = null;
let currentPartPivot = null; // ★ 部分回転用の専用 Pivot
let pendingPanelToOpen = null;

const scene = new THREE.Scene();
addCommonLights(scene);

const WORLD_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const canvasEl = document.getElementById('canvas-home');
const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* =========================
   環境マップ (HDR)
========================= */
const rgbeLoader = new RGBELoader();
rgbeLoader.load('env.hdr', (hdrTex) => {
  hdrTex.mapping = THREE.EquirectangularReflectionMapping;

  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();

  const envMap = pmremGen.fromEquirectangular(hdrTex).texture;
  scene.environment = envMap;

  // envMapIntensity をまとめて弱める（反射は残しつつ照明を抑える）
  scene.traverse((obj) => {
    if (obj?.isMesh && obj.material && obj.material.isMeshStandardMaterial) {
      obj.material.envMapIntensity = 0.25;
      obj.material.needsUpdate = true;
    }
  });

  hdrTex.dispose();
  pmremGen.dispose();
});

// 補助ライト（好みで調整/削除可）
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));

/* =========================
   レンダリング制御フラグ
========================= */
let renderPaused = false;
function setRenderPaused(flag) {
  renderPaused = !!flag;
}

/* =========================================================
   Orthographic Camera
========================================================= */
function makeOrthoCamera(viewW, viewH, frustum = 3) {
  const aspect = viewW / viewH;
  const halfH = frustum / 2;
  const halfW = halfH * aspect;

  const cam = new THREE.OrthographicCamera(
    -halfW,
    halfW,
    halfH,
    -halfH,
    0.1,
    1000
  );
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.zoom = 1;
  cam.updateProjectionMatrix();
  return cam;
}

const camera = makeOrthoCamera(window.innerWidth, window.innerHeight, 3);

/* =========================================================
   Composer / OutlinePass
========================================================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
outlinePass.edgeStrength = 2.0;
outlinePass.edgeGlow = 0.3;
outlinePass.edgeThickness = 1.0;
outlinePass.pulsePeriod = 0;
outlinePass.visibleEdgeColor.set(0x1e90ff);
outlinePass.hiddenEdgeColor.set(0x000000);
composer.addPass(outlinePass);

composer.addPass(new OutputPass());

/* =========================================================
   Raycaster / Mouse
========================================================= */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

/* =========================================================
   リサイズ（CSSで確定した実表示サイズに追従）
========================================================= */
function onResize() {
  const rect = renderer.domElement.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w <= 0 || h <= 0) return;

  renderer.setSize(w, h, false);
  composer.setSize(w, h);

  const aspect = w / h;
  const halfH = (camera.top - camera.bottom) / 2;
  const halfW = halfH * aspect;

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

/* =========================================================
   クリック可能部位（名前でタグ付け）
========================================================= */
function tagClickablePart(root, item) {
  let tagged = 0;
  if (!item?.clickMeshName) return;

  const payload = {};
  if (item.detail) payload.URL = item.detail; // 外部遷移用
  if (item.goObjectId) payload.goto = item.goObjectId; // 内部切替用

  // 完全一致
  const exactMatches = [];
  root.traverse((n) => {
    if (n.name === item.clickMeshName) exactMatches.push(n);
  });

  exactMatches.forEach((node) => {
    node.traverse((n) => {
      if (n.isMesh) {
        n.userData = { ...n.userData, ...payload };
        tagged++;
      }
    });
  });

  // 見つからない場合は部分一致（保険）
  if (tagged === 0) {
    const partialMatches = [];
    root.traverse((n) => {
      if (typeof n.name === 'string' && n.name.includes(item.clickMeshName)) {
        partialMatches.push(n);
      }
    });

    partialMatches.forEach((node) => {
      node.traverse((n) => {
        if (n.isMesh) {
          n.userData = { ...n.userData, ...payload };
          tagged++;
        }
      });
    });

    if (partialMatches.length > 0) {
      console.warn(
        '[clickable:fallback-partial]',
        item.id,
        'found:',
        partialMatches.map((n) => n.name)
      );
    }
  }

  if (tagged === 0) {
    console.warn('[clickable] target NOT found for', item.id, 'nameKey=', item.clickMeshName);
  } else {
    console.log('[clickable]', item.id, 'nameKey=', item.clickMeshName, 'taggedMeshes=', tagged, 'payload=', payload);
  }
}

/* =========================================================
   コントロール
========================================================= */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.minZoom = 0.4;
controls.maxZoom = 4.0;
controls.autoRotate = false;
controls.enablePan = true;



/* =========================================================
   MODELS 定義
========================================================= */
const MODELS = [
  /* ===== scene 系 ===== */
  {
    id: 'scene001',
    glb: 'scene001.glb',
    goObjectId: 'object001',
    scale: 0.7,
    margin: 0.7,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: 0.75, z: 0 },
    cam: { pos: { x: -20, y: 8, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: {
      part: true,
      whole: true,
      partName: 'Mesh_0013',
      partSpeed: 1.0,
      wholeSpeed: 0.03,
      axis: 'y',
      partAxis: 'y',
      usePivotOnSp: true,
    },
    sp: {
      scale: 0.15,
      margin: 0.7,
      centerMode: 'sphere',
      pivotOffset: { x: 0, y: 0.2, z: 0 },
      cam: { pos: { x: 3, y: 5, z: 6 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
    info: {
  title: 'scene001',

  description: `A fragment of space, extracted and repositioned.
The object rotates without origin, detached from its initial context.
What remains is a surface — carrying traces of time, light, and contact.`,

  location: [`Statue: Kyoto, Japan
35.0116° N / 135.7681° E`,
`Statue: Kyoto, Japan
35.0116° N / 135.7681° E`,],

  credit: `3D scan and reconstruction by Locomotion™.
Derived from physical environments and processed into digital form.
Licensed materials follow CC BY 4.0 where applicable.`
}
    
  },
  {
    id: 'scene002',
    glb: 'scene002.glb',
    goObjectId: 'object002',
    scale: 0.25,
    margin: 1.1,
    centerMode: 'box',
    pivotOffset: { x: 0, y: -0.25, z: 0 },
    cam: { pos: { x: -20, y: 8, z: -6 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0008',
    spin: { part: true, whole: true, partName: 'Mesh_0008', partSpeed: 0.7, wholeSpeed: 0.03 },
    sp: {
      scale: 0.35,
      margin: 0.9,
      centerMode: 'box',
      pivotOffset: { x: -0.1, y: 0, z: 0 },
      cam: { pos: { x: -3, y: 11, z: -12 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene003',
    glb: 'scene003.glb',
    goObjectId: 'object003',
    scale: 0.35,
    margin: 1.3,
    centerMode: 'sphere',
    pivotOffset: { x: -0.5, y: -0.55, z: 0 },
    cam: { pos: { x: 6.5, y: 5, z: -8.5 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0001',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.15,
      margin: 0.5,
      centerMode: 'box',
      pivotOffset: { x: 0, y: -0.3, z: 0 },
      cam: { pos: { x: -12, y: 10, z: -5 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene004',
    glb: 'scene004.glb',
    goObjectId: 'object004',
    scale: 0.47,
    margin: 1.0,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 4.5, z: 10.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0001',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.65,
      margin: 0.9,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0.8, z: 0 },
      cam: { pos: { x: 1, y: 3, z: 3}, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene005',
    glb: 'scene005.glb',
    goObjectId: 'object005',
    scale: 0.15,
    margin: 1.5,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: -0.05, z: 0 },
    cam: { pos: { x: 8.3, y: 3.3, z: 5.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0',
    spin: { part: true, whole: true, partName: 'Mesh_0', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.18,
      margin: 0.7,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0.1, z: 0 },
      cam: { pos: { x: -1, y: 8, z: 5.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene006',
    glb: 'scene006.glb',
    goObjectId: 'object006',
    scale: 0.085,
    margin: 1.5,
    centerMode: 'sphere',
    pivotOffset: { x: -4, y: -2.0, z: 0 },
    cam: { pos: { x: 9.3, y: 4, z: 3.2 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0004',
    spin: { part: true, whole: true, partName: 'Mesh_0004', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.03,
      margin: 0.9,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0.3, z: 0 },
      cam: { pos: { x: 0, y: 4, z: -10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene007',
    glb: 'scene007.glb',
    goObjectId: 'object007',
    scale: 0.5,
    margin: 1.45,
    centerMode: 'sphere',
    pivotOffset: { x: 0.03, y: -0.15, z: 0 },
    cam: { pos: { x: 6.2, y: 2.7, z: 6.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0009',
    spin: { part: true, whole: true, partName: 'Mesh_0009', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.3,
      margin: 0.65,
      centerMode: 'sphere',
      pivotOffset: { x: 0.03, y: 0.3, z: 0 },
      cam: { pos: { x: 3, y: 14, z: 6.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene008',
    glb: 'scene008.glb',
    goObjectId: 'object008',
    scale: 0.3,
    margin: 0.95,
    centerMode: 'sphere',
    pivotOffset: { x: 0.85, y: 1, z: 0 },
    cam: { pos: { x: 0, y: 1.5, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0007',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.1,
      margin: 1,
      centerMode: 'box',
      pivotOffset: { x: 0.5, y: 1.2, z: 0 },
      cam: { pos: { x: 0, y: 1, z: 3 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },
  {
    id: 'scene009',
    glb: 'scene009.glb',
    goObjectId: 'object009',
    scale: 0.3,
    margin: 0.9,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: 0.1, z: 0 },
    cam: { pos: { x: 7.5, y: 1.2, z: 6.7 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0002',
    spin: { part: true, whole: true, partName: 'Mesh_0002', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.35,
      margin: 0.5,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0.1, z: 0 },
      cam: { pos: { x: 1, y: 15, z: 1 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
  },

  /* ===== object 系 ===== */
{
  id: 'object001',
  glb: 'object001.glb',
  detail: 'object001.html',
  scale: 0.6,
  margin: 0.8,
  centerMode: 'sphere',
  offset: { x: 0, y: 0, z: 0 },
  pivotOffset: { x: 0, y: 0.0, z: 0 },
  cam: { pos: { x: 8.6, y: 4, z: -5.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
  clickMeshName: 'Mesh_0001',
  spin: { whole: true, wholeSpeed: 0.1, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
  info: {
    title: 'object001',
    lines: ['"A shard of silence carries the weight of a forgotten spring."', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
  },

  sp: {
    scale: 1,
    margin: 1.4,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 10.6, y: 4, z: -5.0 },
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
},
  {
    id: 'object002',
    glb: 'object002.glb',
    detail: 'object002.html',
    scale: 0.7,
    margin: 1.0,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 6, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 0.8 },
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT002',
      lines: ['The wind has traveled far, stripping away color.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
      sp: {
    scale: 1,
    margin: 2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 8.6, y: 4, z: -5.0 },
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object003',
    glb: 'object003.glb',
    detail: 'object003.html',
    scale: 0.5,
    margin: 1.3,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 6.4, y: 1, z: -7.6 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT003',
      lines: [
        'The alleys of Lisbon, the kitchens of New York, the sound of rain in Seoul, the houses of Oaxaca, the ruins of Denmark.',
        'General Requires / Sales.',
        'W90 D90 H90.',
        'block code resin.',
        'Buy/Ask',
      ],
    },
     sp: {
    scale: 1,
    margin: 1.6,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 6.4, y: 1, z: -7.6 }, 
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object004',
    glb: 'object004.glb',
    detail: 'object00.html',
    scale: 0.5,
    margin: 0.9,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT004',
      lines: ['Hooves of the bull, hands of prayer, dry wind—all merged into a single heartbeat upon the stone.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
       sp: {
    scale: 1,
    margin: 1.2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 0, y: 4, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object005',
    glb: 'object005.glb',
    detail: 'object00.html',
    scale: 0.7,
    margin: 1,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0013', partSpeed: 1.0 },
    info: {
      title: 'OBJECT005',
      lines: ['She grew mint between the cracks,and the air always smelled like soup and soil.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
       sp: {
    scale: 1,
    margin: 1.4,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
     pos: { x: 10, y: 4, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object006',
    glb: 'object006.glb',
    detail: 'object00.html',
    scale: 0.5,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0013', partSpeed: 1.0 },
    info: {
      title: 'OBJECT006',
      lines: ['Years later, in another country,someone holds the fragment and exhales.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
     sp: {
    scale: 1,
    margin: 2.2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 0, y: 4, z: 10 }, 
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
    
  },
  {
    id: 'object007',
    glb: 'object007.glb',
    detail: 'object00.html',
    scale: 0.45,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 12.6, y: 4, z: -1.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT007',
      lines: ['A shard. His hands were red, cracked from the cold. The air still carried the chill after rain.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
      sp: {
    scale: 1,
    margin: 1,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: -0.08, y: 0.0, z: 0 },
    cam: {
      pos: { x: 10, y: 4, z: -13}, 
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object008',
    glb: 'object008.glb',
    detail: 'object00.html',
    scale: 0.5,
    margin: 1.3,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 7, y: 2, z: 7.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT008',
      lines: ['Frogs croaked in the distance,water boiled in the kitchen pot.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
       sp: {
    scale: 1,
    margin: 1.6,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 7, y: 2, z: 7.0 }, 
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'object009',
    glb: 'object009.glb',
    detail: 'object00.html',
    scale: 0.55,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: -0.03, z: 0 },
    cam: { pos: { x: 10, y: 4, z: 0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    info: {
      title: 'OBJECT009',
      lines: ['Frogs croaked in the distance,water boiled in the kitchen pot.', 'General Requires / Sales.', 'W90 D90 H90.', 'block code resin.', 'Buy/Ask'],
    },
       sp: {
    scale: 1,
    margin: 1.5,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: {
      pos: { x: 10, y: 4, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
  {
    id: 'objectXXX',
    glb: 'objectXXX.glb',
    scale: 0.6,
    margin: 0.8,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 8, y: 4, z: 8 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: { whole: true, wholeSpeed: 0.08 },
    info: { title: 'objectXXX', lines: ['Details coming soon.'] },

     sp: {
    scale: 1,
    margin: 1.2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: {
      pos: { x: 7, y: 0, z: 7.0 }, 
      target: { x: 0, y: 0, z: 0 },
      zoomMul: 1.0
    }
  }
  },
   
];

/* =========================================================
   ヘルパー
========================================================= */
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

function refitCurrentSpObjectAfterLayout() {
  const isSP = window.matchMedia('(max-width: 768px)').matches;
  if (!isSP) return;
  if (!currentModel || !currentItem) return;
  if (!document.body.classList.contains('is-sp-object')) return;

  const spConf = currentItem.sp ?? null;
  const margin = spConf?.margin ?? currentItem.margin ?? 0.7;
  const camConf = spConf?.cam ?? currentItem.cam ?? null;

  // ★ object用UIが反映された後のcanvasサイズで再fit
  fitOrthoToObject(camera, currentModel, margin);

  if (camConf?.zoomMul && camConf.zoomMul !== 1) {
    camera.zoom *= camConf.zoomMul;
    camera.updateProjectionMatrix();
  }
}

function centerModel(model, mode = 'box', offset = { x: 0, y: 0, z: 0 }) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const boxCenter = box.getCenter(new THREE.Vector3());
  const sphereCenter = box.getBoundingSphere(new THREE.Sphere()).center.clone();
  const c = mode === 'sphere' ? sphereCenter : boxCenter;

  model.position.sub(c);
  model.position.x += offset.x || 0;
  model.position.y += offset.y || 0;
  model.position.z += offset.z || 0;

  model.updateMatrixWorld(true);
}
function setOrbitTargetToModelCenter(model, { isMobile, itemId } = {}) {
  if (!model) return;
  if (!isMobile) return;
  if (!isObjectId(itemId)) return; // ★ object のときだけ

  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const centerWorld = sphere.center.clone();

  controls.target.copy(centerWorld);
  controls.update();
}

/* =========================================================
   ローダ & 差し替え
========================================================= */
const loader = new GLTFLoader();

// ★ 空間を傾けるための親グループ（tiltRoot）
const tiltRoot = new THREE.Group();
scene.add(tiltRoot);

// pivot は tiltRoot の子にする（全体回転用）
const pivot = new THREE.Group(); // 回転の軸（常に原点）
tiltRoot.add(pivot);

let currentModel = null;
let currentItem = null;
let lastSceneId = null;
let loadRequestId = 0;

// === SP align base (camera/target) ===
let spBaseCamY = 0;
let spBaseTargetY = 0;
let spAlignPending = false;

const isObjectId = (id) => /^object\d{3}$/.test(id) || id === 'objectXXX';
const isSceneId = (id) => /^scene\d{3}$/.test(id);

function pairSceneForObject(objectId) {
  const m = /^object(\d{3})$/.exec(objectId);
  return m ? `scene${m[1]}` : null;
}

function disposeModel(root) {
  root?.traverse?.((obj) => {
    if (!obj.isMesh) return;

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
  });
}

function clearCurrentModel() {
  if (currentPartPivot) {
    pivot.remove(currentPartPivot);
    currentPartPivot = null;
  }

  if (!currentModel) return;

  pivot.remove(currentModel);
  disposeModel(currentModel);

  currentModel = null;
  currentItem = null;
  currentSpinPart = null;
}

/* =========================================================
   DOMヘルパー（info-box / back / guide）
========================================================= */
function ensureInfoBox() {
  let box = document.getElementById('object-info-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'object-info-box';
    document.body.appendChild(box);
  }
  return box;
}

function ensureBackButton(sceneId) {
  if (!sceneId) return;

  let btn = document.getElementById('backToSceneBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'backToSceneBtn';
    document.body.appendChild(btn);
  }

  btn.textContent = `← Back to ${sceneId}`;
  btn.style.display = 'block';
  btn.onclick = () => {
    loadModelById(sceneId);

    const id3 = sceneId.replace(/^scene/, '');
    const u = new URL(location.href);
    u.searchParams.delete('object');
    u.searchParams.set('scene', id3);
    history.pushState({ type: 'scene', id: id3 }, '', u);
  };
}

function hideBackButton() {
  const btn = document.getElementById('backToSceneBtn');
  if (btn) btn.style.display = 'none';
}

/* =========================
   Guide Window (movie終了後に一度だけ)
========================= */
function ensureGuideWindow() {
  let gw = document.getElementById('guide-window');
  if (!gw) {
    gw = document.createElement('div');
    gw.id = 'guide-window';
    gw.innerHTML = `
      <div class="gw-titlebar">
        <span class="gw-dots"><i></i><i></i><i></i></span>
        <span class="gw-url">https://your-site.example/about</span>
        <button class="gw-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="gw-body">
        <p class="gw-head">Locomotion™</p>
        <p class="gw-text">Double-clicking on rotating objects on this site</p>
        <p class="gw-text">will take you to the next page.</p>
        <p class="gw-emoji">💫💫💫💫💫</p>
      </div>
    `;
    gw.style.display = 'none';
    document.body.appendChild(gw);

    gw.querySelector('.gw-close')?.addEventListener('click', () => {
      hideGuideWindow();
      markGuideSeen();
    });
  }
  return gw;
}

function showGuideWindow() {
  const gw = ensureGuideWindow();
  gw.style.display = 'block';
  requestAnimationFrame(() => gw.classList.add('show'));
}

function hideGuideWindow() {
  const gw = document.getElementById('guide-window');
  if (!gw) return;
  gw.classList.remove('show');
  setTimeout(() => {
    gw.style.display = 'none';
  }, 180);
}

function hasSeenGuide() {
  return localStorage.getItem('guideSeen') === '1';
}
function markGuideSeen() {
  localStorage.setItem('guideSeen', '1');
}
function showGuideWindowOnce() {
  if (!hasSeenGuide()) showGuideWindow();
}

/* =========================================================
   SP: 右下ボタン（Go to object / Back to scene）
========================================================= */
function updateSpGotoButton() {
  const btn = document.querySelector('.sp-action-goto');
  if (!btn || !currentItem) return;

  const isObj = isObjectId(currentItem.id);

  if (isObj) {
    const backScene = currentItem.id === 'objectXXX' ? 'scene007' : pairSceneForObject(currentItem.id);
    btn.textContent = `← Back to ${backScene || 'scene'}`;
    btn.dataset.mode = 'back';
    btn.dataset.target = backScene || '';
  } else {
    const go = currentItem.goObjectId || '';
    btn.textContent = go ? `→ Go to ${go}` : '→ Go to object';
    btn.dataset.mode = 'goto';
    btn.dataset.target = go;
  }
}

function wireSpGotoButton() {
  const btn = document.querySelector('.sp-action-goto');
  if (!btn) return;

  btn.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      if (!currentItem) return;

      const mode = btn.dataset.mode;
      const target = btn.dataset.target;

      if (mode === 'back') {
        if (!target) return;

        loadModelById(target);

        const id3 = target.replace(/^scene/, '');
        const u = new URL(location.href);
        u.searchParams.delete('object');
        u.searchParams.set('scene', id3);
        history.pushState({ type: 'scene', id: id3 }, '', u);
        return;
      }

      const go = target || currentItem.goObjectId;
      if (!go) return;

      if (isSceneId(currentItem.id)) lastSceneId = currentItem.id;

      loadModelById(go);

      const id3 = go.replace(/^object/, '');
      const u = new URL(location.href);
      u.searchParams.delete('scene');
      u.searchParams.set('object', id3);
      history.pushState({ type: 'object', id: id3 }, '', u);
    },
    { passive: false }
  );
}

/* =========================================================
   部分回転Pivot（SP用）
========================================================= */
function setupPartPivotForItem(model, item, { isMobile }) {
  if (currentPartPivot) {
    pivot.remove(currentPartPivot);
    currentPartPivot = null;
  }

  if (!isMobile) return;
  if (!item?.spin?.usePivotOnSp) return;
  if (!item?.spin?.part || !item?.spin?.partName) return;

  scene.updateMatrixWorld(true);

  const target = model.getObjectByName(item.spin.partName);
  if (!target) {
    console.warn('[pivot] partName not found for', item.id, item.spin.partName);
    return;
  }

  if (typeof target.updateWorldMatrix === 'function') {
    target.updateWorldMatrix(true, false);
  }

  const box = new THREE.Box3().setFromObject(target);
  const centerWorld = box.getCenter(new THREE.Vector3());

  pivot.updateMatrixWorld(true);
  const centerLocal = pivot.worldToLocal(centerWorld.clone());

  const partPivot = new THREE.Group();
  partPivot.position.copy(centerLocal);
  pivot.add(partPivot);

  partPivot.attach(target);
  currentPartPivot = partPivot;
}

/* =========================================================
   モデル読み込み本体
========================================================= */
function loadModelById(id) {

  const requestId = ++loadRequestId;

  const item = MODELS.find((m) => m.id === id);
  if (!item) {
    console.warn('[loadModelById] not found:', id);
    return;
  }

  // Object表示のときは「戻りscene」を記録（objectXXXはscene007固定）
  if (isObjectId(id)) {
    if (id === 'objectXXX') lastSceneId = 'scene007';
    else {
      const paired = pairSceneForObject(id);
      if (paired) lastSceneId = paired;
    }
  }

  clearCurrentModel();

  const isMobile = window.innerWidth <= 768;

  // SP専用 tilt
  tiltRoot.rotation.set(0, 0, 0);
  if (isMobile && item.sp?.tilt) {
    const { axis = 'z', angle = 0 } = item.sp.tilt || {};
    if (axis === 'x') tiltRoot.rotation.set(angle, 0, 0);
    else if (axis === 'y') tiltRoot.rotation.set(0, angle, 0);
    else tiltRoot.rotation.set(0, 0, angle);
  }

  loader.load(
    item.glb,
    (gltf) => {
      if (requestId !== loadRequestId) return;
      const model = gltf.scene;

      currentModel = model;
      currentItem = item;
      updatePcSceneActive(item.id);
      renderPcInfo(item);
      updatePcPlusText();
      updatePcBottomLabels();

      updateSpGotoButton();

      // レイアウト選択（PC / SP）
      const spConf = isMobile && item.sp ? item.sp : null;

      const scale = spConf?.scale ?? item.scale ?? 1;
      const margin = spConf?.margin ?? item.margin ?? 0.7;
      const centerMode = spConf?.centerMode ?? item.centerMode ?? 'box';
      const offset = spConf?.offset ?? item.offset ?? { x: 0, y: 0, z: 0 };
      const pivotOffset = spConf?.pivotOffset ?? item.pivotOffset ?? { x: 0, y: item.lift ?? 0, z: 0 };
      const camConf = spConf?.cam ?? item.cam ?? null;
      const rotateConf = spConf?.rotate ?? null;

      // リセット
      // リセット
pivot.rotation.set(0, 0, 0);
pivot.position.set(0, 0, 0);

// ★ これ追加
pivot.updateMatrixWorld(true);

model.position.set(0, 0, 0);
model.rotation.set(0, 0, 0);

      // スケール
      model.scale.set(scale, scale, scale);

      // 中心合わせ
      centerModel(model, centerMode, offset);

      // SP用 rotate
      if (rotateConf) {
        model.rotation.x += rotateConf.x || 0;
        model.rotation.y += rotateConf.y || 0;
        model.rotation.z += rotateConf.z || 0;
        model.updateMatrixWorld(true);

        centerModel(model, centerMode, offset);
        model.updateMatrixWorld(true);
      }

      // pivotに追加
      pivot.add(model);

      // clickable tag
      tagClickablePart(model, item);

      // fit + zoomMul（毎回リセット前提で再適用）
fitOrthoToObject(camera, model, margin);

if (camConf?.zoomMul && camConf.zoomMul !== 1) {
  camera.zoom = camera.zoom * camConf.zoomMul;
}

camera.updateProjectionMatrix();

      // pivotOffset
      if (pivotOffset) {
        const { x = 0, y = 0, z = 0 } = pivotOffset;
        pivot.position.set(x, y, z);
      } else {
        pivot.position.set(0, item.lift ?? 0, 0);
      }

      // 部分回転ターゲット（従来）
      currentSpinPart = null;
      if (item.spin?.part && item.spin?.partName) {
        const found = model.getObjectByName(item.spin.partName);
        if (found) currentSpinPart = found;
        else console.warn('[spin] partName not found:', item.spin.partName);
      }

      // カメラ pos / target
 // カメラ pos / target

// ★ targetを完全初期化
controls.target.set(0, 0, 0);
controls.update();

// ★ カメラ初期化
camera.position.set(0, 0, 10);

// ★ 上書き
if (camConf?.pos) {
  const { x = 0, y = 0, z = 10 } = camConf.pos;
  camera.position.set(x, y, z);
}

if (camConf?.target) {
  const { x = 0, y = 0, z = 0 } = camConf.target;
  controls.target.set(x, y, z);
}

controls.update();

// ★ これ追加（かなり重要）
controls.saveState();


      // up固定
      camera.up.set(0, 1, 0);
      camera.lookAt(controls.target);

      // 最後に：SPの「きれいな回転」用Pivotセット
      setupPartPivotForItem(model, item, { isMobile });

// ★ object のときだけ Orbit target をモデル中心へ
if (isMobile && isObjectId(item.id)) {
  setOrbitTargetToModelCenter(model, { isMobile: true, itemId: item.id });
}

// ★ UI更新は、model/cameraの準備が終わってから
window.__spUiUpdate?.(item);

// ★ scene / object ともに同じレイアウト確定ルートに統一
// if (isMobile) {
//   syncSpLayoutThenAlign();
// }

      // info-box / back（今はSP新UIへ移すので常に隠す）
      const infoBox = ensureInfoBox();
      infoBox.style.display = 'none';

      hideBackButton();
      document.body.classList.remove('is-object-page');

      if (isObjectId(item.id)) {
        hideGuideWindow();
        markGuideSeen();
      }


      
    },
    undefined,
    (err) => {
      console.error('[GLTFLoader] failed:', item.glb, err);
    }
  );
  
}

// 外部からも呼べるAPI
window.selectModel = loadModelById;

/* =========================================================
   ホバー：カーソル/発光/アウトライン
========================================================= */
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
    while (t && !(t.userData?.URL || t.userData?.goto)) t = t.parent;
    if (t?.userData?.URL || t?.userData?.goto) clickable = t;
  }

  renderer.domElement.style.cursor = clickable ? 'pointer' : 'default';
  outlinePass.selectedObjects = clickable ? [clickable] : [];

  if (hoverState.lastMesh && hoverState.lastMesh !== clickable) {
    restoreEmissive(hoverState.lastMesh);
  }
  if (clickable && hoverState.lastMesh !== clickable) {
    setEmissive(clickable, 0x2266ff, 0.35);
  }

  hoverState.lastMesh = clickable;
});

/* =========================================================
   オブジェクトクリック共通処理
   - PC: dblclick
   - SP: touch pointerup
========================================================= */
function handlePickAt(ev) {
  if (document.body.classList.contains('modal-open')) return;

  const t = ev?.target;
  if (t && t.closest && t.closest('.topnav, .ticker, .overlay, .sp-ui, .sp-bottom')) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const clientX = ev.clientX;
  const clientY = ev.clientY;

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (!hits.length) return;

  let target = hits[0].object;
  while (target && !(target.userData?.URL || target.userData?.goto)) target = target.parent;

  const data = target?.userData;
  if (!data) return;

  if (data.URL) {
    window.location.href = data.URL;
    return;
  }

  if (data.goto) {
    if (currentItem && isSceneId(currentItem.id)) lastSceneId = currentItem.id;

    loadModelById(data.goto);

    const u = new URL(location.href);
    u.searchParams.delete('scene');
    const id3 = data.goto.replace(/^object/, '');
    u.searchParams.set('object', id3);
    history.pushState({ type: 'object', id: id3 }, '', u);
  }
}

window.addEventListener('dblclick', (event) => handlePickAt(event));
window.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') return;
  handlePickAt(event);
});

/* =========================================================
   ループ
========================================================= */
function animate() {
  requestAnimationFrame(animate);
  if (renderPaused) return;

  const dt = clock.getDelta();
  const isMobile = window.innerWidth <= 768;

  // 全体回転（pivot）
  if (pivot.children.length && currentItem?.spin?.whole) {
    const s = currentItem.spin.wholeSpeed ?? rotSpeed;
    const axis = (isMobile && currentItem.spin.axisSp) || currentItem.spin.axis || 'y';

    if (axis === 'x') pivot.rotation.x += dt * s;
    else if (axis === 'z') pivot.rotation.z += dt * s;
    else pivot.rotation.y += dt * s;
  }

  // 部分回転
  if (currentItem?.spin?.part) {
    const ps = currentItem.spin.partSpeed ?? rotSpeed * 1.5;
    const wholeAxis = (isMobile && currentItem.spin.axisSp) || currentItem.spin.axis || 'y';
    const axis = (isMobile && currentItem.spin.partAxisSp) || currentItem.spin.partAxis || wholeAxis;

    if (isMobile && currentItem.spin.usePivotOnSp && currentPartPivot) {
      if (axis === 'x') currentPartPivot.rotation.x += dt * ps;
      else if (axis === 'z') currentPartPivot.rotation.z += dt * ps;
      else currentPartPivot.rotation.y += dt * ps;
    } else if (currentSpinPart) {
      if (axis === 'x') currentSpinPart.rotation.x += dt * ps;
      else if (axis === 'z') currentSpinPart.rotation.z += dt * ps;
      else currentSpinPart.rotation.y += dt * ps;
    }
  }

  controls.update();

  if (outlinePass.selectedObjects.length > 0) composer.render();
  else renderer.render(scene, camera);
}
animate();

/* =========================================================
   SP UI wiring
========================================================= */

function buildPcSceneStrip() {
  const strip = document.getElementById('pcSceneStrip');
  if (!strip) return;

  const scenes = MODELS.filter(m => m.id.startsWith('scene'));

  scenes.forEach((m) => {
    const btn = document.createElement('button');
    btn.className = 'pc-scene-chip';
   btn.textContent = `${m.id}/`;
    btn.dataset.pcJump = m.id;
    strip.appendChild(btn);
  });
}
function updatePcSceneActive(id) {
  const chips = document.querySelectorAll('.pc-scene-chip');
  chips.forEach((c) => {
    c.classList.toggle('is-active', c.dataset.pcJump === id);
  });
}
function renderPcInfo(item) {
  const panel = document.getElementById('pcInfoPanel');
  const content = document.getElementById('pcInfoContent');
  if (!panel || !content || !item) return;

  const info = item.info || {};

  const title = info.title || item.id;
  const description =
    info.description ||
    info.lines?.[0] ||
    'Information coming soon.';

  const location = info.location || '';
  const credit = info.credit || '';
  const material = info.material || info.lines?.[2] || '';
  const size = info.size || info.lines?.[1] || '';
  const price = info.price || '';
  const email = info.email || 'info@locomotion.com';

  const isObject = isObjectId(item.id);

  content.innerHTML = `
    <h2>${title}</h2>

    <p>${description}</p>

    ${location ? `<p><strong>Location:</strong><br>${location}</p>` : ''}
    ${credit ? `<p><strong>Credit:</strong><br>${credit}</p>` : ''}

    ${isObject && material ? `<p><strong>Material:</strong><br>${material}</p>` : ''}
    ${isObject && size ? `<p><strong>Size:</strong><br>${size}</p>` : ''}
    ${isObject && price ? `<p><strong>Price:</strong><br>${price}</p>` : ''}

    ${
      isObject
        ? `<p><a href="mailto:${email}">Buy / Ask</a></p>`
        : ''
    }
  `;
}


buildPcSceneStrip();

(function wirePcInfoPanel() {
  const sceneBtn = document.getElementById('pcInfoTrigger');
  const starsBtn = document.getElementById('pcStarsTrigger');
  const explainBtn = document.getElementById('pcExplainTrigger');
  const privacyBtn = document.getElementById('pcPrivacyTrigger');

  const panel = document.getElementById('pcInfoPanel');
  const content = document.getElementById('pcInfoContent');
  const close = document.getElementById('pcInfoClose');

  if (!panel || !content) return;

  function clearBottomActive() {
    document.querySelectorAll('.pc-bottom-link').forEach((btn) => {
      btn.classList.remove('is-active');
    });
  }

function openPanel(activeBtn, html, type = '') {
  clearBottomActive();

  panel.className = 'pc-info-panel is-open';
  if (type) panel.classList.add(`is-${type}`);

  panel.setAttribute('aria-hidden', 'false');

  activeBtn?.classList.add('is-active');
  content.innerHTML = html;
}

  function closePanel() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    clearBottomActive();
  }

sceneBtn?.addEventListener('click', (e) => {
  e.preventDefault();

  const isOpen =
    panel.classList.contains('is-open') &&
    panel.classList.contains('is-scene');

  if (isOpen) {
    closePanel();
    return;
  }

  clearBottomActive();

 const isObject = currentItem && currentItem.id.startsWith('object');
panel.className = isObject
  ? 'pc-info-panel is-open is-object-info'
  : 'pc-info-panel is-open is-scene';
  panel.setAttribute('aria-hidden', 'false');

  sceneBtn.classList.add('is-active');

  if (currentItem) {
    renderPcInfo(currentItem);
  }
});

  starsBtn?.addEventListener('click', (e) => {
    e.preventDefault();

    const locus =
      document.getElementById('locusTopRight') ||
      document.getElementById('locusBottomLeft');

    locus?.click();

    requestAnimationFrame(() => {
      const isOn =
        document.body.classList.contains('trail-on') ||
        document.body.classList.contains('is-trail');

      starsBtn.classList.toggle('is-active', isOn);
    });
  });

  explainBtn?.addEventListener('click', (e) => {
    e.preventDefault();

openPanel(explainBtn, `
  <h2>Locomotion™</h2>
  <p>
    Locomotion™ is a digital field for scanned scenes, handmade objects,
    public fragments, and temporary materials.
  </p>
  <p>
    Each scene functions as an entrance. Each object works as a small physical
    trace, detached from its original location and placed back into motion
    through the screen.
  </p>
  <p>
    The project treats navigation, product display, and spatial memory as one
    continuous movement.
  </p>
  <img src="about_image_1.jpeg" alt="">
`, 'explain');
  });

  privacyBtn?.addEventListener('click', (e) => {
    e.preventDefault();

  openPanel(privacyBtn, `
      <h2>Privacy</h2>
      <p>
        This website may collect basic access information such as browser type,
        device type, and anonymous usage data in order to improve the viewing
        experience.
      </p>
      <p>
        We do not sell personal information. If you contact us by email, your
        address and message will only be used to respond to your inquiry.
      </p>
      <p>
        For questions about privacy, please contact
        <a href="mailto:info@locomotion_service.com">info@locomotion_service.com</a>.
      </p>
    `, 'privacy');
  });

  close?.addEventListener('click', (e) => {
    e.preventDefault();
    closePanel();
  });
})();
(function wirePcPlusText() {
  const btn = document.getElementById('pcPlusBtn');
  const text = document.getElementById('pcPlusText');

  if (!btn || !text) {
    console.warn('[pcPlus] button or text not found');
    return;
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();

    updatePcPlusText();

    const isOpen = text.classList.toggle('is-open');

    text.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    btn.classList.toggle('is-active', isOpen);

    console.log('[pcPlus] open:', isOpen);
  });
})();
function updatePcPlusText() {
  const text = document.getElementById('pcPlusText');
  if (!text || !currentItem) return;

  const isObject = currentItem.id.startsWith('object');

 const isSP = window.innerWidth <= 768;

text.innerHTML = isObject
  ? `<p>(Good job finding this page! Congratulations!)</p>`
  : isSP
    ? `<p>(Click on the rotating object to proceed)</p>`
    : `<p>(Click on a rotating object to go to the product page.)</p>`;
}
function updatePcBottomLabels() {
  const infoBtn = document.getElementById('pcInfoTrigger');
  if (!infoBtn || !currentItem) return;

  const isObject = currentItem.id.startsWith('object');

  infoBtn.textContent = isObject
    ? 'what is this object?'
    : 'what is this scene?';
}


/* =========================================================
   初期表示：URLパラメータ対応
========================================================= */
(function initFromURL() {
  const u = new URL(location.href);
  const s = u.searchParams.get('scene');
  const o = u.searchParams.get('object');
  const p = u.searchParams.get('panel');

  const is3 = (v) => typeof v === 'string' && /^\d{3}$/.test(v);

  if (is3(o)) loadModelById(`object${o}`);
  else if (is3(s)) loadModelById(`scene${s}`);
  else loadModelById('scene001');

  pendingPanelToOpen = p || null;
})();

/* =========================================================
   popstate（戻る/進む）
========================================================= */
window.addEventListener('popstate', () => {
  const u = new URL(location.href);
  const s = u.searchParams.get('scene');
  const o = u.searchParams.get('object');
  const p = u.searchParams.get('panel');

  const is3 = (v) => typeof v === 'string' && /^\d{3}$/.test(v);

  if (p) {
    window.openOverlayPanel?.(p);
    return;
  }
  if (is3(o)) {
    loadModelById(`object${o}`);
    return;
  }
  if (is3(s)) {
    loadModelById(`scene${s}`);
    return;
  }
  loadModelById('scene001');

  if (!p) {
    const overlay = document.getElementById('overlay');
    overlay?.querySelector('[data-overlay-close]')?.click();
  }
});

/* =========================================================
   Overlay Manager
========================================================= */
(function () {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;

  const contentEl = document.getElementById('overlayContent');
  const titleEl = overlay.querySelector('.overlay__title');
  const CLOSE_ATTR = '[data-overlay-close]';

  let currentPanel = null;

  function lockBody(lock) {
    document.body.classList.toggle('modal-open', !!lock);
  }

  function openPanel(panel) {
    currentPanel = panel;

    overlay.className = 'overlay is-open';
    overlay.classList.add(`is-${panel}`);
    overlay.setAttribute('aria-hidden', 'false');

    lockBody(true);
    setRenderPaused(true);

    // ===== List =====
    if (panel === 'list') {
      titleEl.textContent = 'SCENE / OBJECT';

      const sceneItems = Array.from({ length: 9 }, (_, i) => {
        const id = String(i + 1).padStart(3, '0');
        return `<li><a href="#" data-choose="scene" data-id="${id}">scene${id}</a></li>`;
      }).join('');

      const objectItems = Array.from({ length: 9 }, (_, i) => {
        const id = String(i + 1).padStart(3, '0');
        return `<li><a href="#" data-choose="object" data-id="${id}">object${id}</a></li>`;
      }).join('');

      const extraObject = `<li><a href="#" data-choose="object" data-id="XXX">objectXXX</a></li>`;

      contentEl.innerHTML = `
        <div class="list-grid">
          <div class="list-col">
            <h4>SCENE</h4>
            <ul>${sceneItems}</ul>
          </div>
          <div class="list-col">
            <h4>OBJECT</h4>
            <ul>${objectItems}${extraObject}</ul>
          </div>
        </div>
      `;

      contentEl.onclick = (e) => {
        const a = e.target.closest('a[data-choose]');
        if (!a) return;

        e.preventDefault();

        const type = a.getAttribute('data-choose'); // 'scene' | 'object'
        const id = a.getAttribute('data-id'); // "001"〜"009" or "XXX"
        const modelId = `${type}${id}`;

        loadModelById(modelId);

        const u = new URL(location.href);
        u.searchParams.delete('scene');
        u.searchParams.delete('object');
        u.searchParams.set(type, id);
        history.pushState({ type, id }, '', u);

        contentEl.onclick = null;
        overlay.querySelector(CLOSE_ATTR)?.click();
      };

      const u = new URL(location.href);
      u.searchParams.set('panel', panel);
      history.pushState({ type: 'panel', panel }, '', u);
      return;
    }

    // ===== About =====
    if (panel === 'about') {
      titleEl.textContent = 'Locomotion™';
      contentEl.innerHTML = `
        <div class="about-grid">
          <img class="about-hero" src="about_image_1.jpeg" alt="">
          <div class="about-text">
            <h3>Locomotion™</h3>
            <p>This site items that contribute to everyday life. Everything is handmade.</p>
            <p style="margin-top:10px;font-weight:900">General Requires / Sales.</p>
            <p><a href="mailto:info@locomotion.com">info@locomotion.com</a></p>
          </div>
        </div>
      `;

      const u = new URL(location.href);
      u.searchParams.set('panel', panel);
      history.pushState({ type: 'panel', panel }, '', u);
      return;
    }

    // ===== Movie =====
    if (panel === 'movie') {
      titleEl.textContent = '';
      contentEl.innerHTML = `
        <div class="movie-frame">
          <video id="introMovie" autoplay muted loop playsinline preload="auto">
            <source src="intro.mp4" type="video/mp4" />
          </video>
        </div>
      `;

      const v = contentEl.querySelector('#introMovie');
      v?.play?.().catch(() => {});

      const unlock = () => {
        v?.play?.().catch(() => {});
        window.removeEventListener('pointerdown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });

      const u = new URL(location.href);
      u.searchParams.set('panel', panel);
      history.pushState({ type: 'panel', panel }, '', u);

      const tc = document.getElementById('trailCanvas');
      tc?.classList.add('on-top', 'force-visible');
      return;
    }

    // デフォルト
    titleEl.textContent = String(panel).toUpperCase();
    contentEl.innerHTML = `<p>${panel} content goes here</p>`;

    const u = new URL(location.href);
    u.searchParams.set('panel', panel);
    history.pushState({ type: 'panel', panel }, '', u);
  }

  function closePanel() {
    const closed = currentPanel;

    overlay.className = 'overlay';
    overlay.setAttribute('aria-hidden', 'true');
    contentEl.innerHTML = '';
    currentPanel = null;

    lockBody(false);
    setRenderPaused(false);

    if (closed === 'movie') {
      showGuideWindowOnce();
      const tc = document.getElementById('trailCanvas');
      tc?.classList.remove('on-top', 'force-visible');
    }

    const u = new URL(location.href);
    u.searchParams.delete('panel');
    history.pushState({ type: 'close-panel' }, '', u);
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-panel]');
    if (trigger) {
      e.preventDefault();
      openPanel(trigger.getAttribute('data-panel'));
      return;
    }

    if (e.target.matches(CLOSE_ATTR)) {
      e.preventDefault();
      closePanel();
      return;
    }

    if (e.target.classList.contains('overlay__backdrop') && currentPanel !== 'movie') {
      closePanel();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      if (currentPanel !== 'movie') closePanel();
    }
  });

  window.openOverlayPanel = openPanel;

  // ティッカークリックでmovie（PC側）
  (function wireTickerToMovie() {
    const ticker = document.querySelector('[data-ticker]');
    if (!ticker) return;

    let ticking = false;
    ticker.addEventListener(
      'click',
      (e) => {
        if (ticking) return;
        e.preventDefault();
        ticking = true;

        const u = new URL(location.href);
        u.searchParams.set('panel', 'movie');
        history.pushState({ type: 'panel', panel: 'movie' }, '', u);

        window.openOverlayPanel?.('movie');

        setTimeout(() => {
          ticking = false;
        }, 300);
      },
      { passive: false }
    );
  })();

  // URLに panel があったら開く
  if (pendingPanelToOpen) {
    window.openOverlayPanel(pendingPanelToOpen);
    pendingPanelToOpen = null;
  }
})();

/* =========================================================
   初回ロード時：panel指定が無ければmovieを開く
========================================================= */
window.addEventListener('load', () => {
  const u = new URL(location.href);
  if (!u.searchParams.get('panel')) {
    window.openOverlayPanel?.('movie');
  }
});

/* =========================================================
   SP: touchmove → mousemove を trail が拾えるように代理発火
========================================================= */
(function enableTrailOnTouch() {
  const isTrailOn = () =>
    document.body.classList.contains('trail-on') ||
    document.body.classList.contains('is-trail') ||
    document.body.classList.contains('has-trails');

  const getTargets = () => {
    const targets = [];
    const trail = document.getElementById('trailCanvas');
    const canvas = document.getElementById('canvas-home');
    if (trail) targets.push(trail);
    if (canvas) targets.push(canvas);
    targets.push(document);
    return targets;
  };

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!isTrailOn()) return;
      const t = e.touches && e.touches[0];
      if (!t) return;

      const evt = new MouseEvent('mousemove', {
        clientX: t.clientX,
        clientY: t.clientY,
        bubbles: true,
      });

      getTargets().forEach((el) => el.dispatchEvent(evt));
    },
    { passive: true }
  );
})();


document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pc-jump]');
  if (!btn) return;

  loadModelById(btn.dataset.pcJump);
});
