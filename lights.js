import * as THREE from 'https://esm.sh/three@0.160.0';
// 共通ライト設定を追加する関数
export function addCommonLights(scene) {
  // 環境光（全方向からの柔らかい光）
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5); 
  scene.add(ambientLight);

  // 半球光（空と地面の反射光）
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  hemiLight.position.set(0, 200, 0);
  scene.add(hemiLight);

  // 平行光（正面から）
  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight1.position.set(5, 10, 7);
  scene.add(dirLight1);

  // 補助光（逆方向から）
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight2.position.set(-5, -2, -5);
  scene.add(dirLight2);
}
