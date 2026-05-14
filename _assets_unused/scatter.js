// scatter.js（置き換え）
const items = [
  // href は “ホームのハッシュ”、detail は “詳細ページ”
  { id: 'object001', label: 'object001', href: '#object001', detail: 'index.html' },
  { id: 'object002', label: 'object002', href: '#object002', detail: 'object002.html' },
  { id: 'object003', label: 'object003', href: '#object003', detail: 'object002.html' },
  { id: 'object004', label: 'object004', href: '#object004', detail: 'object002.html' },
];

const area = document.getElementById('scatter');

function layout() {
  if (!area) return;
  area.innerHTML = '';

  const rect = area.getBoundingClientRect();
  const w = rect.width, h = rect.height;

  items.forEach((item) => {
    const a = document.createElement('a');
    a.className = 'scatter-item';
    a.href = item.href; // 右クリックや新規タブ用に残す（#のみなので同一ページ）
    a.dataset.id = item.id;
    a.innerHTML = `<span class="label">${item.label}</span>`;

    // ランダム配置
    const x = (0.08 + Math.random() * 0.84) * w;
    const y = (0.30 + Math.random() * 0.60) * h;
    const rot = Math.random() * 8 - 4;
    a.style.left = `${Math.round(x)}px`;
    a.style.top  = `${Math.round(y)}px`;
    a.style.setProperty('--rot', `${rot}deg`);

    // クリック：ホーム内のモデルだけ切替（遷移しない）
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.scatter-item').forEach(el => el.classList.remove('is-active'));
      a.classList.add('is-active');

      // URL ハッシュも同期（リロード/共有しても再現できる）
      history.replaceState(null, '', item.href);

      if (window.selectModel) window.selectModel(item.id);
    });

    // ダブルクリック：詳細ページへ遷移
    a.addEventListener('dblclick', (e) => {
      e.preventDefault();
      window.location.href = item.detail;
    });

    area.appendChild(a);
  });
}

layout();
window.addEventListener('resize', layout);
