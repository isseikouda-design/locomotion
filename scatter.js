// /js/scatter.js
(() => {
  // 下部に並べる候補（完成したページは href を実URLに）
  const items = [
    { id: 'object001', label: 'object001', href: 'object001.html' },
    { id: 'object002', label: 'object002', href: '#' },
    { id: 'object003', label: 'object003', href: '#' },
    { id: 'object004', label: 'object004', href: '#' },
    { id: 'object005', label: 'object005', href: '#' },
    { id: 'object006', label: 'object006', href: '#' },
    { id: 'object007', label: 'object007', href: '#' },
    { id: 'object008', label: 'object008', href: '#' },
  ];

  const area = document.getElementById('scatter');

  function layout() {
    if (!area) return;
    area.innerHTML = '';
    const rect = area.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    items.forEach((item) => {
      const a = document.createElement('a');
      a.className = 'scatter-item';
      a.href = item.href;
      a.setAttribute('data-id', item.id);
      a.innerHTML = `<span class="label">${item.label}</span>`;

      // 位置をランダムに（左右広め・上下はやや下寄せ）
      const x = (0.08 + Math.random() * 0.84) * w; // 8%〜92%
      const y = (0.30 + Math.random() * 0.60) * h; // 下寄せ
      const rot = Math.random() * 8 - 4;           // -4〜+4度

      a.style.left = `${Math.round(x)}px`;
      a.style.top  = `${Math.round(y)}px`;
      a.style.setProperty('--rot', `${rot}deg`);

      // 触ったとき少し整う
      a.addEventListener('mouseenter', () => a.style.setProperty('--rot', '0deg'));
      a.addEventListener('mouseleave', () => a.style.setProperty('--rot', `${rot}deg`));

      area.appendChild(a);
    });
  }

  // 初期＆リサイズで再配置
  window.addEventListener('resize', layout);
  layout();
})();
