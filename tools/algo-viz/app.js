// Algorithm visualizer shell — registry-driven. Each viz module pushes a
// descriptor onto window.VIZ; this file builds the sidebar, mounts the
// active viz into #stage / #params, and tears it down on switch.

const sidebarEl = document.getElementById('viz-list');
const stageEl   = document.getElementById('stage');
const paramsEl  = document.getElementById('params');
const titleEl   = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');

let activeId = null;
let activeHandle = null;
let activeDef = null;

function buildSidebar() {
    const byCat = new Map();
    for (const v of VIZ) {
        if (!byCat.has(v.category)) byCat.set(v.category, []);
        byCat.get(v.category).push(v);
    }
    sidebarEl.innerHTML = '';
    for (const [cat, items] of byCat) {
        const h = document.createElement('div');
        h.className = 'cat-header'; h.textContent = cat;
        sidebarEl.appendChild(h);
        for (const v of items) {
            const row = document.createElement('div');
            row.className = 'viz-item';
            row.textContent = v.name;
            row.dataset.id = v.id;
            row.onclick = () => activate(v.id);
            sidebarEl.appendChild(row);
        }
    }
}

function activate(id) {
    if (id === activeId) return;
    if (activeHandle && activeDef) {
        try { activeDef.destroy(activeHandle); }
        catch (e) { console.error('destroy', activeDef.id, e); }
    }
    stageEl.innerHTML = '';
    paramsEl.innerHTML = '';

    const def = VIZ.find(v => v.id === id);
    if (!def) return;

    activeId = id; activeDef = def;
    titleEl.textContent = def.name;
    subtitleEl.textContent = def.subtitle || '';

    for (const el of sidebarEl.querySelectorAll('.viz-item')) {
        el.classList.toggle('active', el.dataset.id === id);
    }

    try {
        activeHandle = def.init({ stage: stageEl, params: paramsEl });
    } catch (e) {
        console.error('init', id, e);
        stageEl.textContent = 'init failed: ' + e.message;
        activeHandle = null;
    }
}

buildSidebar();
if (VIZ.length) activate(VIZ[0].id);
