// Node Forge — node palette.
//
// The left rail. Lists every registered node type grouped by category;
// clicking one drops a fresh card into the editor.
import { Nodes } from "/app/lab/node-registry.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function create(panel, onAdd) {
    panel.innerHTML = '';
    panel.appendChild(el('div', 'pal-title', 'NODES'));
    for (const cat of Nodes.categories()) {
      const ops = Nodes.byCategory(cat);
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
      'Click to add. Drag a card by its header to move it, drag port→port ' +
      'to wire, click a card then Delete to remove it. Collapse a card with ' +
      'the ▾ button once you\'re done with it.'));
  }

  export const Palette = { create: create };
