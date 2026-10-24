// Layout tab: a UI described only by relations between boxes and the
// container; bro.layout.solve places every box. The result is drawn as real
// elements, re-solved live as the container is resized, and the page then
// evaluates every constraint against the solved geometry itself.

import { $, h, clear } from "/lib/kit/index.js";
import { C, verdict, checks, legend, presetPicker } from "./common.js";

const SWATCH = ['#5c9dff', '#7fe6a8', '#e6c07f', '#b48cff', '#5fd1d1', '#ff9f6b', '#e57fc0'];

export const PRESETS = {
  editor: {
    label: 'Editor shell',
    size: [960, 560],
    nonOverlap: true,
    gap: 12,
    note: 'A header, two fixed-width side panels and a viewport with a timeline under it. Only the inspector has freedom: anywhere from 180 to 320 px, but at least a third of the viewport.',
    boxes: ['header', 'sidebar', 'viewport', 'inspector', 'timeline'].map((id) => ({ id })),
    constraints: `header.x == 12
header.y == 12
header.right == container.w - 12
header.h == 40
sidebar.x == 12
sidebar.y == header.bottom + 12
sidebar.w == 200
sidebar.bottom == container.h - 12
inspector.right == container.w - 12
inspector.y == sidebar.y
inspector.bottom == container.h - 12
inspector.w >= 180
inspector.w <= 320
3 * inspector.w >= viewport.w
viewport.x == sidebar.right + 12
viewport.right == inspector.x - 12
viewport.y == sidebar.y
timeline.x == viewport.x
timeline.right == viewport.right
timeline.h == 120
timeline.y == viewport.bottom + 12
timeline.bottom == container.h - 12`,
  },
  cards: {
    label: 'Equal cards',
    size: [880, 360],
    nonOverlap: true,
    gap: 16,
    note: 'Three cards of equal width across the container. Three equal widths rarely divide the space exactly, so the right edge may fall up to 2 px short.',
    boxes: ['a', 'b', 'c'].map((id) => ({ id })),
    constraints: `a.x == 16
a.y == 16
a.bottom == container.h - 16
b.x == a.right + 16
c.x == b.right + 16
c.right <= container.w - 16
c.right >= container.w - 18
b.w == a.w
c.w == a.w
b.y == a.y
c.y == a.y
b.h == a.h
c.h == a.h`,
  },
  dialog: {
    label: 'Centred dialog',
    size: [900, 560],
    nonOverlap: false,
    gap: 0,
    note: 'A dialog centred in the container (within a pixel), a title across its top and two buttons in its bottom-right corner. The parts sit inside the dialog, so overlap is allowed here.',
    boxes: [{ id: 'dialog', minW: 380, maxW: 380, minH: 200, maxH: 200 }, { id: 'title' }, { id: 'cancel' }, { id: 'ok' }],
    constraints: `2 * dialog.x + dialog.w >= container.w - 1
2 * dialog.x + dialog.w <= container.w
2 * dialog.y + dialog.h >= container.h - 1
2 * dialog.y + dialog.h <= container.h
title.x == dialog.x + 16
title.y == dialog.y + 16
title.right == dialog.right - 16
title.h == 28
ok.w == 96
ok.h == 32
ok.right == dialog.right - 16
ok.bottom == dialog.bottom - 16
cancel.w == 96
cancel.h == 32
cancel.right == ok.x - 8
cancel.y == ok.y`,
  },
  tight: {
    label: 'Does it fit?',
    size: [560, 360],
    nonOverlap: true,
    gap: 16,
    note: 'Two panels at least 300 px wide side by side. At 560 px no layout exists, and the solver says so; drag the width past 648 px and it does.',
    boxes: [{ id: 'left', minW: 300 }, { id: 'right', minW: 300 }],
    constraints: `left.x == 16
left.y == 16
left.bottom == container.h - 16
right.x >= left.right + 16
right.right <= container.w - 16
right.y == left.y
right.h == left.h`,
  },
};

const PROPS = ['x', 'y', 'w', 'h', 'right', 'bottom'];

export function createLayoutTab(app) {
  const answer = verdict('#layout-verdict');
  const checkList = checks('#layout-checks');
  const picker = presetPicker('#layout-presets', PRESETS, (k) => load(k));
  const state = { key: null, spec: null, result: null, solves: 0, lastMs: 0, error: null };

  const cw = $('#layout-cw'), ch = $('#layout-ch');
  const syncSize = () => {
    $('#layout-cw-val').textContent = cw.value + ' px';
    $('#layout-ch-val').textContent = ch.value + ' px';
  };

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    state.solves = 0;
    picker.select(key);
    $('#layout-note').textContent = p.note;
    $('#layout-boxes').value = '[\n' + p.boxes.map((b) => '  ' + JSON.stringify(b)).join(',\n') + '\n]';
    $('#layout-cons').value = p.constraints;
    $('#layout-nonoverlap').checked = p.nonOverlap;
    $('#layout-gap').value = String(p.gap);
    cw.value = String(p.size[0]);
    ch.value = String(p.size[1]);
    syncSize();
    run();
  }

  // The editors as a bro.layout.solve spec. Boxes without bounds may take
  // any size and position inside the container.
  function readSpec() {
    const W = Number(cw.value), H = Number(ch.value);
    const boxes = JSON.parse($('#layout-boxes').value).map((b) => Object.assign({
      minX: 0, maxX: W, minY: 0, maxY: H, minW: 1, maxW: W, minH: 1, maxH: H,
    }, b));
    const constraints = $('#layout-cons').value.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('//'));
    return {
      container: { w: W, h: H },
      nonOverlap: $('#layout-nonoverlap').checked,
      gap: Number($('#layout-gap').value) || 0,
      boxes,
      constraints,
    };
  }

  function run() {
    let spec;
    try { spec = readSpec(); } catch (e) {
      state.error = 'Boxes are not valid JSON: ' + e.message;
      answer.set('err', 'ERROR', state.error);
      app.fail(state.error);
      return;
    }
    state.error = null;
    state.spec = spec;
    const t0 = Date.now();
    const r = bro.layout.solve(spec);
    state.lastMs = Date.now() - t0;
    state.solves++;
    state.result = r && r.sat ? r : { sat: false };
    report();
    app.redraw();
  }

  function report() {
    const r = state.result, spec = state.spec;
    const W = spec.container.w, H = spec.container.h;
    const list = [];
    if (r.sat) {
      answer.set('ok', 'SAT', `${spec.boxes.length} boxes placed at ${W} × ${H}`);
      const failures = spec.constraints.filter((c) => !holds(c, r.boxes, spec.container));
      list.push({
        ok: failures.length === 0,
        label: failures.length ? `${failures.length} of ${spec.constraints.length} constraints fail on the solved boxes` : `all ${spec.constraints.length} constraints hold when the page evaluates them on the solved boxes`,
        detail: failures.length ? failures.join('; ') : null,
      });
      const outside = Object.values(r.boxes).filter((b) => b.x < 0 || b.y < 0 || b.right > W || b.bottom > H);
      list.push({ ok: outside.length === 0, label: outside.length ? `${outside.map((b) => b.id).join(', ')} leave the container` : 'every box lies inside the container' });
      if (spec.nonOverlap) list.push(overlapCheck(Object.values(r.boxes), spec.gap));
    } else {
      answer.set('err', 'UNSAT', `no layout satisfies the constraints at ${W} × ${H}`);
      list.push({ ok: null, label: 'nothing to check: the solver proved the constraints contradict each other at this size', detail: PRESETS[state.key] && state.key === 'tight' ? 'widen the container' : null });
    }
    list.push({ ok: null, label: `re-solved ${state.solves} time${state.solves === 1 ? '' : 's'} since the example loaded; this one took ${state.lastMs} ms` });
    const tally = checkList.set(list);
    app.report({ verdict: r.sat ? 'SAT' : 'UNSAT', solved: `${spec.boxes.length} boxes`, checks: `${tally.passed}/${list.filter((c) => c.ok !== null).length}` },
      r.sat ? `Layout solved in ${state.lastMs} ms` : 'No layout exists at this size', r.sat && !tally.failed ? 'ok' : 'warn');
  }

  function draw() {
    const view = clear($('#layout-view'));
    const spec = state.spec, r = state.result;
    if (!spec || !r) return;
    const W = spec.container.w, H = spec.container.h;
    const vw = view.clientWidth || 800, vh = view.clientHeight || 500;
    const pad = 28;
    const s = Math.min(1, (vw - pad * 2) / W, (vh - pad * 2 - 16) / H);
    const ox = Math.round((vw - W * s) / 2), oy = Math.round((vh - H * s) / 2 + 8);
    const px = (v) => Math.round(v * s) + 'px';

    $('#layout-title').textContent = r.sat ? `Solved layout at ${W} × ${H}` : `Infeasible at ${W} × ${H}`;
    legend('#layout-legend', r.sat ? [[C.borderHi, 'container', 'ring']] : []);

    const frame = h('div.lframe', { style: { left: ox + 'px', top: oy + 'px', width: px(W), height: px(H) } },
      h('span.dim', null, `container ${W} × ${H}${s < 1 ? `, shown at ${Math.round(s * 100)}%` : ''}`));
    view.appendChild(frame);
    if (!r.sat) {
      view.appendChild(h('div.lmsg', null, 'No layout satisfies every constraint at this size.',
        h('small', null, 'bro.layout.solve returned UNSAT. Change the size or the constraints.')));
      return;
    }
    const boxes = spec.boxes.map((b) => r.boxes[b.id]).filter(Boolean);
    const overlapping = spec.nonOverlap ? overlappers(boxes, 0) : new Set();
    boxes.forEach((b, i) => {
      const el = h('div.lbox' + (overlapping.has(b.id) ? '.bad' : ''), {
        style: {
          left: (ox + Math.round(b.x * s)) + 'px', top: (oy + Math.round(b.y * s)) + 'px',
          width: px(b.w), height: px(b.h), borderLeft: '3px solid ' + SWATCH[i % SWATCH.length],
        },
      }, h('b', null, b.id), h('span', null, `${b.w} × ${b.h}`), h('span', null, `at ${b.x}, ${b.y}`));
      view.appendChild(el);
    });
  }

  for (const el of [cw, ch]) el.addEventListener('input', () => { syncSize(); run(); });
  $('#layout-run').addEventListener('click', run);
  $('#layout-nonoverlap').addEventListener('change', run);
  syncSize();

  return { state, load, run, draw, question: 'Where does every box go, given only how the boxes relate?' };
}

// Evaluate one constraint line with the solved boxes and the container in scope.
function holds(line, boxes, container) {
  const ids = Object.keys(boxes);
  const scope = ids.map((id) => {
    const b = boxes[id];
    const o = {};
    for (const p of PROPS) o[p] = b[p];
    return o;
  });
  try {
    return !!(new Function(...ids, 'container', '"use strict"; return (' + line + ');'))(...scope, container);
  } catch (e) {
    return false;
  }
}

function overlapCheck(boxes, gap) {
  let closest = Infinity, pair = null;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const dx = Math.max(b.x - a.right, a.x - b.right);
      const dy = Math.max(b.y - a.bottom, a.y - b.bottom);
      const sep = Math.max(dx, dy);
      if (sep < closest) { closest = sep; pair = [a.id, b.id]; }
    }
  }
  if (!pair) return { ok: true, label: 'one box: nothing can overlap' };
  return {
    ok: closest >= gap,
    label: closest < 0 ? `${pair[0]} and ${pair[1]} overlap` : `no two boxes overlap; the closest pair (${pair[0]}, ${pair[1]}) is ${closest} px apart`,
    detail: `required gap ${gap} px`,
  };
}

function overlappers(boxes, gap) {
  const out = new Set();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (Math.max(b.x - a.right, a.x - b.right, b.y - a.bottom, a.y - b.bottom) < gap) { out.add(a.id); out.add(b.id); }
    }
  }
  return out;
}
