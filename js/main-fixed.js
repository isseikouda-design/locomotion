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

const aboutImagePreload = new Image();
aboutImagePreload.src = './assets/images/about_image_1.webp';

if (aboutImagePreload.decode) {
  aboutImagePreload.decode().catch(() => {
    // Safariなどでdecodeに失敗しても通常読み込みへ任せる
  });
}

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
controls.minZoom = 0.1;
controls.maxZoom = 20;
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
    margin: 1.7,
    centerMode: 'box',
    pivotOffset: { x: 0, y: -0.02, z: 0 },
    cam: { pos: { x: -20, y: 8, z: -6 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0008',
    spin: { part: true, whole: true, partName: 'Mesh_0008', partSpeed: 0.7, wholeSpeed: 0.03 },
    sp: {
      scale: 0.35,
      margin: 1.3,
      centerMode: 'box',
      pivotOffset: { x: -0.1, y: 0, z: 0 },
      cam: { pos: { x: -6, y: 11, z: -12 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
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
      margin: 0.7,
      centerMode: 'box',
      pivotOffset: { x: 0, y: -0.3, z: 0 },
      cam: { pos: { x: -12, y: 13, z: -5 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
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
    margin: 1.3,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 4.5, z: 10.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0001',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.65,
      margin: 1.1,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0, z: 0 },
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
    margin: 1.8,
    centerMode: 'sphere',
    pivotOffset: { x: 0, y: -0.03, z: 0 },
    cam: { pos: { x: 5.3, y: 2, z: 5.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0',
    spin: { part: true, whole: true, partName: 'Mesh_0', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.18,
      margin: 1,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0, z: 0 },
      cam: { pos: { x: 3, y: 4, z: 5.4 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
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

  pivotOffset: { x: 0, y: 0, z: 0 },

  screenOffset: { x: 0.13, y: -0.08 },

  cam: {
    pos: { x: 9.3, y: 4, z: 3.2 },
    target: { x: 0, y: 0, z: 0 },
    zoomMul: 1.0
  },

  clickMeshName: 'Mesh_0004',
  spin: {
    part: true,
    whole: true,
    partName: 'Mesh_0004',
    partSpeed: 1.0,
    wholeSpeed: 0.03
  },
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
      margin: 0.85,
      centerMode: 'sphere',
      pivotOffset: { x: 0.03, y: 0, z: 0 },
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
    pivotOffset: { x: 0.15, y: 1, z: 0 },
    cam: { pos: { x: 0, y: 1.5, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    clickMeshName: 'Mesh_0001',
    spin: { part: true, whole: true, partName: 'Mesh_0001', partSpeed: 1.0, wholeSpeed: 0.03 },
    sp: {
      scale: 0.1,
      margin: 0.9,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0, z: 0 },
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
      margin: 0.8,
      centerMode: 'box',
      pivotOffset: { x: 0, y: 0, z: 0 },
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
  margin: 2.2,
  centerMode: 'sphere',
  offset: { x: 0, y: 0, z: 0 },
  pivotOffset: { x: 0, y: 0.0, z: 0 },
  cam: {
    pos: { x: 8.6, y: 4, z: -5.0 },
    target: { x: 0, y: 0, z: 0 },
    zoomMul: 1.0
  },

 spin: {
  whole: true,
  wholeSpeed: 0.1,
  part: false
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
      'W105 D100 H32',

    weight:
      '500g',

     productId:
      'object001',

    productName:
      'object001',

    price:
      32000,

      isUnique: true,

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
    margin: 1.7,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 6, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 0.8 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },

    info: {
    title: 'object002',

    poem:
      'In a place where even the sound of birds could not reach, only the old steel beams held onto the heat. The roof, which had been baking all day, still glowed white even as evening fell, and the shards of glass scattered across the floor reflected the sky with a delayed glow. Deep inside the empty warehouse, a severed cable swayed in the wind, leaving behind a faint scraping sound with every movement.',

    material:
      'Block, code, resin',

    size:
      'W75 D50 H100',

    weight:
      '380g',
    
    productId:
      'object002',

    productName:
      'object002',

    price:
      22000,

      isUnique: true,

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
  margin: 2.2,
  centerMode: 'sphere',
  offset: { x: 0, y: 0, z: 0 },
  pivotOffset: { x: 0, y: 0.0, z: 0 },

  cam: {
    pos: { x: 6.4, y: 1, z: -7.6 },
    target: { x: 0, y: 0, z: 0 },
    zoomMul: 1.0
  },

  spin: {
    whole: true,
    wholeSpeed: 0.2,
    part: false
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
  },

  info: {
    title: 'object003',

    poem:
      'On the highway visible in the distance, cars flow ceaselessly westward. An old man stands in the apartment hallway, staring intently at the lights. Is the Ford in the parking lot outside—which hasn’t moved in ages—his? The old man doesn’t light a cigarette; he just rolls the lighter between his fingers.',

    material:
      'Block, code, resin',

    size:
      'W105 D40 H105',

    weight:
      '436g',

    productId:
      'object003',

    productName:
      'object003',

    price:
      18000,

    isUnique: true,

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
    margin: 1.8,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },

   info: {
    title: 'object004',

    poem:
      '“Where are you going once you get out of here?” “West.” “Everyone’s heading west.” “I hear the sky’s wider over there.” “Are you going to see the ocean or something?” “Probably.” “What do you mean, ‘probably’?” “I’ve never seen the ocean before.”',

    material:
      'Block, code, resin',

    size:
      'W70 D25 H95',

    weight:
      '292g',

    productId:
      'object004',

    productName:
      'object004',

    price:
      16000,

      isUnique: true,

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
    margin: 2,
    centerMode: 'sphere',
    offset: { x: 0, y: -0.03, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 15, y: 10, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },
   info: {
    title: 'object005',

    poem:
      '“Mint grew in the cracks, and the air always smelled of soup and soil. It was like a greenhouse that had been left untouched for a long time. There was a tea ring on the old table. Someone must have spent many long afternoons here.”',

    material:
      'Block, code, resin',

    size:
      'W130 D40 H130',

    weight:
      '667g',

   productId:
      'object005',

    productName:
      'object005',

    price:
      42000,

      isUnique: true,

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
    margin: 2.4,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 0, y: 4, z: 10 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },
   info: {
    title: 'object006',

    poem:
      '“After the fire had passed, the woman was searching for flowers in the church’s ash-covered garden, where restoration work had been completed. She crouched down and touched the soil. A cold dampness lingered on her fingertips. Just then, she heard the sound of a door opening behind her. When she turned around, a young restorer was looking at her. “Did you drop something?” The woman thought for a moment, then replied, “I’m looking for the flowers that used to bloom here.” The restorer was silent for a moment, then said, “After the fire, only weeds grow here now.””',

    material:
      'Block, code, resin',

    size:
      'W92 D60 H98',

    weight:
      '870g',

    productId:
      'object006',

    productName:
      'object006',

    price:
      32000,

      isUnique: true,

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
    margin: 1.1,
    centerMode: 'sphere',
    offset: { x: 0, y: -0.02, z: 0 },
    pivotOffset: { x: 0, y: 0.0, z: 0 },
    cam: { pos: { x: 12.6, y: 4, z: -1.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },
     info: {
    title: 'object007',

    poem:
      '“After the snow melted, I found the bones of a small bird at the bottom of the forest. The feathers were gone, and only the slender white ribs stood out against the damp fallen leaves. I crouched there for a while, staring at those tiny bones. I couldn’t do anything.I just stared.””',

    material:
      'Block, code, resin',

    size:
      'W145 D40 H140',

    weight:
      '1374g',

    productId:
      'object007',

    productName:
      'object007',

    price:
      34000,

      isUnique: true,

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
    margin: 2.2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: 0, z: 0 },
    cam: { pos: { x: 7, y: 2, z: 7.0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },
   info: {
    title: 'object008',

    poem:
      '“Three o’clock in the afternoon. I walk along the riverbank, the plastic bags from my shopping trip swaying in my hand.White futons are lined up on the balconies of the apartment complex across the way, waiting patiently to be brought inside once it gets dark. Once, long ago, I climbed up to the roof of that complex.Looking down at the city after a light rain, it seemed incredibly dull, as if it had been coated in layer upon layer of flat, gray paint.””',

    material:
      'Block, code, resin',

    size:
      'W100 D43 H115',

    weight:
      '807g',

    productId:
      'object008',

    productName:
      'object008',

    price:
      22000,

      isUnique: true,

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
    margin: 2.2,
    centerMode: 'sphere',
    offset: { x: 0, y: 0, z: 0 },
    pivotOffset: { x: 0, y: -0.03, z: 0 },
    cam: { pos: { x: 10, y: 4, z: 0 }, target: { x: 0, y: 0, z: 0 }, zoomMul: 1.0 },
    spin: {
  whole: true,
  wholeSpeed: 0.2,
  part: false
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
  },
   info: {
    title: 'object009',

    poem:
      '“Before dawn, the station was shrouded in a white haze of coal smoke and cold fog. The long-distance train was two hours late. On the platform sat sleepy-eyed soldiers and families wrapped in blankets. The border was just a short distance away, and the checkpoints would open as soon as daybreak arrived. A mother touched her sleeping child’s forehead, and an old man silently stubbed out his cigarette. The sky began to lighten slightly. Beyond the gray snowfield, only a watchtower stood slenderly.””',

    material:
      'Block, code, resin',

    size:
      'W85 D73 H88',

    weight:
      '412g',

    productId:
      'object009',

    productName:
      'object009',

    price:
      22000,

      isUnique: true,

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
function applyCameraScreenOffset(item) {
  const offset = item?.screenOffset;

  // screenOffsetがないモデルでは、必ず通常表示へ戻す
  if (!offset) {
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const offsetX = Math.round(width * (offset.x || 0));
  const offsetY = Math.round(height * (offset.y || 0));

  camera.setViewOffset(
    width,
    height,
    offsetX,
    offsetY,
    width,
    height
  );

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
function updateModelLoadingPercent(percent) {
  const percentEl = document.getElementById('modelLoadingPercent');
  if (!percentEl) return;

  const safePercent = Math.max(
    0,
    Math.min(100, Math.round(percent))
  );

  percentEl.textContent = `${safePercent}%`;
}
function showModelLoading(id) {
  shouldRestorePlusTextAfterLoading = isPcPlusTextOpen();

  closePcPlusText();

  const el = document.getElementById('modelLoading');
  if (!el) return;

  updateModelLoadingPercent(0);

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

const infoPanel = document.getElementById('pcInfoPanel');
const shouldRenderInfo =
  infoPanel?.classList.contains('is-scene') ||
  infoPanel?.classList.contains('is-object-info');

if (shouldRenderInfo) {
  renderPcInfo(item);
}

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

applyCameraScreenOffset(isMobile ? null : item);

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
      clock.getDelta();

   

      updateModelLoadingPercent(100);
      hideModelLoading();
      

      if (pendingCheckoutMessage) {
        showCheckoutMessage(pendingCheckoutMessage);
        pendingCheckoutMessage = null;
      }
    },

    (progressEvent) => {
      if (requestId !== loadRequestId) return;

      if (progressEvent.total > 0) {
        const percent =
          (progressEvent.loaded / progressEvent.total) * 100;

        updateModelLoadingPercent(percent);
      }
    },

    (err) => {
      console.error('[GLTFLoader] failed:', item.glb, err);
      hideModelLoading();
    }
  );
}
const homeBtn = document.getElementById('homeBtn');

homeBtn?.addEventListener('click', () => {
  loadModelById('scene001');
});

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

/*
 * Objectページでは、モデル全体をクリック対象にする。
 * Sceneページのようなページ遷移は行わず、情報パネルを開く。
 */
if (
  currentItem &&
  currentItem.id.startsWith('object') &&
  currentModel
) {
  const modelHits = raycaster.intersectObject(currentModel, true);

  if (modelHits.length > 0) {
    window.openCurrentItemInfoPanel?.();
  }

  return;
}

/*
 * Sceneページでは、これまで通り
 * userData.goto / userData.URL を持つ部分をクリック対象にする。
 */
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

/* =========================================================
   Click / Drag判定
   軽いクリック・タップだけPickingを実行する
========================================================= */
const pickGesture = {
  pointerId: null,
  startX: 0,
  startY: 0,
  didDrag: false,
  multiTouch: false
};

const PICK_DRAG_THRESHOLD = 8;

renderer.domElement.addEventListener('pointerdown', (event) => {
  /*
   * すでに別のPointerが押されている場合は、
   * ピンチ操作などの複数タッチと判断する。
   */
  if (
    pickGesture.pointerId !== null &&
    pickGesture.pointerId !== event.pointerId
  ) {
    pickGesture.multiTouch = true;
    pickGesture.didDrag = true;
    return;
  }

  pickGesture.pointerId = event.pointerId;
  pickGesture.startX = event.clientX;
  pickGesture.startY = event.clientY;
  pickGesture.didDrag = false;
  pickGesture.multiTouch = false;
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerId !== pickGesture.pointerId) return;

  const dx = event.clientX - pickGesture.startX;
  const dy = event.clientY - pickGesture.startY;
  const distance = Math.hypot(dx, dy);

  if (distance > PICK_DRAG_THRESHOLD) {
    pickGesture.didDrag = true;
  }
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.pointerId !== pickGesture.pointerId) return;

  const shouldPick =
    !pickGesture.didDrag &&
    !pickGesture.multiTouch;

  pickGesture.pointerId = null;
  pickGesture.didDrag = false;
  pickGesture.multiTouch = false;

  if (!shouldPick) return;

  handlePickAt(event);
});

renderer.domElement.addEventListener('pointercancel', () => {
  pickGesture.pointerId = null;
  pickGesture.didDrag = false;
  pickGesture.multiTouch = false;
});
/* =========================================================
   Render Loop / Animation
========================================================= */
function animate() {
  requestAnimationFrame(animate);

  const rawDt = clock.getDelta();

  if (renderPaused || document.hidden) {
    return;
  }

  // Safariの非表示・先読み後に大きな時間差が入るのを防ぐ
  const dt = Math.min(rawDt, 0.05);

  const isMobile = window.innerWidth <= 768;

  // 全体回転（pivot）
  if (pivot.children.length && currentItem?.spin?.whole) {
    const s = currentItem.spin.wholeSpeed ?? rotSpeed;
    const axis =
      (isMobile && currentItem.spin.axisSp) ||
      currentItem.spin.axis ||
      'y';

    if (axis === 'x') pivot.rotation.x += dt * s;
    else if (axis === 'z') pivot.rotation.z += dt * s;
    else pivot.rotation.y += dt * s;
  }

  // 以下、既存の部分回転処理

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

async function fetchProductStatus(productId) {
  const res = await fetch(
    `/api/product-status?productId=${encodeURIComponent(productId)}`,
    {
      cache: 'no-store',
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.error || `Failed to get product status: ${productId}`
    );
  }

  return data.status;
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
  const email = info.email || 'info@locomotion-services.com';

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
      <p class="purchase-status">
        <button
          class="buy-btn"
          data-product-id="${item.id}"
          type="button"
          disabled
        >
          Checking availability...
        </button>
      </p>
    `
    : ''
}
  `;

 const buyBtn = content.querySelector('.buy-btn');

if (isObject && buyBtn) {
  fetchProductStatus(item.id)
    .then((status) => {
  // 情報表示中に別のObjectへ移動していた場合は何もしない
  if (buyBtn.dataset.productId !== item.id) return;
  if (!buyBtn.isConnected) return;

  if (status === 'sold') {
    const soldOut = document.createElement('span');

    soldOut.className = 'sold-out-label';
    soldOut.textContent = '(Sold Out)';

    buyBtn.replaceWith(soldOut);
    return;
  }

  if (status === 'reserved') {
    buyBtn.disabled = true;
    buyBtn.textContent = 'Reserved';
    return;
  }

  if (status !== 'available') {
    throw new Error(`Unknown inventory status: ${status}`);
  }

  buyBtn.disabled = false;
  buyBtn.textContent = contact;

  buyBtn.addEventListener('click', async () => {
    buyBtn.disabled = true;

    try {
      // 表示後に在庫状態が変わった可能性があるため再確認
      const latestStatus = await fetchProductStatus(item.id);

      if (latestStatus === 'sold') {
        const soldOut = document.createElement('span');

        soldOut.className = 'sold-out-label';
        soldOut.textContent = '(Sold Out)';

        buyBtn.replaceWith(soldOut);

        alert('This item is sold out.');
        return;
      }

      if (latestStatus === 'reserved') {
        buyBtn.textContent = 'Reserved';

        alert('This item is currently reserved.');
        return;
      }

      if (latestStatus !== 'available') {
        throw new Error(
          `Unknown inventory status: ${latestStatus}`
        );
      }

      addToCart(item.id);
      openCartPanel();
    } catch (err) {
      console.error('Inventory check failed:', err);
      alert('Unable to confirm product availability. Please try again.');
    } finally {
      if (
        buyBtn.isConnected &&
        buyBtn.textContent !== 'Reserved'
      ) {
        buyBtn.disabled = false;
      }
    }
  });
})
    .catch((err) => {
      console.error('Inventory check failed:', err);

      if (!buyBtn.isConnected) return;

      buyBtn.disabled = true;
      buyBtn.textContent = 'Unavailable';
    });
}
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
  closeCartIfOpen();

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
  function closeCartIfOpen() {
  closeCartPanel?.();
}
function openCurrentItemInfoPanel() {
  if (!currentItem) return;

  const isObject = currentItem.id.startsWith('object');
  if (!isObject) return;

  const isAlreadyOpen =
    panel.classList.contains('is-open') &&
    panel.classList.contains('is-object-info');

  // モデルクリックでは閉じない
  if (isAlreadyOpen) return;

  clearBottomActive();
  closeCartIfOpen();

  panel.className = 'pc-info-panel is-open is-object-info';
  panel.setAttribute('aria-hidden', 'false');

  sceneBtn?.classList.add('is-active');

  renderPcInfo(currentItem);
}

// wirePcInfoPanel() の外側からも実行できるようにする
window.openCurrentItemInfoPanel = openCurrentItemInfoPanel;

sceneBtn?.addEventListener('click', (e) => {
  e.preventDefault();

  const isOpen =
  panel.classList.contains('is-open') &&
  (
    panel.classList.contains('is-scene') ||
    panel.classList.contains('is-object-info')
  );

  if (isOpen) {
    closePanel();
    return;
  }

  clearBottomActive();

  closeCartIfOpen();

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

  const isOpen =
    panel.classList.contains('is-open') &&
    panel.classList.contains('is-explain');

  if (isOpen) {
    closePanel();
    return;
  }

  openPanel(explainBtn, `
  <div class="about-body">
    <div class="legal-lang-tabs">
      <button class="legal-lang-btn is-active" type="button" data-about-lang="en">EN</button>
      <button class="legal-lang-btn" type="button" data-about-lang="jp">JP</button>
    </div>

    <div id="aboutText" class="about-text"></div>

    <img
      src="./assets/images/about_image_1.webp"
      class="about-image"
      alt=""
    >
  </div>
`, 'explain');

  const aboutText = document.getElementById('aboutText');
  const aboutLangBtns = document.querySelectorAll('[data-about-lang]');

  const aboutTexts = {
    en: `
      <h2>🪦Locomotion™🪦</h2>

      <p>
        Locomotion™ is an experimental project exploring the possibilities of contemporary independent work.
      </p>

      <p>
        Combining the functions of a marketplace and an archive, it facilitates the circulation, preservation, and long-term accessibility of cultural production. In addition to presenting outstanding practices across a wide range of fields, Locomotion™ regularly develops collaborations with artists, designers, researchers, and independent practitioners.
      </p>

      <p>
        As technology and social conditions continue to evolve, the ways people engage with creative production—and the experiences that emerge from it—also change. Locomotion™ seeks to understand, document, and share these transformations.🤺
      </p>

      <p class="about-meta">
  email:
  <a href="mailto:info@locomotion-services.com">
    info@locomotion-services.com
  </a>

  <span class="about-meta-sep">　</span>

  founded: 2025
</p>
    `,

    jp: `
      <h2>🪦Locomotion™🪦</h2>

     <p>
  "Locomotion™は<span>現代的なインデペンデントワークの可能性を提示する<span>実験的プロジェクトです</span>。"
</p>

<p>
  "ECサイトとしての販売機能とアーカイブプロジェクトとしての<span>保存機能を</span>備え、文化的制作物の流通、保存、そして継続的なアクセスを可能に<span>しています。様々な領域における優れた実践を取り扱う他、アーティスト、デザイナー、研究者、インディペンデントの実践者たちとのコラボレーションを定期的に展開します。"
</p>

<p>
  "<span>技術や社会</span>環境の変化によって、人々の制作との関わり方や、そこから得られる実感もまた変化しています。<span class="heisei-font">Locomotion™</span>は、その変化を理解し、記録し、共有することを目的とします。"
</p>

      <p class="about-meta">
  email:
  <a href="mailto:info@locomotion-services.com">
    info@locomotion-services.com
  </a>

  <span class="about-meta-sep">　</span>

  founded: 2025
</p>
    `
  };
function randomizeAboutJpFonts(html) {
  const fonts = ['font-jp-base', 'font-heisei', 'font-rampart'];

  const template = document.createElement('template');
  template.innerHTML = html;

  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT
  );

  const textNodes = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (!node.nodeValue.trim()) continue;

    const parent = node.parentElement;

    if (
      parent?.closest('a') ||
      parent?.closest('.about-meta')
    ) {
      continue;
    }

    textNodes.push(node);
  }

  textNodes.forEach((node) => {
    const frag = document.createDocumentFragment();

    node.nodeValue.split(/([\s。、，．！？「」『』（）])/).forEach((text) => {
      if (!text.trim()) {
        frag.appendChild(document.createTextNode(text));
        return;
      }

      const span = document.createElement('span');
      span.className = fonts[Math.floor(Math.random() * fonts.length)];
      span.textContent = text;
      frag.appendChild(span);
    });

    node.replaceWith(frag);
  });

  return template.innerHTML;
}
  let currentAboutLang = 'en';

function renderAboutText() {
  aboutText.innerHTML =
    currentAboutLang === 'jp'
      ? randomizeAboutJpFonts(aboutTexts.jp)
      : aboutTexts.en;

  aboutText.classList.toggle('is-jp', currentAboutLang === 'jp');
  aboutText.classList.toggle('is-en', currentAboutLang === 'en');

    aboutLangBtns.forEach((btn) => {
      btn.classList.toggle(
        'is-active',
        btn.dataset.aboutLang === currentAboutLang
      );
    });
  }

  aboutLangBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentAboutLang = btn.dataset.aboutLang;
      renderAboutText();
    });
  });

  renderAboutText();
});

  privacyBtn?.addEventListener('click', (e) => {
  e.preventDefault();

  const isOpen =
    panel.classList.contains('is-open') &&
    panel.classList.contains('is-privacy');

  if (isOpen) {
    closePanel();
    return;
  }

  openPanel(privacyBtn, `
    <div class="legal-layout">
      <nav class="legal-tabs">
        <button class="legal-tab is-active" type="button" data-legal-tab="privacy">Privacy</button>
        <button class="legal-tab" type="button" data-legal-tab="terms">Terms</button>
        <button class="legal-tab" type="button" data-legal-tab="shipping">Shipping</button>
        <button class="legal-tab" type="button" data-legal-tab="refund">Refund</button>
        <button class="legal-tab" type="button" data-legal-tab="legal">Legal Notice</button>
      </nav>

   <div class="legal-body">
  <div class="legal-lang-tabs">
    <button class="legal-lang-btn is-active" type="button" data-legal-lang="en">EN</button>
    <button class="legal-lang-btn" type="button" data-legal-lang="jp">JP</button>
  </div>

  <div class="legal-text" id="legalText"></div>
</div>
  `, 'privacy');

const legalText = document.getElementById('legalText');
const tabs = document.querySelectorAll('.legal-tab');
const langBtns = document.querySelectorAll('.legal-lang-btn');

let currentLegalTab = 'privacy';
let currentLegalLang = 'en';
  const texts = {
    privacy: {
  en: `
<h2>(Privacy Policy)</h2>

<p>
Locomotion™ handles personal information in accordance with this Privacy Policy.
This policy explains what information we collect, how we use it, how it may be shared, and how customers may contact us regarding their personal information.
</p>

<p>
Information we may collect includes the customer’s name, email address, shipping address, order details, payment status, and other information provided when placing an order or contacting us.
</p>

<p>
Locomotion™ may also collect limited technical information necessary for operating and maintaining this website, such as access logs, device information, browser information, and error-related information.
At this time, Locomotion™ does not intentionally use advertising cookies, tracking pixels, or behavioral advertising tools.
</p>

<p>
The collected information is used for the following purposes:
</p>

<p>
– Processing orders<br>
– Confirming payment status<br>
– Arranging shipment and delivery<br>
– Responding to inquiries<br>
– Preventing fraud, unauthorized access, or misuse<br>
– Maintaining, securing, and improving this website<br>
– Complying with applicable laws and regulations
</p>

<p>
Payment processing is handled through Stripe Checkout.
Locomotion™ does not directly receive or store full credit card numbers or complete card information.
Payment-related information may be handled by Stripe in accordance with Stripe’s own privacy policy and terms.
</p>

<p>
Order information, including customer name, email address, shipping address, purchased items, payment status, and related transaction information, may be stored by Locomotion™ for order management, shipping, customer support, and record-keeping purposes.
</p>

<p>
Locomotion™ will not sell or rent personal information to third parties.
Personal information may be shared with third parties only when necessary for payment processing, shipping, system operation, legal compliance, fraud prevention, or other purposes reasonably related to the operation of this website.
</p>

<p>
Examples of such third parties may include payment service providers, delivery service providers, hosting providers, database providers, and other service providers necessary for operating this website.
</p>

<p>
Locomotion™ takes reasonable measures to prevent unauthorized access, loss, alteration, leakage, or misuse of personal information.
However, no method of transmission over the internet or electronic storage can be guaranteed to be completely secure.
</p>

<p>
Customers may request disclosure, correction, suspension of use, or deletion of their personal information, where permitted by applicable law.
Requests will be handled after confirming the identity of the requester and within a reasonable scope.
</p>

<p>
Personal information may be retained for as long as necessary for order fulfillment, customer support, legal compliance, accounting, dispute resolution, or other legitimate business purposes.
</p>

<p>
This website uses localStorage to store cart information on the customer’s device.
This is used only to keep cart contents available during browsing and checkout preparation.
</p>

<p>
For questions regarding this Privacy Policy or the handling of personal information, please contact:
<br>
info@locomotion-services.com
</p>

<p>
This Privacy Policy may be revised when necessary.
Any changes will become effective when posted on this website.
</p>
  `,

  jp: `
<h2>(Privacy Policy)</h2>

<p>
Locomotion™ は、本プライバシーポリシーに基づき、個人情報を適切に取り扱います。
本ポリシーは、当サイトにおいて取得する情報、その利用目的、第三者への提供、ならびに個人情報に関するお問い合わせ方法について定めるものです。
</p>

<p>
当サイトでは、ご注文またはお問い合わせの際に、お客様の氏名、メールアドレス、配送先住所、注文内容、決済状況、その他お客様が任意に提供する情報を取得する場合があります。
</p>

<p>
また、当サイトの運営、保守、安全性の確保のため、アクセスログ、端末情報、ブラウザ情報、エラーに関する情報など、必要最小限の技術的情報を取得する場合があります。
現時点において、Locomotion™ は広告配信用Cookie、トラッキングピクセル、行動ターゲティング広告のための解析ツールを意図的に使用していません。
</p>

<p>
取得した情報は、以下の目的のために利用します。
</p>

<p>
・商品の注文処理<br>
・決済状況の確認<br>
・商品の発送および配送対応<br>
・お問い合わせへの対応<br>
・不正利用、不正アクセス、その他の不適切な利用の防止<br>
・当サイトの維持、保守、安全性向上および改善<br>
・法令または規則に基づく対応
</p>

<p>
決済処理は Stripe Checkout を通じて行われます。
Locomotion™ は、クレジットカード番号その他の完全なカード情報を直接取得または保存しません。
決済に関する情報は、Stripe のプライバシーポリシーおよび利用規約に基づき、Stripe によって取り扱われる場合があります。
</p>

<p>
お客様の氏名、メールアドレス、配送先住所、購入商品、決済状況、その他注文に関連する情報は、注文管理、発送、問い合わせ対応、記録保管のため、Locomotion™ により保存される場合があります。
</p>

<p>
Locomotion™ は、個人情報を第三者に販売または貸与することはありません。
ただし、決済処理、配送、システム運営、法令遵守、不正防止、その他当サイトの運営に合理的に必要な範囲において、第三者に情報を提供する場合があります。
</p>

<p>
第三者には、決済サービス事業者、配送事業者、ホスティング事業者、データベース提供事業者、その他当サイトの運営に必要な外部サービス提供者が含まれる場合があります。
</p>

<p>
Locomotion™ は、個人情報への不正アクセス、紛失、改ざん、漏えい、不正利用等を防止するため、合理的な安全管理措置を講じます。
ただし、インターネット上の通信または電子的な保存方法について、完全な安全性を保証するものではありません。
</p>

<p>
お客様は、法令の定める範囲において、自己の個人情報について、開示、訂正、利用停止、削除等を請求することができます。
これらの請求については、ご本人確認のうえ、合理的な範囲で対応いたします。
</p>

<p>
個人情報は、商品の発送、問い合わせ対応、法令遵守、会計処理、紛争対応、その他正当な業務上の目的に必要な期間、保存される場合があります。
</p>

<p>
当サイトでは、カート情報をお客様の端末上に保存するため localStorage を使用しています。
これは、閲覧中および決済準備中にカート内容を保持するために使用されるものであり、広告配信や行動追跡を目的とするものではありません。
</p>

<p>
本ポリシーおよび個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。<br>
info@locomotion-services.com
</p>

<p>
本ポリシーは、必要に応じて改定される場合があります。
改定後の内容は、本ウェブサイト上に掲載された時点で効力を生じるものとします。
</p>
  `
},
    terms: {

en: `
<h2>(Terms of Use)</h2>

<h3>Application</h3>

<p>
These Terms of Use ("Terms") govern the use of the Locomotion™ website, online store, and related services (collectively, the "Service").
</p>

<p>
By accessing, browsing, purchasing products from, or otherwise using this website, you agree to be bound by these Terms.
</p>

<p>
Any policies, guidelines, notices, or additional rules published by Locomotion™ shall form part of these Terms.
</p>

<h3>Service Description</h3>

<p>
Locomotion™ operates a website dedicated to the presentation, publication, archiving, and sale of spatial scans, photographs, videos, 3D models, digital archives, handmade objects, and related works.
</p>

<p>
Locomotion™ reserves the right to modify, add, suspend, or discontinue any part of the Service without prior notice.
</p>

<h3>Purchases</h3>

<p>
Users wishing to purchase products must follow the procedures specified by Locomotion™.
</p>

<p>
Submission of an order does not automatically create a binding sales agreement.
A sales agreement shall be formed only after payment has been successfully completed and the order has been accepted by Locomotion™.
</p>

<p>
Locomotion™ reserves the right to refuse or cancel any order under the following circumstances:
</p>

<p>
• Product unavailability or production limitations<br>
• Errors in pricing or product information<br>
• Suspected fraudulent activity or unauthorized payment<br>
• False, inaccurate, or incomplete customer information<br>
• Violation of these Terms<br>
• Any other circumstance deemed inappropriate by Locomotion™
</p>

<h3>Pricing and Product Information</h3>

<p>
Prices, specifications, dimensions, weight, materials, photographs, and other product information may be changed without prior notice.
</p>

<p>
Price changes shall not affect orders that have already been accepted.
</p>

<h3>Product Characteristics</h3>

<p>
Products sold through this website may include one-of-a-kind works, limited-production items, handmade objects, works incorporating natural materials, and works derived from 3D scan data.
</p>

<p>
As a result, variations in color, shape, dimensions, texture, surface condition, and other characteristics may occur between individual pieces.
</p>

<p>
While product images are presented as accurately as possible, differences may occur due to photography conditions, lighting, display settings, monitor calibration, and other viewing conditions.
</p>

<p>
Such variations shall not be considered defects or grounds for return.
</p>

<h3>Refusal of Delivery and Extended Absence</h3>

<p>
If a product is returned due to refusal of delivery, extended absence, incorrect shipping information, or any other circumstance attributable to the customer, Locomotion™ may charge additional shipping and handling fees required for redelivery.
</p>

<p>
If Locomotion™ is unable to contact the customer for an extended period following the return of a shipment, the order may be considered abandoned.
</p>

<p>
Shipping charges and related expenses already incurred may be non-refundable.
</p>

<h3>Restrictions on Use and Order Refusal</h3>

<p>
Locomotion™ may restrict access to the Service, cancel orders, suspend transactions, or take other appropriate measures if a user:
</p>

<p>
• Violates these Terms<br>
• Has previously violated these Terms<br>
• Appears to be purchasing products for unauthorized resale purposes<br>
• Uses fraudulent payment methods<br>
• Damages the trust relationship between the user and Locomotion™<br>
• Is otherwise deemed inappropriate by Locomotion™
</p>

<h3>Prohibited Conduct</h3>

<p>
Users shall not:
</p>

<p>
• Violate laws or public order<br>
• Engage in criminal activity<br>
• Impersonate another person or entity<br>
• Interfere with the operation of the website<br>
• Attempt unauthorized access to systems or servers<br>
• Upload or transmit malicious software or harmful code<br>
• Cause damage to other users or third parties<br>
• Infringe intellectual property rights or other legal rights<br>
• Engage in any activity deemed inappropriate by Locomotion™
</p>

<h3>Intellectual Property</h3>

<p>
All text, photographs, images, videos, 3D models, scan data, digital data, layouts, designs, and other content published on this website are owned by Locomotion™ or their respective rights holders.
</p>

<p>
Users may not copy, reproduce, distribute, transmit, sell, modify, or otherwise use such content without prior permission from the rights holder.
</p>

<p>
Some works, photographs, 3D models, scan data, or other materials published on this website may include content owned by third parties.
In such cases, users must comply with the applicable license terms and conditions set by the relevant rights holders.
</p>

<h3>Exclusion of Anti-Social Forces</h3>

<p>
Users represent and warrant that they are not, and will not be in the future, members of organized crime groups, affiliated companies, corporate racketeers, groups engaging in criminal or antisocial activities, or any other equivalent anti-social forces.
</p>

<p>
If Locomotion™ determines that a user falls under any of the above categories, Locomotion™ may cancel orders, suspend use of the Service, or take any other necessary measures without prior notice.
</p>

<h3>Suspension or Interruption of the Service</h3>

<p>
Locomotion™ may suspend or interrupt all or part of the Service without prior notice in the following cases:
</p>

<p>
• System maintenance or updates<br>
• Network or server failure<br>
• Natural disasters, fire, power outage, or other force majeure events<br>
• Failure or interruption of external service providers<br>
• Any other circumstance deemed necessary by Locomotion™
</p>

<p>
Locomotion™ shall not be liable for any damage arising from suspension or interruption of the Service.
</p>

<h3>Disclaimer</h3>

<p>
The website and the Service are provided on an "as is" and "as available" basis.
</p>

<p>
Locomotion™ does not warrant that the website will be continuously available, error-free, secure, or uninterrupted.
</p>

<p>
Locomotion™ shall not be liable for damages caused by delivery delays, system failures, communication failures, unauthorized third-party actions, natural disasters, or any other event beyond the reasonable control of Locomotion™.
</p>

<h3>Damages</h3>

<p>
If a user causes damage to Locomotion™ or a third party by violating these Terms, engaging in illegal conduct, or otherwise acting improperly, the user shall compensate such damage at their own responsibility and expense.
</p>

<p>
In the event of non-payment, payment failure, or other default by the user, Locomotion™ may claim late payment charges and other necessary costs to the extent permitted by applicable law.
</p>

<h3>Changes to These Terms</h3>

<p>
Locomotion™ may revise these Terms at any time without prior notice to users.
</p>

<p>
Revised Terms shall become effective when posted on this website.
</p>

<p>
If a user continues to use this website after the Terms have been revised, the user shall be deemed to have agreed to the revised Terms.
</p>

<h3>Governing Law and Jurisdiction</h3>

<p>
These Terms shall be governed by and interpreted in accordance with the laws of Japan.
</p>

<p>
Any dispute arising in connection with these Terms or use of this website shall be subject to the exclusive jurisdiction of the court having jurisdiction over the location of the operator of Locomotion™ as the court of first instance.
</p>

<h3>Contact</h3>

<p>
Questions regarding these Terms may be directed to:<br>
info@locomotion-services.com
</p>
   `,

jp: `
<h2>(Terms of Use)</h2>

<h3>適用</h3>

<p>
本利用規約（以下「本規約」といいます。）は、Locomotion™（以下「当サイト」といいます。）が提供するウェブサイト、オンラインストアおよび関連サービスの利用条件を定めるものです。
</p>

<p>
利用者は、本ウェブサイトを利用することにより、本規約に同意したものとみなされます。
</p>

<p>
当サイトが別途定めるガイドライン、ポリシー、注意事項その他の規定は、本規約の一部を構成するものとします。
</p>

<h3>サービス内容</h3>

<p>
当サイトは、3Dスキャンによる空間記録、写真、映像、3Dモデル、デジタルアーカイブ、オブジェクトおよび関連作品の展示、販売、公開を目的として運営されています。
</p>

<p>
当サイトは、事前の通知なく、サービス内容の変更、追加、停止または終了を行うことがあります。
</p>

<h3>商品の購入</h3>

<p>
利用者は、当サイトの定める手続に従って商品を注文するものとします。
</p>

<p>
利用者による注文のみをもって売買契約は成立しません。
決済手続が正常に完了し、当サイトが注文を受理した時点で売買契約が成立するものとします。
</p>

<p>
当サイトは、以下の場合、注文を取消し、または受理しないことがあります。
</p>

<p>
・在庫不足または制作継続が困難な場合<br>
・価格表示その他掲載内容に誤りがあった場合<br>
・不正決済または不正利用の疑いがある場合<br>
・利用者情報に虚偽または不備がある場合<br>
・本規約違反が確認された場合<br>
・その他当サイトが不適切と判断した場合
</p>

<h3>商品価格および表示</h3>

<p>
商品の価格、仕様、寸法、重量、素材、写真その他の情報は、予告なく変更される場合があります。
</p>

<p>
価格改定後も、既に成立した注文については注文時点の価格が適用されます。
</p>

<h3>商品の特性について</h3>

<p>
当サイトで販売される商品には、一点物、少量生産品、手作業による制作物、天然素材を含む作品、3Dスキャンデータをもとに制作された作品等が含まれます。
</p>

<p>
そのため、色味、形状、寸法、質感、表面状態その他の特徴について個体差が生じる場合があります。
</p>

<p>
また、商品画像はできる限り実物に近い状態で掲載しておりますが、撮影環境、照明条件、閲覧環境、モニター設定その他の要因により、実際の商品と見え方が異なる場合があります。
</p>

<p>
これらは商品の欠陥または不良には該当しないものとします。
</p>

<h3>受領拒否・長期不在について</h3>

<p>
利用者の都合による受領拒否、長期不在、住所不備その他利用者の責めに帰す事由により商品が返送された場合、当サイトは再発送に必要な送料その他の費用を請求することができるものとします。
</p>

<p>
返送後一定期間利用者と連絡が取れない場合、当サイトは注文を終了したものとして取り扱うことがあります。
</p>

<p>
この場合においても、既に発生した送料その他の費用について返金を行わない場合があります。
</p>

<h3>利用制限および注文拒否</h3>

<p>
当サイトは、利用者が以下のいずれかに該当すると判断した場合、事前通知なく利用制限、注文取消し、サービス利用停止その他必要な措置を講じることができるものとします。
</p>

<p>
・本規約に違反した場合<br>
・過去に本規約違反があった場合<br>
・転売目的による購入と判断される場合<br>
・不正決済が確認された場合<br>
・当サイトとの信頼関係を損なう行為があった場合<br>
・その他当サイトが不適切と判断した場合
</p>

<h3>禁止事項</h3>

<p>
利用者は、以下の行為を行ってはなりません。
</p>

<p>
・法令または公序良俗に反する行為<br>
・犯罪行為またはこれに関連する行為<br>
・第三者になりすます行為<br>
・当サイトの運営を妨害する行為<br>
・不正アクセスまたはその試行<br>
・有害なプログラム等の送信<br>
・他の利用者または第三者に損害を与える行為<br>
・知的財産権その他の権利を侵害する行為<br>
・その他当サイトが不適切と判断する行為
</p>
    <h3>知的財産権</h3>

<p>
当サイト上に掲載される文章、写真、画像、映像、3Dモデル、スキャンデータ、デジタルデータ、レイアウト、デザインその他一切のコンテンツに関する知的財産権は、当サイトまたは正当な権利者に帰属します。
</p>

<p>
利用者は、権利者の事前の許可なく、これらのコンテンツを複製、転載、配布、公衆送信、販売、改変その他の利用を行うことはできません。
</p>

<p>
当サイトに掲載される一部の作品、写真、3Dモデルその他のデータには第三者が権利を有するコンテンツが含まれる場合があります。
その場合、利用者は当該権利者の定める利用条件およびライセンスに従うものとします。
</p>

<h3>反社会的勢力の排除</h3>

<p>
利用者は、現在および将来にわたり、暴力団、暴力団員、暴力団関係企業、総会屋、社会運動等標榜ゴロ、特殊知能暴力集団その他これらに準ずる反社会的勢力に該当しないことを表明し保証するものとします。
</p>

<p>
当サイトは、利用者が反社会的勢力に該当すると判断した場合、何らの通知または催告を行うことなく、注文の取消し、サービス利用停止その他必要な措置を講じることができるものとします。
</p>

<h3>サービスの停止・中断</h3>

<p>
当サイトは、以下の場合、利用者への事前通知なくサービスの全部または一部を停止または中断することがあります。
</p>

<p>
・システム保守または更新を行う場合<br>
・通信回線またはサーバー障害が発生した場合<br>
・地震、火災、停電その他の不可抗力が発生した場合<br>
・外部サービス事業者に障害が発生した場合<br>
・その他当サイトが必要と判断した場合
</p>

<p>
当サイトは、サービス停止または中断によって生じた損害について責任を負わないものとします。
</p>

<h3>免責事項</h3>

<p>
当サイトは、本ウェブサイトおよびサービスを現状有姿で提供します。
</p>

<p>
当サイトは、本ウェブサイトが常に利用可能であること、エラーが存在しないこと、安全であること、または中断なく運営されることについて保証しません。
</p>

<p>
当サイトは、商品の配送遅延、システム障害、通信障害、第三者による不正行為、天災地変その他当サイトの合理的支配を超える事由によって生じた損害について責任を負いません。
</p>

<h3>損害賠償</h3>

<p>
利用者が本規約に違反し、または違法行為その他の不適切な行為によって当サイトまたは第三者に損害を与えた場合、利用者は自己の責任と費用においてこれを賠償するものとします。
</p>

<p>
利用者による決済不履行その他の債務不履行があった場合、当サイトは法令の定める範囲において遅延損害金その他必要な費用を請求できるものとします。
</p>

<h3>利用規約の変更</h3>

<p>
当サイトは、お客様に事前に通知することなく、本規約を変更することができるものとします。
</p>

<p>
変更後の本規約は、本ウェブサイト上に掲載された時点から効力を生じるものとします。
</p>

<p>
利用者が変更後も本ウェブサイトを利用した場合、変更後の本規約に同意したものとみなします。
</p>

<h3>準拠法および管轄裁判所</h3>

<p>
本規約は日本法に準拠し、日本法に基づいて解釈されるものとします。
</p>

<p>
本規約または本ウェブサイトの利用に関して紛争が生じた場合、当サイト運営者所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
</p>

<h3>お問い合わせ</h3>

<p>
本規約に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion-services.com
</p>

`
    },

    shipping: {
      en: `
<h2>(Shipping Policy)</h2>

<h3>Shipping</h3>

<p>
Locomotion™ ships products from Japan.
Orders are prepared and processed individually after payment has been successfully confirmed.
</p>

<p>
Depending on the nature of the work, some products may require additional finishing, inspection, or packaging prior to shipment.
As a result, processing times may vary between products.
</p>

<h3>Processing Time</h3>

<p>
Orders are generally prepared for shipment within 7 business days after payment confirmation.
</p>

<p>
However, processing times may be extended due to production schedules, order volume, holidays, year-end periods, or other operational circumstances.
</p>

<h3>Shipping Destinations</h3>

<p>
At present, orders placed through this website are available for delivery within Japan only.
</p>

<p>
International shipping may become available in the future, but is not currently supported through this website.
</p>

<h3>Shipping Carriers</h3>

<p>
Shipping methods and carriers are selected by Locomotion™ based on the size, weight, destination, and nature of each shipment.
</p>

<p>
Customers may not request specific shipping carriers unless otherwise agreed in advance.
</p>

<h3>Shipping Fees</h3>

<p>
Shipping fees may vary depending on the product and destination.
Where applicable, shipping costs will be displayed during checkout before payment is completed.
</p>

<h3>Shipping Delays</h3>

<p>
Delivery times are estimates only and are not guaranteed.
</p>

<p>
Delays may occur due to weather conditions, natural disasters, transportation disruptions, carrier-related issues, public holidays, system failures, pandemics, or other circumstances beyond the reasonable control of Locomotion™.
</p>

<p>
Locomotion™ shall not be liable for losses or damages arising from such delays.
</p>

<h3>Shipping Information</h3>

<p>
Customers are responsible for providing accurate and complete shipping information, including name, address, and contact details at the time of purchase.
</p>

<p>
Locomotion™ shall not be responsible for delays, failed deliveries, or additional expenses resulting from incorrect, incomplete, or outdated shipping information provided by the customer.
</p>

<h3>Refused Deliveries and Extended Absence</h3>

<p>
If a shipment is returned due to refusal of delivery, extended absence, incorrect address information, or any other circumstance attributable to the customer, Locomotion™ may require payment of additional shipping and handling charges prior to reshipment.
</p>

<p>
If the customer cannot be contacted for an extended period after a shipment has been returned, Locomotion™ may consider the order abandoned and close the transaction.
</p>

<p>
In such cases, shipping costs and other expenses already incurred may be non-refundable.
</p>

<h3>Risk of Loss</h3>

<p>
Risk of loss, theft, damage, or destruction of purchased products transfers to the customer upon successful delivery to the shipping address provided during checkout.
</p>

<p>
Locomotion™ shall not be responsible for losses arising from storage conditions, handling, or management of products after delivery has been completed.
</p>

<h3>Changes to Shipping Address</h3>

<p>
Changes to shipping addresses may not be possible after an order has been placed.
</p>

<p>
Customers who need to modify shipping information should contact Locomotion™ as soon as possible before shipment.
</p>

<h3>Contact</h3>

<p>
Questions regarding shipping may be directed to:<br>
info@locomotion-services.com
</p>
`,
    jp: `
<h2>(Shipping Policy)</h2>

<h3>配送について</h3>

<p>
Locomotion™ は、日本国内より商品を発送しています。
ご注文いただいた商品は、決済確認後に順次発送準備を行います。
</p>

<p>
商品の性質上、受注後に仕上げ、検品、梱包作業を行う場合があります。
そのため、商品ごとに発送までの日数が異なる場合があります。
</p>

<h3>発送時期</h3>

<p>
通常、ご注文および決済確認後、7営業日以内に発送手続きを行います。
ただし、受注状況、制作状況、祝祭日、年末年始その他の事情により発送までお時間をいただく場合があります。
</p>

<h3>配送地域</h3>

<p>
現在、本ウェブサイトからの注文については日本国内への配送のみ対応しています。
</p>

<p>
海外配送については将来的に対応する可能性がありますが、現時点では対応しておりません。
</p>

<h3>配送業者</h3>

<p>
配送方法および配送業者は、商品のサイズ、重量、配送地域等を考慮し、Locomotion™ が選定します。
</p>

<p>
お客様による配送業者の指定は原則としてお受けできません。
</p>

<h3>送料について</h3>

<p>
送料は商品ごとに異なる場合があります。
送料が発生する場合は、決済時に表示される金額が適用されます。
</p>

<h3>配送遅延について</h3>

<p>
天候、自然災害、交通事情、配送会社の事情、システム障害、感染症の流行その他当サイトの合理的支配を超える事由により、配送が遅延する場合があります。
</p>

<p>
これらの事由による配送遅延について、Locomotion™ は責任を負わないものとします。
</p>

<h3>配送先情報について</h3>

<p>
お客様は、注文時に正確な氏名、住所、電話番号その他必要情報を入力するものとします。
</p>

<p>
入力情報に誤りまたは不足がある場合、商品の発送または配送ができない場合があります。
</p>

<p>
これにより発生した損害について、Locomotion™ は責任を負いません。
</p>

<h3>受領拒否・長期不在について</h3>

<p>
お客様の都合による受領拒否、長期不在、住所不備その他お客様の責めに帰す事由により商品が返送された場合、再発送に必要な送料および手数料を別途ご負担いただく場合があります。
</p>

<p>
返送後一定期間ご連絡が取れない場合、当サイトは注文を終了したものとして取り扱う場合があります。
</p>

<p>
その場合でも、既に発生した送料その他費用について返金を行わない場合があります。
</p>

<h3>配送後の責任</h3>

<p>
商品の滅失、紛失、盗難その他の危険負担は、お客様が指定した配送先への配達完了時点でお客様に移転するものとします。
</p>

<p>
配送完了後の保管状況、管理状況その他お客様の責任に起因する損害について、Locomotion™ は責任を負いません。
</p>

<h3>配送先変更について</h3>

<p>
注文確定後の配送先変更は対応できない場合があります。
</p>

<p>
配送先変更をご希望の場合は、発送前にお問い合わせください。
</p>

<h3>お問い合わせ</h3>

<p>
配送に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion-services.com
</p>`
    },

    refund: {
      en: `
<h2>(Refund Policy)</h2>

<h3>Returns and Exchanges</h3>

<p>
Locomotion™ primarily offers one-of-a-kind works, limited-production items, handmade objects, and works derived from 3D scan data.
Due to the nature of these products, all sales are generally considered final.
</p>

<p>
Returns, exchanges, or refunds will not be accepted for reasons including change of mind, mistaken purchase, differences in personal expectations, display-related color variations, or any reason unrelated to the condition of the product.
</p>

<h3>Defective or Damaged Products</h3>

<p>
If a product arrives with significant damage, missing components, or substantial manufacturing defects, please contact Locomotion™ within three (3) days of receiving the product.
</p>

<p>
After reviewing the circumstances, Locomotion™ may offer a replacement, repair, refund, or other appropriate remedy where deemed appropriate.
</p>

<h3>Shipping Damage</h3>

<p>
If damage appears to have occurred during transit, customers should retain the product and all original packaging materials and contact Locomotion™ as soon as possible.
</p>

<p>
An investigation with the shipping carrier may be required before a claim can be processed.
</p>

<h3>Information Required for Claims</h3>

<p>
When requesting a return, exchange, or refund, customers may be asked to provide:
</p>

<p>
• Name<br>
• Order number or order information<br>
• Photographs of the product<br>
• Photographs of the packaging<br>
• Description of the issue
</p>

<h3>Return Shipping Costs</h3>

<p>
If a defect or issue is determined to be the responsibility of Locomotion™, return shipping and replacement shipping costs will be covered by Locomotion™.
</p>

<p>
Returns or exchanges requested for customer convenience will not be accepted.
</p>

<h3>Refund Method</h3>

<p>
Approved refunds will generally be issued through the original payment method used for the purchase.
</p>

<p>
The time required for refunded funds to appear in the customer's account may vary depending on the payment provider, credit card issuer, or financial institution.
</p>

<h3>Order Cancellations</h3>

<p>
Orders may not be canceled after payment has been completed.
</p>

<p>
However, if shipment has not yet occurred and Locomotion™ determines that cancellation is reasonably possible, an exception may be granted at its sole discretion.
</p>

<h3>Refused Deliveries and Extended Absence</h3>

<p>
Refunds will not be provided for orders returned due to refusal of delivery, extended absence, incorrect shipping information, or other circumstances attributable to the customer.
</p>

<p>
If reshipment is requested, additional shipping charges and related expenses may apply.
</p>

<h3>Product Characteristics</h3>

<p>
Many products sold through this website incorporate natural materials, handmade production processes, 3D scan-derived forms, or unique surface characteristics.
</p>

<p>
Variations in color, texture, dimensions, shape, finish, and other characteristics are considered part of the nature of the work and shall not be regarded as defects.
</p>

<h3>Non-Refundable Cases</h3>

<p>
Refunds, exchanges, or replacements will not be provided in the following situations:
</p>

<p>
• Damage caused by the customer<br>
• Improper handling, storage, or modification<br>
• Changes resulting from normal aging or wear<br>
• Requests submitted more than three (3) days after delivery<br>
• Natural variations inherent to handmade or one-of-a-kind works
</p>

<h3>Contact</h3>

<p>
Questions regarding returns, exchanges, or refunds may be directed to:<br>
info@locomotion-services.com
</p>
`,
    jp:`
<h2>(Refund Policy)</h2>

<h3>返品・交換について</h3>

<p>
Locomotion™ では、一点物作品、少量生産品、手作業による制作物、3Dスキャンデータをもとに制作された作品等を取り扱っています。
商品の性質上、原則としてお客様都合による返品、交換、返金はお受けしておりません。
</p>

<p>
イメージ違い、注文間違い、サイズの認識違い、モニター表示との差異、不要になった等の理由による返品・返金はできません。
</p>

<h3>初期不良について</h3>

<p>
商品到着時に重大な破損、欠損、製造上の不具合が認められる場合には、商品到着後3日以内にご連絡ください。
</p>

<p>
内容を確認のうえ、交換、修理、返金等の対応を検討いたします。
</p>

<h3>配送事故について</h3>

<p>
配送中の事故による破損が疑われる場合は、商品および梱包材を保管した状態で速やかにご連絡ください。
</p>

<p>
配送会社への確認が必要となる場合があります。
</p>

<h3>ご連絡時に必要な情報</h3>

<p>
返品または交換をご希望の場合は、以下の情報をご提供ください。
</p>

<p>
・お名前<br>
・注文番号または注文情報<br>
・商品の写真<br>
・梱包状態が確認できる写真<br>
・不具合内容の説明
</p>

<h3>返送料について</h3>

<p>
初期不良または当サイトの責任による不備が認められた場合、返送および再発送にかかる費用は Locomotion™ が負担します。
</p>

<p>
お客様都合による返品または交換については対応いたしかねます。
</p>

<h3>返金方法について</h3>

<p>
返金が認められた場合、原則としてご利用いただいた決済方法を通じて返金を行います。
</p>

<p>
返金処理完了後、実際の返金反映時期はカード会社または決済事業者の処理状況により異なります。
</p>

<h3>注文後のキャンセルについて</h3>

<p>
決済完了後のお客様都合によるキャンセルはお受けしておりません。
</p>

<p>
ただし、発送前であり、かつ当サイトが対応可能と判断した場合に限り、例外的に対応する場合があります。
</p>

<h3>受領拒否・長期不在について</h3>

<p>
受領拒否、長期不在、住所不備その他お客様の責めに帰す事由により商品が返送された場合、返金は行いません。
</p>

<p>
再発送を希望される場合は、追加送料および必要な費用をご負担いただく場合があります。
</p>

<h3>作品の特性について</h3>

<p>
天然素材、手作業による制作工程、3Dスキャン由来の形状、表面処理の個体差等により、色味、質感、寸法、形状等に差異が生じる場合があります。
</p>

<p>
これらは作品固有の特性であり、不良品には該当しません。
</p>

<h3>返金対象外</h3>

<p>
以下の場合は返金または交換の対象外となります。
</p>

<p>
・お客様による破損、汚損、改造<br>
・誤使用または不適切な保管による損傷<br>
・経年変化による状態変化<br>
・商品到着後3日を超えてからの申請<br>
・作品固有の個体差
</p>

<h3>お問い合わせ</h3>

<p>
返品・交換・返金に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion-services.com
</p>`
    },

    legal: {
      en: `
<h2>(Legal Notice)</h2>

<h3>Seller</h3>

<p>
Locomotion™
</p>

<h3>Representative</h3>

<p>
Issei Kouda
</p>

<h3>Business Address</h3>

<p>
The business address will be disclosed without delay upon request in accordance with the Act on Specified Commercial Transactions of Japan.
</p>

<h3>Telephone Number</h3>

<p>
The telephone number will be disclosed without delay upon request in accordance with the Act on Specified Commercial Transactions of Japan.
</p>

<h3>Email Address</h3>

<p>
info@locomotion-services.com
</p>

<h3>Product Prices</h3>

<p>
Prices are listed on each product page and include applicable taxes unless otherwise stated.
</p>

<h3>Price Changes</h3>

<p>
Product prices may be changed without prior notice.
</p>

<p>
However, price changes will not affect orders that have already been accepted.
</p>

<h3>Additional Charges</h3>

<p>
Shipping fees and other applicable charges may apply.
</p>

<p>
Any such charges will be displayed during checkout before payment is completed.
</p>

<h3>Payment Methods</h3>

<p>
Credit card payments processed through Stripe.
</p>

<h3>Payment Timing</h3>

<p>
Payment is charged at the time the order is placed.
</p>

<h3>Delivery Time</h3>

<p>
Orders are generally shipped within 7 business days after payment confirmation.
</p>

<p>
Shipping times may be extended due to production schedules, order volume, holidays, year-end periods, or other unavoidable circumstances.
</p>

<h3>Returns, Exchanges, and Cancellations</h3>

<p>
Please refer to the Refund Policy for detailed information regarding returns, exchanges, refunds, and cancellations.
</p>

<p>
Due to the nature of the products offered by Locomotion™, returns, exchanges, and refunds for customer convenience are generally not accepted.
</p>

<h3>Sales Quantity Limitations</h3>

<p>
Certain products may be subject to quantity limitations.
</p>

<p>
One-of-a-kind works, limited-production items, and made-to-order products may become unavailable once inventory has been exhausted.
</p>

<h3>Shipping Availability</h3>

<p>
Orders placed through this website are currently available for delivery within Japan only.
</p>

<p>
International shipping is not currently supported.
</p>

<h3>System Requirements</h3>

<p>
Access to this website and the purchase of products require a compatible internet connection and supported web browser.
</p>

<p>
Locomotion™ shall not be responsible for issues arising from the customer's device, browser, network environment, or other technical conditions beyond its control.
</p>

<h3>Contact</h3>

<p>
Questions regarding products, orders, or this website may be directed to:<br>
info@locomotion-services.com
</p>
`,
    jp: `
<h2>(Legal Notice)</h2>

<h3>販売事業者</h3>

<p>
Locomotion™
</p>

<h3>運営責任者</h3>

<p>
Issei Kouda
</p>

<h3>所在地</h3>

<p>
所在地については、特定商取引法に基づき、
お客様から請求があった場合には遅滞なく開示いたします。
</p>

<h3>電話番号</h3>

<p>
電話番号については、特定商取引法に基づき、
お客様から請求があった場合には遅滞なく開示いたします。
</p>

<h3>メールアドレス</h3>

<p>
info@locomotion-services.com
</p>

<h3>販売価格</h3>

<p>
各商品ページに表示された価格（税込）によります。
</p>

<h3>販売価格の変更について</h3>

<p>
商品価格は予告なく変更される場合があります。
</p>

<p>
ただし、注文確定後の価格変更は既に成立した注文には適用されません。
</p>

<h3>商品代金以外の必要料金</h3>

<p>
送料その他決済時に表示される費用が発生する場合があります。
詳細は決済画面にてご確認ください。
</p>

<h3>支払方法</h3>

<p>
Stripe を利用したクレジットカード決済
</p>

<h3>支払時期</h3>

<p>
ご注文時に決済が確定します。
</p>

<h3>商品の引渡時期</h3>

<p>
ご注文および決済確認後、通常7営業日以内に発送いたします。
</p>

<p>
受注状況、制作状況、祝祭日、年末年始その他やむを得ない事情により、発送までお時間をいただく場合があります。
</p>

<h3>返品・交換・キャンセルについて</h3>

<p>
返品、交換および返金に関する条件については Refund Policy をご確認ください。
</p>

<p>
商品の性質上、お客様都合による返品、交換および返金は原則としてお受けしておりません。
</p>

<h3>販売数量の制限</h3>

<p>
商品によって販売数量を制限する場合があります。
</p>

<p>
一点物、少量生産品、受注制作作品については在庫がなくなり次第販売終了となります。
</p>

<h3>対応地域</h3>

<p>
現在、本ウェブサイトからのご注文は日本国内への配送のみ対応しています。
</p>

<p>
海外配送については現在対応しておりません。
</p>

<h3>動作環境について</h3>

<p>
本ウェブサイトの閲覧および商品の購入には、インターネット接続環境および対応ブラウザが必要です。
</p>

<p>
利用環境に起因する表示不具合、通信障害その他の問題について、Locomotion™ は責任を負いません。
</p>

<h3>お問い合わせ</h3>

<p>
本ウェブサイトおよび商品の販売に関するお問い合わせは以下までご連絡ください。<br>
info@locomotion-services.com
</p>
`
    },
  };

  const aboutTexts = {
  en: `
<h2>Locomotion™</h2>

<p>
Locomotion™ is an experimental project exploring the possibilities of contemporary independent work.
</p>

<p>
Combining the functions of a marketplace and an archive, it facilitates the circulation, preservation, and long-term accessibility of cultural production. In addition to presenting outstanding practices across a wide range of fields, Locomotion™ regularly develops collaborations with artists, designers, researchers, and independent practitioners.
</p>

<p>
As technology and social conditions continue to evolve, the ways people engage with creative production—and the experiences that emerge from it—also change. Locomotion™ seeks to understand, document, and share these transformations.
</p>
`,

  jp: `
<h2 class="legal-hidden-title">
Locomotion™
</h2>

<p>
Locomotion™は現代的なインデペンデントワークの可能性を提示する実験的プロジェクトです。
</p>

<p>
ECサイトとしての販売機能とアーカイブプロジェクトとしての保存機能を備え、文化的制作物の流通、保存、そして継続的なアクセスを可能にしています。様々な領域における優れた実践を取り扱う他、アーティスト、デザイナー、研究者、インディペンデントの実践者たちとのコラボレーションを定期的に展開します。
</p>

<p>
技術や社会環境の変化によって、人々の制作との関わり方や、そこから得られる実感もまた変化しています。Locomotion™は、その変化を理解し、記録し、共有することを目的とします。
</p>
`
};
function renderLegalText() {
  legalText.classList.toggle('is-jp', currentLegalLang === 'jp');
  legalText.classList.toggle('is-en', currentLegalLang === 'en');

  legalText.innerHTML = texts[currentLegalTab][currentLegalLang];

  tabs.forEach((tab) => {
    tab.classList.toggle(
      'is-active',
      tab.dataset.legalTab === currentLegalTab
    );
  });

  langBtns.forEach((btn) => {
    btn.classList.toggle(
      'is-active',
      btn.dataset.legalLang === currentLegalLang
    );
  });
}

function setLegalTab(key) {
  currentLegalTab = key;
  renderLegalText();

  requestAnimationFrame(() => {
    legalText?.scrollTo({
      top: 0,
      behavior: 'auto'
    });

    content?.scrollTo({
      top: 0,
      behavior: 'auto'
    });
  });
}

function setLegalLang(lang) {
  currentLegalLang = lang;
  renderLegalText();
}

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setLegalTab(tab.dataset.legalTab);
    });
  });
  langBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    setLegalLang(btn.dataset.legalLang);
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

const model = MODELS.find(
  (m) => m.info?.productId === productId
);

const isUnique = model?.info?.isUnique;

const existing = cart.find(
  (item) => item.productId === productId
);

if (existing) {
  if (!isUnique) {
    existing.quantity += 1;
  }
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
    <div class="cart-item-main">

      <div class="cart-item-text">
        <a
          class="cart-item-name cart-item-link"
          href="./index.html?object=${item.productId.replace('object', '')}"
        >
          ${name}
        </a>

        <div class="cart-item-price">
          ¥${Number(price).toLocaleString()}
        </div>

        ${model?.info?.isUnique ? '' : `
          <div class="cart-qty-row">
            <button
              class="cart-qty-btn"
              type="button"
              data-minus="${item.productId}"
            >
              −
            </button>

            <span>${item.quantity}</span>

            <button
              class="cart-qty-btn"
              type="button"
              data-plus="${item.productId}"
            >
              +
            </button>
          </div>
        `}

        <button
          class="cart-remove-btn"
          type="button"
          data-product-id="${item.productId}"
        >
          remove
        </button>
      </div>

      <div class="cart-thumb-wrap">
       <img
  class="cart-thumb"
  src="./assets/images/${item.productId}.webp"
  alt="${name}"
  width="600"
  height="600"
  decoding="async"
>
      </div>

    </div>
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

  document.getElementById('pcInfoPanel')?.classList.remove('is-open');
  document.getElementById('pcInfoPanel')?.setAttribute('aria-hidden', 'true');
  document.getElementById('pcPlusText')?.classList.remove('is-open');
document.getElementById('pcPlusText')?.setAttribute('aria-hidden', 'true');
document.getElementById('pcPlusBtn')?.classList.remove('is-active');

  document.querySelectorAll('.pc-bottom-link').forEach((btn) => {
    btn.classList.remove('is-active');
  });

  if (!panel) return;

  renderCart();

  panel.classList.add('is-open');
panel.setAttribute('aria-hidden', 'false');
document.body.classList.add('cart-open');

requestAnimationFrame(() => {
  updateSpUiHeights();
});

cartBtn?.classList.add('is-active');
}

function closeCartPanel() {
  const panel = document.getElementById('cartPanel');
  const cartBtn = document.querySelector('.pc-cart-btn');

  if (!panel) return;

panel.classList.remove('is-open');
panel.setAttribute('aria-hidden', 'true');

document.body.classList.remove('cart-open');

requestAnimationFrame(() => {
  updateSpUiHeights();
});

cartBtn?.classList.remove('is-active');
}

function showCartMessage(message, type = 'error') {
  const panel = document.getElementById('cartPanel');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');

  if (!panel) return;

  let messageEl = document.getElementById('cartStatusMessage');

  if (!messageEl) {
    messageEl = document.createElement('p');
    messageEl.id = 'cartStatusMessage';
    messageEl.className = 'cart-status-message';

    if (checkoutBtn?.parentNode) {
      checkoutBtn.parentNode.insertBefore(messageEl, checkoutBtn);
    } else {
      panel.appendChild(messageEl);
    }
  }

  messageEl.textContent = message;
  messageEl.dataset.type = type;
  messageEl.hidden = false;
}

function clearCartMessage() {
  const messageEl = document.getElementById('cartStatusMessage');

  if (!messageEl) return;

  messageEl.textContent = '';
  messageEl.hidden = true;
  delete messageEl.dataset.type;
}

async function goToCheckout() {
  const cart = getCart();
  const checkoutBtn = document.getElementById('cartCheckoutBtn');

  clearCartMessage();

  if (!cart.length) {
    showCartMessage('Your cart is empty.');
    return;
  }

  const originalButtonText = checkoutBtn?.textContent || 'Checkout';

  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Checking...';
  }

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: cart })
    });

    let data = {};

    try {
      data = await res.json();
    } catch (error) {
      console.error('Failed to parse checkout response:', error);
    }

    if (res.ok && data.url) {
      if (checkoutBtn) {
        checkoutBtn.textContent = 'Redirecting...';
      }

      window.location.href = data.url;
      return;
    }

    if (res.status === 409 && data.productId) {
      const unavailableProductId = data.productId;

      removeFromCart(unavailableProductId);
      openCartPanel();

      showCartMessage(
  'This item is no longer available and has been removed from your cart.'
);

      console.warn('Unavailable product removed from cart:', data);
      return;
    }

    showCartMessage(
      data.error || 'Checkout could not be started. Please try again.'
    );

    console.error('Checkout failed:', {
      status: res.status,
      data
    });
  } catch (error) {
    showCartMessage(
      'A connection error occurred. Please check your connection and try again.'
    );

    console.error('Checkout request failed:', error);
  } finally {
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = originalButtonText;
    }
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


    // ===== About =====
    if (panel === 'about') {
      titleEl.textContent = 'Locomotion™';
      contentEl.innerHTML = `
        <div class="about-grid">
          <img class="about-hero" src="about_image_1.webp" alt="">
          <div class="about-text">
            <h3>Locomotion™</h3>
            <p>This site items that contribute to everyday life. Everything is handmade.</p>
            <p style="margin-top:10px;font-weight:900">General Requires / Sales.</p>
            <p><a href="mailto:info@locomotion-services.com">info@locomotion-services.com</a></p>
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

