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
let shouldRestorePlusTextAfterLoading = false;

const scene = new THREE.Scene();
addCommonLights(scene);

const canvasEl = document.getElementById('canvas-home');
const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* =========================
   環境マップ (HDR)
========================= */
const rgbeLoader = new RGBELoader();
rgbeLoader.load('./assets/hdr/env.hdr', (hdrTex) => {
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
    glb: './assets/models/scene001_opt.glb',
    goObjectId: 'object001',
    scale: 0.7,
    margin: 0.7,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: 1.2, z: 0 },
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
  description: ``,
  location: [
    `Burnt site model: Sumber Rejo, Wirowongso, Ajung, Jember, East Java, Indonesia
-8.217939, 113.688243`,
    `Cabbage model: Whalley Range, Manchester, United Kingdom
53.447491, -2.257835`,
    `Pedestal model: Shimogyo Ward, Kyoto, Japan
35.003806, 135.762572`,
    `Statue model: Shimogyo Ward, Kyoto, Japan
35.003660, 135.766309`,
    `Plant model: Otabicho, Shimogyo Ward, Kyoto, Japan
35.003705, 135.768439`
  ],
  credit: [
    `Burnt site model by VariegatedBeacon528. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Cabbage model by UrsaMinor. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Pedestal model by SageDreamwalker1529. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Statue model by SageDreamwalker1529. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Plant model by SageDreamwalker1529. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
    
  },
  {
    id: 'scene002',
    glb: './assets/models/scene002_opt.glb',
    goObjectId: 'object002',
    scale: 0.13,
    margin: 1.1,
    centerMode: 'box',
    pivotOffset: { x: 0, y: -0.02, z: 0 },
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
    info: {
  title: 'scene002',
  description: ``,
  location: [
    `Concrete block model: 55 Boulevard de l'Europe, 31700 Beauzelle, France
43.662498, 1.366819`,
    `Burnt site model: Sumber Rejo, Wirowongso, Ajung, Jember, East Java, Indonesia
-8.217939, 113.688243`,
    `Toy sword model: Gong'an Village, Huwei Township, Yunlin County, Taiwan 632
23.711418, 120.435367`
  ],
  credit: [
    `Concrete block model by Syntax. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Burnt site model by VariegatedBeacon528. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Toy sword model by Linklub. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene003',
    glb: './assets/models/scene003_opt.glb',
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
    info: {
  title: 'scene003',
  description: ``,
  location: [
    `YMCA Ott Pool model: Broadway Proper, Tucson, Arizona, United States 85710
32.214190, -110.832093`
  ],
  credit: [
    `YMCA Ott Pool model by OmniPools. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene004',
    glb: './assets/models/scene004_opt.glb',
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
    info: {
  title: 'scene004',
  description: ``,
  location: [
    `Beach model: 16 Ocean Avenue, Skegness PE25 3DN, United Kingdom`
  ],
  credit: [
    `Beach model by MrBear711. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene005',
    glb: './assets/models/scene005_opt.glb',
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
    info: {
  title: 'scene005',
  description: ``,
  location: [
    `Plant and wall model: San Diego, California, United States`,
    `Cardboard model: South Park, Los Angeles, California, United States 90015
34.039350, -118.259872`,
    `Backpack model: Location unknown`
  ],
  credit: [
    `Plant and wall model by Chris. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Cardboard model by Jet_Blaque. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Backpack model by mischavyyy. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene006',
    glb: './assets/models/scene006_opt.glb',
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
    info: {
  title: 'scene006',
  description: ``,
  location: [
    `Feet model: 1396 Capital Drive, Fond du Lac, Wisconsin 54937, United States`,
    `Road model: Albemarle County, Virginia, United States
38.148513, -78.269106`
  ],
  credit: [
    `Feet model by OmniscientOwl1093. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Road model by Clayton56. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene007',
    glb: './assets/models/scene007_opt.glb',
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
    info: {
  title: 'scene007',
  description: ``,
  location: [
    `Goat and grassland model: Location unknown`
  ],
  credit: [
    `Goat and grassland model by SynapticJavelin3179. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene008',
    glb: './assets/models/scene008_opt.glb',
    goObjectId: 'object008',
    scale: 0.3,
    margin: 0.95,
    centerMode: 'sphere',
    pivotOffset: { x: 0.85, y: 1, z: 0 },
    cam: { pos: { x: 0, y: 1.5, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0001',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.1,
      margin: 1,
      centerMode: 'box',
      pivotOffset: { x: 0.5, y: 1.2, z: 0 },
      cam: { pos: { x: 0, y: 1, z: 3 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    },
    info: {
  title: 'scene008',
  description: ``,
  location: [
    `Goat and grassland model: Location unknown`
  ],
  credit: [
    `Goat and grassland model by SynapticJavelin3179. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },
  {
    id: 'scene009',
    glb: './assets/models/scene009_opt.glb',
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
    info: {
  title: 'scene009',
  description: ``,
  location: [
    `Seated person model: Chaim Levanon 8, Tel Aviv-Jaffa, Israel
32.104021, 34.798312`,
    `Branch model: Romania`
  ],
  credit: [
    `Seated person model by KinglyLantern6004. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`,
    `Branch model by Hmate. Used under CC BY 4.0. Modified and reconstructed by Locomotion™.`
  ]
}
  },

  /* ===== object 系 ===== */
{
  id: 'object001',
  glb: './assets/models/object001.glb',
  scale: 0.6,
  margin: 0.8,
  centerMode: 'sphere',
  offset: { x: 0, y: 0, z: 0 },
  pivotOffset: { x: 0, y: 0.0, z: 0 },
  cam: {
    pos: { x: 8.6, y: 4, z: -5.0 },
    target: { x: 0, y: 0, z: 0 },
    zoomMul: 1.0
  },

  clickMeshName: 'Mesh_0001',

  spin: {
    whole: true,
    wholeSpeed: 0.1,
    part: true,
    partName: 'Mesh_0',
    partSpeed: 1.0
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
  },

  info: {
    title: 'object001',

    poem:
      'In the heat of midday, white dust drifted down from a crumbling wall. Workers silently swung their hammers, dismantling the old building piece by piece. Car horns echoed through the street, while the smell of grilled meat drifted from a nearby shop. In the distance, the call to Adhān began to rise, and hot sand rode the wind, settling softly around my feet.',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

     productId:
      'object001',

    productName:
      'object001',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
},

  {
    id: 'object002',
    glb: './assets/models/object002.glb',
    scale: 0.7,
    margin: 1.0,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 6, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 0.8 },
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    
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
  },

    info: {
    title: 'object002',

    poem:
      'In a place where even the sound of birds could not reach, only the old steel beams held onto the heat. The roof, which had been baking all day, still glowed white even as evening fell, and the shards of glass scattered across the floor reflected the sky with a delayed glow. Deep inside the empty warehouse, a severed cable swayed in the wind, leaving behind a faint scraping sound with every movement.',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',
    
    productId:
      'object002',

    productName:
      'object002',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
   
  },

  {
    id: 'object003',
    glb: './assets/models/object003.glb',
    scale: 0.5,
    margin: 1.3,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 6.4, y: 1, z: -7.6 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    
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
  },
    
  info: {
    title: 'object003',

    poem:
      'On the highway visible in the distance, cars flow ceaselessly westward. An old man stands in the apartment hallway, staring intently at the lights. Is the Ford in the parking lot outside—which hasn’t moved in ages—his? The old man doesn’t light a cigarette; he just rolls the lighter between his fingers.',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',
    
    productId:
      'object003',

    productName:
      'object003',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
   
  },

  {
    id: 'object004',
    glb: './assets/models/object004.glb',
    scale: 0.5,
    margin: 0.9,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
 
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
  },

   info: {
    title: 'object004',

    poem:
      '“Where are you going once you get out of here?” “West.” “Everyone’s heading west.” “I hear the sky’s wider over there.” “Are you going to see the ocean or something?” “Probably.” “What do you mean, ‘probably’?” “I’ve never seen the ocean before.”',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

    productId:
      'object004',

    productName:
      'object004',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'object005',
    glb: './assets/models/object005.glb',
    scale: 0.7,
    margin: 1,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0013', partSpeed: 1.0 },
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
  },
   info: {
    title: 'object005',

    poem:
      '“Mint grew in the cracks, and the air always smelled of soup and soil. It was like a greenhouse that had been left untouched for a long time. There was a tea ring on the old table. Someone must have spent many long afternoons here.”',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

   productId:
      'object005',

    productName:
      'object005',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'object006',
    glb: './assets/models/object006.glb',
    scale: 0.5,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0013', partSpeed: 1.0 },
  
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
  },
   info: {
    title: 'object006',

    poem:
      '“After the fire had passed, the woman was searching for flowers in the church’s ash-covered garden, where restoration work had been completed. She crouched down and touched the soil. A cold dampness lingered on her fingertips. Just then, she heard the sound of a door opening behind her. When she turned around, a young restorer was looking at her. “Did you drop something?” The woman thought for a moment, then replied, “I’m looking for the flowers that used to bloom here.” The restorer was silent for a moment, then said, “After the fire, only weeds grow here now.””',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

    productId:
      'object006',

    productName:
      'object006',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'object007',
    glb: './assets/models/object007.glb',
    scale: 0.45,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 12.6, y: 4, z: -1.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
    
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
  },
     info: {
    title: 'object007',

    poem:
      '“After the snow melted, I found the bones of a small bird at the bottom of the forest. The feathers were gone, and only the slender white ribs stood out against the damp fallen leaves. I crouched there for a while, staring at those tiny bones. I couldn’t do anything.I just stared.””',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

    productId:
      'object007',

    productName:
      'object007',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'object008',
    glb: './assets/models/object008.glb',
    scale: 0.5,
    margin: 1.3,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 7, y: 2, z: 7.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },

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
  },
   info: {
    title: 'object008',

    poem:
      '“Three o’clock in the afternoon. I walk along the riverbank, the plastic bags from my shopping trip swaying in my hand.White futons are lined up on the balconies of the apartment complex across the way, waiting patiently to be brought inside once it gets dark. Once, long ago, I climbed up to the roof of that complex.Looking down at the city after a light rain, it seemed incredibly dull, as if it had been coated in layer upon layer of flat, gray paint.””',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

    productId:
      'object008',

    productName:
      'object008',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'object009',
    glb: './assets/models/object009.glb',
    scale: 0.55,
    margin: 0.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: -0.03, z: 0 },
    cam: { pos: { x: 10, y: 4, z: 0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0013',
    spin: { whole: true, wholeSpeed: 0.2, part: true, partName: 'Mesh_0', partSpeed: 1.0 },
  
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
  },
   info: {
    title: 'object009',

    poem:
      '“Before dawn, the station was shrouded in a white haze of coal smoke and cold fog. The long-distance train was two hours late. On the platform sat sleepy-eyed soldiers and families wrapped in blankets. The border was just a short distance away, and the checkpoints would open as soon as daybreak arrived. A mother touched her sleeping child’s forehead, and an old man silently stubbed out his cigarette. The sky began to lighten slightly. Beyond the gray snowfield, only a watchtower stood slenderly.””',

    material:
      'Block, code, resin',

    size:
      'W90 D90 H90',

    weight:
      '320g',

    productId:
      'object009',

    productName:
      'object009',

    price:
      32000,

    contact:
      '(/Buy/)',

    notes:
      'Do not get this object wet. Also, do not leave it in a humid place.'
  }
  },

  {
    id: 'objectXXX',
    glb: './assets/models/objectXXX.glb',
    scale: 0.6,
    margin: 0.8,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 8, y: 4, z: 8 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: { whole: true, wholeSpeed: 0.08 },

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
  },
  info: { 
    title: 'objectXXX', 
    lines: ['Details coming soon.'] }
  },
   
];

/* =========================================================
   Model / Camera Helpers
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
function closePcPlusText() {
  const btn = document.getElementById('pcPlusBtn');
  const text = document.getElementById('pcPlusText');

  if (!btn || !text) return;

  text.classList.remove('is-open');
  text.setAttribute('aria-hidden', 'true');
  btn.classList.remove('is-active');
}

function isPcPlusTextOpen() {
  const text = document.getElementById('pcPlusText');
  return !!text?.classList.contains('is-open');
}

function openPcPlusText() {
  const btn = document.getElementById('pcPlusBtn');
  const text = document.getElementById('pcPlusText');

  if (!btn || !text) return;

  updatePcPlusText();

  text.classList.add('is-open');
  text.setAttribute('aria-hidden', 'false');

  btn.classList.add('is-active');
}

function showModelLoading(id) {
  shouldRestorePlusTextAfterLoading = isPcPlusTextOpen();

  closePcPlusText();

  const el = document.getElementById('modelLoading');
  if (!el) return;

  el.classList.add('is-visible');
  el.setAttribute('aria-hidden', 'false');
}

function hideModelLoading() {
  const el = document.getElementById('modelLoading');
  if (!el) return;

  el.classList.remove('is-visible');
  el.setAttribute('aria-hidden', 'true');

  if (shouldRestorePlusTextAfterLoading) {
    openPcPlusText();
  }

  shouldRestorePlusTextAfterLoading = false;
}

/* =========================================================
   Model Loading / Scene Switching
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

  showModelLoading(id);

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
hideModelLoading();
if (pendingCheckoutMessage) {
  showCheckoutMessage(pendingCheckoutMessage);
  pendingCheckoutMessage = null;
}

    },
    undefined,
    (err) => {
  console.error('[GLTFLoader] failed:', item.glb, err);
  hideModelLoading();
}
  );
  
}

// 外部からも呼べるAPI
window.selectModel = loadModelById;

/* =========================================================
   Hover Highlight / Outline Effects
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
   3D Object Picking / Navigation
========================================================= */
function handlePickAt(ev) {
  if (document.body.classList.contains('modal-open')) return;

  const t = ev?.target;
  if (t && t.closest && t.closest('.topnav, .overlay, .sp-ui, .sp-bottom')) return;

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
   Render Loop / Animation
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
   PC / SP UI System
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
  const isObject = isObjectId(item.id);

  const title = info.title || item.id;

 const description =
  info.description ||
  info.poem ||
  info.lines?.[0] ||
  '';

  const location = Array.isArray(info.location)
    ? info.location.map((v) => `<div class="pc-info-item">${v}</div>`).join('')
    : info.location
      ? `<div class="pc-info-item">${info.location}</div>`
      : '';

  const credit = Array.isArray(info.credit)
    ? info.credit.map((v) => `<div class="pc-info-item">${v}</div>`).join('')
    : info.credit
      ? `<div class="pc-info-item">${info.credit}</div>`
      : '';

  const material = info.material || info.lines?.[3] || '';
  const size = info.size || info.lines?.[2] || '';
  const weight = info.weight || '';
  const price = info.price || '';
  const notes = info.notes || '';
  const contact = info.contact || info.lines?.[4] || 'Buy/Ask';
  const email = info.email || 'info@locomotion.com';

  panel.classList.toggle('is-scene001-info', item.id === 'scene001');
  panel.classList.toggle(
    'is-other-scene-info',
    isSceneId(item.id) && item.id !== 'scene001'
  );

  content.innerHTML = `
    <h2>${title}</h2>

    <p>${description}</p>

    ${location ? `<div class="pc-info-block"><strong>Location:</strong>${location}</div>` : ''}
    ${credit ? `<div class="pc-info-block"><strong>Credit:</strong>${credit}</div>` : ''}

    ${isObject && material ? `<p><strong>Material:</strong><br>${material}</p>` : ''}
    ${isObject && size ? `<p><strong>Size:</strong><br>${size}</p>` : ''}
    ${isObject && weight ? `<p><strong>Weight:</strong><br>${weight}</p>` : ''}
    ${
  isObject && price
    ? `<p><strong>Price:</strong><br>¥${Number(price).toLocaleString()}</p>`
    : ''
}

    ${isObject && notes ? `<p><strong>Important Notes:</strong><br>${notes}</p>` : ''}

${
  isObject
    ? `
      <p>
        <button
          class="buy-btn"
          data-product-id="${item.id}"
        >
          ${contact}
        </button>
      </p>
    `
    : ''
}
  `;

  const buyBtn = content.querySelector('.buy-btn');

buyBtn?.addEventListener('click', () => {
  addToCart(item.id);
openCartPanel();
});
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

    window.toggleStarTrail?.();

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
  <img src="./assets/images/about_image_1.jpeg" alt="">
`, 'explain');
  });

  privacyBtn?.addEventListener('click', (e) => {
  e.preventDefault();

  openPanel(privacyBtn, `
    <div class="legal-layout">
      <nav class="legal-tabs">
        <button class="legal-tab is-active" type="button" data-legal-tab="privacy">Privacy</button>
        <button class="legal-tab" type="button" data-legal-tab="terms">Terms</button>
        <button class="legal-tab" type="button" data-legal-tab="shipping">Shipping</button>
        <button class="legal-tab" type="button" data-legal-tab="refund">Refund</button>
        <button class="legal-tab" type="button" data-legal-tab="legal">Legal Notice</button>
      </nav>

      <div class="legal-text-wrap">
  <div class="legal-text legal-text-en" id="legalTextEn"></div>
  <div class="legal-text legal-text-jp" id="legalTextJp"></div>
</div>
    </div>
  `, 'privacy');

  const legalTextEn = document.getElementById('legalTextEn');
const legalTextJp = document.getElementById('legalTextJp');
  const tabs = document.querySelectorAll('.legal-tab');

  const texts = {
    privacy: {
      en:
      `
      <h2>Privacy Policy</h2>

<p>
Locomotion™ respects the privacy of visitors and customers and is committed to handling personal information responsibly.
This Privacy Policy explains what information may be collected through this website, how it is used, and how it is protected.
</p>

<p>
When placing an order, contacting us, or using this website, we may collect information including your name, email address, shipping address, payment-related information, and other information voluntarily provided by you.
</p>

<p>
We may also collect limited technical information such as browser type, device type, operating system, referring pages, and anonymous usage data in order to maintain, improve, and secure the website.
</p>

<p>
Personal information is used solely for purposes related to operating Locomotion™, including:
</p>

<p>
– Processing and fulfilling orders<br>
– Handling payments and transactions<br>
– Shipping products<br>
– Responding to inquiries<br>
– Maintaining and improving website functionality<br>
– Preventing fraud, abuse, or unauthorized access
</p>

<p>
Payments are processed through third-party payment providers such as Stripe. Locomotion™ does not directly store complete payment card information.
</p>

<p>
Personal information will not be sold, rented, or disclosed to unrelated third parties. Information may be shared only when necessary for payment processing, shipping services, legal compliance, or website operation.
</p>

<p>
Reasonable measures are taken to protect personal information from unauthorized access, alteration, disclosure, or destruction. However, no method of transmission or storage can be guaranteed to be completely secure.
</p>

<p>
You may request access to, correction of, or deletion of your personal information where permitted by applicable law.
</p>

<p>
Questions regarding this Privacy Policy may be directed to:
<br>
info@locomotion_service.com
</p>

<p>
This Privacy Policy may be updated from time to time without prior notice. The most current version will always be available on this website.
</p>
    `,
    jp: `
<h2 class="legal-hidden-title">
  プライバシーポリシー
</h2>

<p>
Locomotion™ は、お客様および本ウェブサイトを利用するすべての方のプライバシーを尊重し、個人情報を適切に取り扱うことを重要な責任と考えています。
本ポリシーは、本ウェブサイトを通じて取得する情報、その利用目的、および管理方法について説明するものです。
</p>

<p>
商品購入、お問い合わせ、その他本ウェブサイトの利用に際して、お客様の氏名、メールアドレス、配送先住所、決済に関連する情報、およびお客様が任意に提供する情報を取得する場合があります。
</p>

<p>
また、本ウェブサイトの維持・改善・安全性向上を目的として、ブラウザ情報、デバイス情報、アクセス履歴、参照元ページなどの技術的情報を取得する場合があります。
</p>

<p>
取得した情報は、以下の目的のために利用します。
</p>

<p>
・商品の受注および発送<br>
・決済処理および取引管理<br>
・お問い合わせへの対応<br>
・ウェブサイトの改善および運営<br>
・不正利用や不正アクセスの防止
</p>

<p>
決済は Stripe などの外部決済サービスを通じて行われます。Locomotion™ はクレジットカード番号等の完全な決済情報を保有しません。
</p>

<p>
個人情報を第三者へ販売、貸与することはありません。ただし、決済処理、配送業務、法令に基づく開示義務、またはサービス運営上必要な場合に限り、必要な範囲で第三者へ提供することがあります。
</p>

<p>
Locomotion™ は、個人情報への不正アクセス、改ざん、漏洩、紛失等を防止するため合理的な安全対策を講じます。ただし、インターネット上の通信や保存方法について完全な安全性を保証するものではありません。
</p>

<p>
法令の定める範囲において、お客様は自己の個人情報について開示、訂正、削除等を請求することができます。
</p>

<p>
本ポリシーに関するお問い合わせは以下までご連絡ください。<br>
info@locomotion_service.com
</p>

<p>
本ポリシーは予告なく変更される場合があります。変更後の内容は本ウェブサイト上に掲載された時点で効力を生じるものとします。
</p>
`
    },

    terms: {
      en: `
      <h2>Terms of Use</h2>

<p>
These Terms of Use govern access to and use of the Locomotion™ website and any purchases made through it.
By accessing this website, browsing its content, or placing an order, you agree to be bound by these Terms.
</p>

<p>
Locomotion™ presents scanned environments, handmade objects, digital artifacts, and related materials. Information, prices, product descriptions, and availability may be changed at any time without prior notice.
</p>

<p>
All products are offered subject to availability. Locomotion™ reserves the right to refuse, cancel, or limit any order when necessary, including in cases of pricing errors, technical issues, suspected fraud, or other circumstances that may affect fulfillment.
</p>

<p>
A purchase request submitted through this website does not automatically constitute acceptance of the order. A sales agreement is considered formed when payment is successfully completed and the order is accepted for fulfillment.
</p>

<p>
Users agree not to:
</p>

<p>
– Use the website for unlawful purposes<br>
– Interfere with website operation or security<br>
– Attempt unauthorized access to systems or data<br>
– Upload or transmit harmful code or software<br>
– Violate intellectual property rights belonging to Locomotion™ or third parties
</p>

<p>
Unless otherwise stated, all content on this website, including text, photographs, scans, 3D models, graphics, layouts, and other materials, remains the intellectual property of Locomotion™ or its respective rights holders.
</p>

<p>
The website and its contents are provided on an "as is" and "as available" basis. Locomotion™ makes no guarantee that the website will always be uninterrupted, error-free, or free from technical issues.
</p>

<p>
To the maximum extent permitted by law, Locomotion™ shall not be liable for indirect, incidental, consequential, or special damages arising from use of the website or products purchased through it.
</p>

<p>
Locomotion™ reserves the right to modify, suspend, discontinue, or update any part of the website, products, services, or these Terms at any time.
</p>

<p>
These Terms shall be governed by and interpreted in accordance with the laws of Japan.
</p>

<p>
Questions regarding these Terms may be directed to:
<br>
info@locomotion_service.com
</p>
    `,
    jp: `
<h2 class="legal-hidden-title">
利用規約</h2>

<p>
本利用規約は、Locomotion™ が運営するウェブサイトの利用および本ウェブサイトを通じた商品の購入に関する条件を定めるものです。
本ウェブサイトを利用し、閲覧し、または注文を行うことにより、お客様は本規約に同意したものとみなされます。
</p>

<p>
Locomotion™ は、3Dスキャンによる空間記録、手作業によるオブジェクト、デジタルアーカイブおよび関連作品を取り扱います。
商品情報、価格、仕様、在庫状況その他の情報は予告なく変更される場合があります。
</p>

<p>
すべての商品は在庫状況および制作状況に応じて販売されます。
価格表示の誤り、システム障害、不正利用の疑い、その他販売継続が困難であると判断した場合、Locomotion™ は注文の取消し、拒否、または数量制限を行う権利を有します。
</p>

<p>
本ウェブサイト上で注文が行われた時点では、売買契約は成立していません。
決済が正常に完了し、Locomotion™ が注文を受理した時点で売買契約が成立するものとします。
</p>

<p>
利用者は以下の行為を行ってはなりません。
</p>

<p>
・法令または公序良俗に反する行為<br>
・本ウェブサイトの運営を妨害する行為<br>
・不正アクセスまたはシステム侵入を試みる行為<br>
・有害なプログラムやデータの送信<br>
・Locomotion™ または第三者の知的財産権を侵害する行為
</p>

<p>
本ウェブサイトに掲載される文章、写真、3Dモデル、図版、レイアウト、その他のコンテンツに関する権利は、特別な記載がない限り Locomotion™ または正当な権利者に帰属します。
</p>

<p>
本ウェブサイトおよび掲載情報は現状有姿で提供されます。
Locomotion™ は、サイトが常に利用可能であること、エラーが存在しないこと、または中断なく利用できることを保証しません。
</p>

<p>
法令で認められる最大限の範囲において、Locomotion™ は本ウェブサイトの利用または商品の利用に関連して生じた間接的損害、付随的損害、特別損害について責任を負いません。
</p>

<p>
Locomotion™ は必要に応じて、本ウェブサイト、サービス、商品内容、および本規約を変更、中断、終了することができます。
</p>

<p>
本規約は日本法に準拠し、日本法に基づいて解釈されます。
</p>

<p>
本規約に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion_service.com
</p>
`
    },

    shipping: {
      en: `
      <h2>Shipping Policy</h2>

<p>
Locomotion™ ships physical objects and related products from Japan.
All orders are processed individually and prepared by hand.
</p>

<p>
Orders will generally be prepared for shipment after payment has been successfully confirmed.
Because some products are produced, finished, or packaged individually, processing times may vary depending on the nature of the work and current order volume.
</p>

<p>
At present, shipping is available within Japan only.
International shipping may become available in the future, but is not currently supported through this website.
</p>

<p>
Estimated shipping times are provided as a general reference only and are not guaranteed.
Delays may occur due to production schedules, weather conditions, transportation disruptions, holidays, or other circumstances beyond our control.
</p>

<p>
Customers are responsible for providing accurate shipping information at checkout.
Locomotion™ is not responsible for delays, failed deliveries, or additional costs resulting from incorrect or incomplete address information.
</p>

<p>
If a shipment is returned due to an incorrect address, refusal of delivery, or failure to receive the package, additional shipping charges may be required before the order can be resent.
</p>

<p>
Risk of loss and responsibility for purchased products passes to the customer upon delivery to the shipping address provided during checkout.
</p>

<p>
Questions regarding shipping may be directed to:
<br>
info@locomotion_service.com
</p>
    `,
    jp: `
    <h2 class="legal-hidden-title">
  配送ポリシー
</h2>

<p>
Locomotion™ は日本国内より商品を発送しています。
すべての注文は個別に確認され、手作業で梱包および発送準備が行われます。
</p>

<p>
ご注文いただいた商品は、決済確認後に発送準備を開始いたします。
作品の性質上、制作・仕上げ・梱包を個別に行う場合があり、発送までの日数は商品内容や注文状況によって異なる場合があります。
</p>

<p>
現在、本ウェブサイトからの注文については日本国内への配送のみ対応しています。
海外配送については将来的に対応する可能性がありますが、現時点では提供しておりません。
</p>

<p>
配送予定日数は目安であり、到着を保証するものではありません。
天候、交通状況、配送会社の事情、祝祭日、制作状況その他の要因により遅延が発生する場合があります。
</p>

<p>
お客様は注文時に正確な配送先情報を入力する責任を負います。
住所の誤入力、不完全な住所情報、受取人情報の不備等により生じた配送遅延や配送不能について、Locomotion™ は責任を負いません。
</p>

<p>
住所不備、受取拒否、長期不在等により商品が返送された場合、再発送にかかる費用を別途ご負担いただく場合があります。
</p>

<p>
商品の紛失・破損等に関する責任は、配送先への配達完了時点でお客様へ移転するものとします。
</p>

<p>
配送に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion_service.com
</p>`
    },

    refund: {
      en: `
      <h2>Refund Policy</h2>

<p>
Locomotion™ primarily offers handmade objects, limited-edition works, scanned artifacts, and products produced in small quantities.
Due to the nature of these products, all sales are generally considered final.
</p>

<p>
Returns, exchanges, cancellations, or refunds are not accepted for reasons including change of mind, personal preference, mistaken purchase, or circumstances unrelated to product condition.
</p>

<p>
If an item arrives damaged during shipping, arrives with a significant manufacturing defect, or differs substantially from the product description, please contact us within three (3) days of receiving the item.
</p>

<p>
When requesting assistance, please include:
</p>

<p>
– Your name<br>
– Order information<br>
– Photographs showing the condition of the item and packaging
</p>

<p>
Each request will be reviewed individually.
If Locomotion™ determines that the product was damaged prior to delivery or does not reasonably match the description provided on the website, an appropriate remedy may be offered, including replacement, repair, store credit, or refund.
</p>

<p>
Refunds or replacements will not be provided for damage resulting from improper handling, storage, modification, misuse, accidental damage after delivery, or normal aging of materials.
</p>

<p>
Because many products incorporate natural materials, handmade processes, scanning artifacts, irregular surfaces, color variations, or unique production characteristics, minor variations should not be considered defects.
</p>

<p>
Questions regarding refunds may be directed to:
<br>
info@locomotion_service.com
</p>
    `,
    jp:`
    <h2 class="legal-hidden-title">
  返金ポリシー
</h2>

<p>
Locomotion™ では、手作業による作品、一点物、少量生産品、3Dスキャンに関連する制作物などを主に取り扱っています。
これらの商品の性質上、原則としてすべての販売は最終的なものとし、購入後の返品・交換・返金はお受けしておりません。
</p>

<p>
お客様都合による返品、交換、キャンセル、返金（イメージ違い、注文間違い、不要になった等）はお受けできません。
</p>

<p>
ただし、商品到着時に著しい破損が認められる場合、重大な製造上の欠陥が存在する場合、または商品説明と著しく異なる場合には、商品到着後3日以内にご連絡ください。
</p>

<p>
お問い合わせの際は、以下の情報をご用意ください。
</p>

<p>
・お名前<br>
・注文情報<br>
・商品の状態が確認できる写真<br>
・梱包状態が確認できる写真
</p>

<p>
ご連絡内容を確認のうえ、Locomotion™ が妥当と判断した場合には、交換、修理、返金その他適切な対応を行います。
</p>

<p>
お客様による誤使用、改造、保管不備、落下・衝撃による破損、経年変化等については返金または交換の対象となりません。
</p>

<p>
天然素材や手作業による制作工程を含む作品については、色味、形状、質感、表面状態等に個体差が生じる場合がありますが、これらは不良品とはみなしません。
</p>

<p>
返金・交換に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion_service.com
</p>`
    },

    legal: {
      en:  `
      <h2>Legal Notice</h2>

<p>
Business Name:
<br>
Locomotion™
</p>

<p>
Representative:
<br>
Issei Kouda
</p>

<p>
Address:
<br>
Available upon request
</p>

<p>
Phone:
<br>
Available upon request
</p>

<p>
Email:
<br>
info@locomotion_service.com
</p>

<p>
Sales Price:
<br>
Displayed on each product page.
</p>

<p>
Additional Fees:
<br>
Shipping fees and any applicable charges are displayed during checkout when applicable.
</p>

<p>
Payment Methods:
<br>
Credit card payments and other payment methods supported by Stripe Checkout.
</p>

<p>
Payment Timing:
<br>
Payment is processed at the time the order is placed through the checkout system.
</p>

<p>
Order Acceptance:
<br>
An order is considered accepted after successful payment processing and confirmation by Locomotion™.
</p>

<p>
Delivery:
<br>
Products are shipped after payment confirmation.
Shipping times may vary depending on product type, production schedule, and shipping conditions.
</p>

<p>
Returns and Refunds:
<br>
Please refer to the Refund Policy for details regarding returns, exchanges, and refunds.
</p>

<p>
Website:
<br>
Locomotion™
</p>
    `,
    jp: `
    <h2 class="legal-hidden-title">
  特定商取引法に基づく表記
</h2>

<p>
販売事業者名<br>
Locomotion™
</p>

<p>
代表責任者<br>
Issei Kouda
</p>

<p>
所在地<br>
請求があった場合、遅滞なく開示いたします。
</p>

<p>
電話番号<br>
請求があった場合、遅滞なく開示いたします。
</p>

<p>
メールアドレス<br>
info@locomotion_service.com
</p>

<p>
販売価格<br>
各商品ページに表示された価格（税込）
</p>

<p>
商品代金以外の必要料金<br>
送料その他必要な費用が発生する場合は、決済時に表示します。
</p>

<p>
支払方法<br>
Stripe Checkout が対応する決済方法
</p>

<p>
支払時期<br>
注文時に決済が行われます。
</p>

<p>
商品の引渡時期<br>
決済確認後、発送準備を行い順次発送いたします。
</p>

<p>
返品・交換・キャンセルについて<br>
詳細は返金ポリシーをご確認ください。
</p>

<p>
ウェブサイト<br>
Locomotion™
</p>`
    },
  };
function setLegalTab(key) {
  legalTextEn.innerHTML = texts[key].en;
  legalTextJp.innerHTML = texts[key].jp;

  tabs.forEach((tab) => {
    tab.classList.toggle(
      'is-active',
      tab.dataset.legalTab === key
    );
  });
}

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setLegalTab(tab.dataset.legalTab);
    });
  });

  setLegalTab('privacy');
});

  close?.addEventListener('click', (e) => {
    e.preventDefault();
    closePanel();
  });
})();

/* =========================================================
   Cart UI
========================================================= */

let pendingCheckoutMessage = null;

const CART_STORAGE_KEY = 'locomotion_cart';

function showCheckoutMessage(type) {
  const btn = document.getElementById('pcPlusBtn');
  const text = document.getElementById('pcPlusText');

  if (!text) return;

  if (type === 'success') {
  text.innerHTML = `
    <p>(Thank you for your order.)</p>
  `;
}

if (type === 'cancel') {
  text.innerHTML = `
    <p>(Checkout was canceled.)</p>
  `;
}

  text.classList.add('is-open');
  text.setAttribute('aria-hidden', 'false');
  btn?.classList.add('is-active');

  setTimeout(() => {
    text.classList.remove('is-open');
    text.setAttribute('aria-hidden', 'true');
    btn?.classList.remove('is-active');

    updatePcPlusText();
  }, 5000);
}

function handleCheckoutResult() {
  const url = new URL(window.location.href);
  const checkout = url.searchParams.get('checkout');

  if (checkout === 'success') {
  localStorage.removeItem(CART_STORAGE_KEY);
  renderCart();
  updateCartCount();

  pendingCheckoutMessage = 'success';

  url.searchParams.delete('checkout');
  window.history.replaceState({}, '', url);
  return;
}

if (checkout === 'cancel') {
  pendingCheckoutMessage = 'cancel';

  url.searchParams.delete('checkout');
  window.history.replaceState({}, '', url);
}
}


function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function addToCart(productId) {
  const cart = getCart();

  const existing = cart.find((item) => item.productId === productId);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      productId,
      quantity: 1,
    });
  }

  saveCart(cart);
renderCart();
updateCartCount();

  console.log('cart:', cart);
}
function updateCartQuantity(productId, delta) {
  const cart = getCart();

  const item = cart.find(
    (item) => item.productId === productId
  );

  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }

  saveCart(cart);
  renderCart();
  updateCartCount();
}

function removeFromCart(productId) {
  const cart = getCart().filter(
    (item) => item.productId !== productId
  );

  saveCart(cart);
  renderCart();
  updateCartCount();

  console.log('cart:', cart);
}

function updateCartCount() {
  const cartBtn = document.querySelector('.pc-cart-btn');
  if (!cartBtn) return;

  const countEl = cartBtn.querySelector('.pc-cart-count');
  if (!countEl) return;

  const count = getCart().reduce((sum, item) => {
    return sum + item.quantity;
  }, 0);

  countEl.textContent = count > 0 ? String(count) : '';
  cartBtn.classList.toggle('has-count', count > 0);
}

function renderCart() {
  const cartItems = document.getElementById('cartItems');
  if (!cartItems) return;

  const cart = getCart();

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <p>Your cart is empty.</p>
    `;
    return;
  }

  const total = cart.reduce((sum, item) => {
  const model = MODELS.find(
    (m) => m.info?.productId === item.productId
  );

  const price = Number(model?.info?.price || 0);

  return sum + price * item.quantity;
}, 0);

  cartItems.innerHTML = cart
  .map((item) => {

    const model = MODELS.find(
      (m) => m.info?.productId === item.productId
    );

    const name =
      model?.info?.productName || item.productId;

    const price =
      model?.info?.price || 0;

    return `
  <div class="cart-item">
    <div>${name}</div>
    <div>¥${Number(price).toLocaleString()}</div>
    <div class="cart-qty-row">
  <button
    class="cart-qty-btn"
    data-minus="${item.productId}"
  >
    −
  </button>

  <span>
    ${item.quantity}
  </span>

  <button
    class="cart-qty-btn"
    data-plus="${item.productId}"
  >
    +
  </button>
</div>
    <button
      class="cart-remove-btn"
      type="button"
      data-product-id="${item.productId}"
    >
      remove
    </button>
  </div>
`;
  })
  .join('') +
  `
    <div class="cart-total">
      <div>Total</div>
      <div>¥${total.toLocaleString()}</div>
    </div>
  `;


cartItems.querySelectorAll('.cart-remove-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    removeFromCart(btn.dataset.productId);
  });
});

cartItems.querySelectorAll('[data-minus]').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateCartQuantity(btn.dataset.minus, -1);
  });
});

cartItems.querySelectorAll('[data-plus]').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateCartQuantity(btn.dataset.plus, 1);
  });
});
}


function openCartPanel() {
  const panel = document.getElementById('cartPanel');
  const cartBtn = document.querySelector('.pc-cart-btn');

  if (!panel) return;

  renderCart();

  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');

  cartBtn?.classList.add('is-active');
}

function closeCartPanel() {
  const panel = document.getElementById('cartPanel');
  const cartBtn = document.querySelector('.pc-cart-btn');

  if (!panel) return;

  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');

  cartBtn?.classList.remove('is-active');
}
async function goToCheckout() {
  const cart = getCart();

  if (!cart.length) {
    alert('Cart is empty');
    return;
  }

  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ items: cart })
  });

  const data = await res.json();

  if (data.url) {
    window.location.href = data.url;
  } else {
    alert('Checkout failed');
    console.error(data);
  }
}

(function wireCartPanel() {
  const cartBtn = document.querySelector('.pc-cart-btn');
  const closeBtn = document.getElementById('cartClose');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');

  cartBtn?.addEventListener('click', (e) => {
    e.preventDefault();

    const panel = document.getElementById('cartPanel');
    const isOpen = panel?.classList.contains('is-open');

    if (isOpen) closeCartPanel();
    else openCartPanel();
  });

  closeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeCartPanel();
  });

  checkoutBtn?.addEventListener('click', goToCheckout);

})();
updateCartCount();
handleCheckoutResult();

function updatePcUiHeights() {
  const topUi = document.querySelector('.pc-flat-ui');
  const bottomUi = document.querySelector('.pc-bottom-links');

  const topHeight = topUi ? topUi.offsetHeight : 96;
  const bottomHeight = bottomUi ? bottomUi.offsetHeight : 48;

  document.documentElement.style.setProperty(
    '--pc-top-ui-height',
    `${topHeight}px`
  );

  document.documentElement.style.setProperty(
    '--pc-bottom-ui-height',
    `${bottomHeight}px`
  );
}

updatePcUiHeights();
window.addEventListener('resize', updatePcUiHeights);

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
   Overlay / Modal System
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

    console.warn('[overlay] unknown panel:', panel);
return;

  }

  function closePanel() {
    const closed = currentPanel;

    overlay.className = 'overlay';
    overlay.setAttribute('aria-hidden', 'true');
    contentEl.innerHTML = '';
    currentPanel = null;

    lockBody(false);
    setRenderPaused(false);

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

    if (e.target.classList.contains('overlay__backdrop')) {
  closePanel();
}
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
  closePanel();
}
  });

  window.openOverlayPanel = openPanel;

  // URLに panel があったら開く
  if (pendingPanelToOpen) {
    window.openOverlayPanel(pendingPanelToOpen);
    pendingPanelToOpen = null;
  }
})();


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

function updateSpUiHeights() {
  const topUi = document.querySelector('.pc-flat-ui');
  const bottomUi = document.querySelector('.pc-bottom-links');

  const topH = topUi ? topUi.getBoundingClientRect().height : 120;
  const bottomH = bottomUi ? bottomUi.getBoundingClientRect().height : 48;

  document.documentElement.style.setProperty('--sp-top-ui-height', `${topH}px`);
  document.documentElement.style.setProperty('--sp-bottom-ui-height', `${bottomH}px`);
}

updateSpUiHeights();
window.addEventListener('resize', updateSpUiHeights);
window.addEventListener('orientationchange', updateSpUiHeights);

