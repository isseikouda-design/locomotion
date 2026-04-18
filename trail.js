// trail.js
(() => {
  // ===== 調整用パラメータ =====
  const CONFIG = {
    DPR: Math.min(window.devicePixelRatio || 1, 2),

    // 星の基本サイズ
    DOT_RADIUS: 6.0,           // 基準半径
    DOT_RADIUS_MIN_MUL: 0.80,  // 最小倍率
    DOT_RADIUS_MAX_MUL: 1.40,  // 最大倍率

    // 生成間隔（小さいほど密度↑）
    STEP_MIN: 1,               // 最短間隔(px)
    STEP_MAX: 200,              // 最長間隔(px)

    // 発光＆色
    GLOW: 9,
   COLOR: '#ffffffff',   // ← #rrggbb 形式で直接指定できるようにした！
    GLOW_COLOR: '#a0a0a0ff', // 発光色（HEXでOK）
  GLOW_OPACITY: 1.0,     // 発光の不透明度 0.0〜1.0

    // 星形状
    POINTS: 5,                 // 角数
    INNER_RATIO: 0.5,          // 内側半径比
    ROT_STEPS: 8               // 星の輪郭分割（小さいと描画が軽い）
  };

function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);

  // #RGB / #RGBA -> #RRGGBB / #RRGGBBAA に正規化
  if (h.length === 3) {
    h = h.split('').map(ch => ch + ch).join('');            // RGB -> RRGGBB
  } else if (h.length === 4) {
    h = h.split('').map(ch => ch + ch).join('');            // RGBA -> RRGGBBAA
  } else if (h.length !== 6 && h.length !== 8) {
    return `rgba(0,0,0,${alpha})`;
  }

  const hasA = h.length === 8;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const aFromHex = hasA ? parseInt(h.slice(6, 8), 16) / 255 : 1;

  const a = Math.max(0, Math.min(1, aFromHex * alpha));     // 0–1 にクランプ
  return `rgba(${r},${g},${b},${a})`;
}

  // ===== 便利関数 =====
  const rand = (min, max) => Math.random() * (max - min) + min;
  const randInt = (min, max) => Math.floor(rand(min, max));
  const pickStep   = () => rand(CONFIG.STEP_MIN, CONFIG.STEP_MAX);
  const pickRadius = () =>
    rand(CONFIG.DOT_RADIUS * CONFIG.DOT_RADIUS_MIN_MUL,
         CONFIG.DOT_RADIUS * CONFIG.DOT_RADIUS_MAX_MUL);

  // ===== キャンバス準備 =====
  const canvas = document.getElementById('trailCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = CONFIG.DPR;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ===== 星のパス生成（キャッシュ） =====
  const starCache = new Map();
  function getStarPath(radius, rotRad = 0) {
    const key = `${radius.toFixed(2)}|${rotRad.toFixed(2)}|${CONFIG.POINTS}|${CONFIG.INNER_RATIO}`;
    const cached = starCache.get(key);
    if (cached) return cached;

    const p = new Path2D();
    const N = CONFIG.POINTS;
    const inner = radius * CONFIG.INNER_RATIO;

    // 外→内→外… と交互に結ぶ
    const total = N * 2;
    const step = (Math.PI * 2) / total;

    for (let i = 0; i < total; i++) {
      const useOuter = (i % 2 === 0);
      const r = useOuter ? radius : inner;
      const ang = rotRad + i * step - Math.PI / 2; // 上向き始点
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
    starCache.set(key, p);
    return p;
  }
  

function drawStar(x, y, radius) {
  const rot = Math.random() * Math.PI * 2;
  const path = getStarPath(radius, rot);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';  // ★ 加算合成で重なりが光る
  ctx.translate(x, y);

  ctx.shadowColor = hexToRgba(CONFIG.GLOW_COLOR, CONFIG.GLOW_OPACITY);
  ctx.shadowBlur  = CONFIG.GLOW;
  ctx.fillStyle   = CONFIG.COLOR;

  ctx.fill(path);
  ctx.restore();
}



  // ===== 軌跡モード管理 =====
  let trailActive = false;   // 新規描画を受け付けるか
  let hasDrawn    = false;   // 一度でも描いたか（キャンバスを残す用）
  let last = null;           // 最後に判定した点
  let nextStep = pickStep(); // 次に印を打つまでの距離

  function setTrailActive(on) {
    trailActive = !!on;
    document.body.classList.toggle('is-trail', trailActive);
    if (!trailActive) return;
    // ON にした直後は “連続性” を断つ（次の移動から開始）
    last = null;
    nextStep = pickStep();
  }

  // trail.js 内のどこか上（setTrailActiveの近く）に追加
function clearStars() {
  const dpr = CONFIG.DPR;
  // setTransform(dpr, …) を使っているので CSS px で消す
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  hasDrawn = false;
  document.body.classList.remove('has-trails');
}


  // ===== ポインタイベント =====
  function handleMove(e) {
  if (!trailActive) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // ★ 毎回、今いる位置に必ず1個打つ
  drawStar(x, y, pickRadius());
  hasDrawn = true;
  document.body.classList.add('has-trails');

  if (!last) {
    last = { x, y };
    return;
  }

  const dx = x - last.x;
  const dy = y - last.y;
  let dist = Math.hypot(dx, dy);

  const ux = dx / dist || 0;
  const uy = dy / dist || 0;

  while (dist >= nextStep) {
    const px = last.x + ux * nextStep;
    const py = last.y + uy * nextStep;

    drawStar(px, py, pickRadius());
    last = { x: px, y: py };
    dist -= nextStep;
    nextStep = pickStep();
  }
}


  function handleUp() {
    // ドラッグ終了時は連続性を切っておくと扱いやすい
    last = null;
    nextStep = pickStep();
  }

  window.addEventListener('pointermove', handleMove, { passive: true });
  window.addEventListener('pointerup', handleUp, { passive: true });
  window.addEventListener('pointercancel', handleUp, { passive: true });

  // ===== シンボル画像のトグル =====
  const imgRT = document.getElementById('locusTopRight');
  const imgLB = document.getElementById('locusBottomLeft');

  function swapToClose(img, toClose) {
    if (!img) return;
    const openSrc  = img.getAttribute('data-open-src');
    const closeSrc = img.getAttribute('data-close-src');
    if (openSrc && closeSrc) {
      img.src = toClose ? closeSrc : openSrc;
      img.dataset.state = toClose ? 'close' : 'open';
    }
  }

  function activate() {
    setTrailActive(true);
    swapToClose(imgRT, true);
    swapToClose(imgLB, true);
  }
  // 既存の deactivate() を これに差し替え
function deactivate() {
  setTrailActive(false);
  swapToClose(imgRT, false);
  swapToClose(imgLB, false);

  // ★ 星（キャンバス）をクリアして完全に消す
  clearStars();

  // 連続性もリセット
  last = null;
  nextStep = pickStep();
}

  function onSymbolClick(e) {
    e.preventDefault();
    e.stopPropagation(); // 親のクリック（動画オーバーレイ等）に伝播させない
    const target = e.currentTarget;
    const state = target?.dataset.state || 'open';
    if (state === 'open') activate();
    else                  deactivate();
  }

  // 初期状態セット＆イベント
  swapToClose(imgRT, false);
  swapToClose(imgLB, false);
  imgRT?.addEventListener('click', onSymbolClick);
  imgLB?.addEventListener('click', onSymbolClick);

  // もし “キャンバスをダブルクリックで全消し” したくなったら↓
  // canvas.addEventListener('dblclick', () => {
  //   ctx.clearRect(0, 0, canvas.width / CONFIG.DPR, canvas.height / CONFIG.DPR);
  //   hasDrawn = false;
  //   document.body.classList.remove('has-trails');
  // });
})();
