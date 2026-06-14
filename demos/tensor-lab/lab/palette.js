// Tensor Lab — op palette.
//
// The left rail. Lists every op in the registry grouped by category;
// clicking one drops a fresh node into the editor.
import { Ops } from "/app/lab/ops.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function create(panel, onAdd) {
    panel.innerHTML = '';
    panel.appendChild(el('div', 'pal-title', 'OPERATIONS'));
    for (const cat of Ops.categories()) {
      const ops = Ops.byCategory(cat);
      if (!ops.length) continue;
      panel.appendChild(el('div', 'pal-cat', cat));
      for (const def of ops) {
        const btn = el('button', 'pal-op');
        btn.title = def.desc;
        const dot = el('span', 'pal-dot');
        dot.style.background = def.color;
        btn.appendChild(dot);
        btn.appendChild(el('span', 'pal-op-label', def.label));
        btn.addEventListener('click', () => onAdd(def.type));
        panel.appendChild(btn);
      }
    }
    panel.appendChild(el('div', 'pal-hint',
      'Click to add. Drag a node by its body, drag port→port to wire, ' +
      'select + Delete to remove.'));
  }

  export const Palette = { create: create };
