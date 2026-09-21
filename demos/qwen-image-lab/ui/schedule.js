// The schedule editor — a curve per armed control, steps on x.
//
// Round 3 measured a desk fitted at 8 steps losing 30-37% of its travel at 40,
// with nothing in-network able to recover it, and found the same thing from
// the other side: a knob armed LATE is a different knob, not a weaker one
// (cos(early, late) is between -0.13 and +0.08 for five of the six schedulable
// knobs). So when a control lands matters as much as how far it is pushed, and
// this is where that is said.
//
// Every armed control gets a lane. A lane is one coefficient per step:
//
//   axis lanes     become qwenImage21AddControlSchedule(axis, alpha[], lo, hi)
//                  with alpha[i] = value * curve[i]. The axis is then taken
//                  OUT of the prime-time stack, because a schedule composes
//                  with setControl and leaving it in both counts it twice.
//   desk lanes     scale the FADER per step before the parameter vector is
//                  built, which is not the same as scaling one knob late: a
//                  fader is a direction through the knob space.
//   hook lanes     (gate multipliers, the gate delta, the mod delta, norm_out,
//                  the prefix-K/V dial) scale the control away from its own
//                  neutral, so a curve at 0 means "off at this step" whether
//                  the control's neutral is 0 or 1.
//
// The desk's own early/mid/late basis is drawn behind the lanes as a reminder
// of what a scheduled fader already does by itself — a curve here rides on top
// of that shape rather than replacing it.

import { $ } from '/app/ui/util.js';

const PRESETS = {
  flat: (n) => new Array(n).fill(1),
  off: (n) => new Array(n).fill(0),
  early: (n) => Array.from({ length: n }, (_, i) => (i < Math.max(1, Math.round(n / 3)) ? 1 : 0)),
  late: (n) => Array.from({ length: n }, (_, i) => (i >= n - Math.max(1, Math.round(n / 3)) ? 1 : 0)),
  ramp: (n) => Array.from({ length: n }, (_, i) => (n > 1 ? i / (n - 1) : 1)),
  fall: (n) => Array.from({ length: n }, (_, i) => (n > 1 ? 1 - i / (n - 1) : 1)),
  mid: (n) => Array.from({ length: n }, (_, i) => (n > 1 ? 1 - Math.abs(2 * (i / (n - 1)) - 1) : 1)),
};

const LANE_H = 46, LANE_GAP = 6, LEFT = 130, TOP = 18, RIGHT = 14;

export function initSchedule(ctx) {
  // { laneKey: number[] } — authored at whatever step count was current; the
  // worker resamples a curve whose length no longer matches, so changing the
  // step count re-times a shape instead of truncating it.
  let curves = (ctx.prefs.curves && typeof ctx.prefs.curves === 'object') ? ctx.prefs.curves : {};
  let lanes = [];       // [{key, label, kind, controls:[registry entries]}]
  let selected = null;
  const canvas = $('sched-canvas');
  const cctx = canvas.getContext('2d');

  const steps = () => Math.max(1, +$('steps').value || 8);

  function laneOf(r) {
    if (!r.lane) return null;
    if (r.lane.indexOf('axis:') === 0) return { key: r.lane, label: r.lane.slice(5), kind: 'axis' };
    if (r.lane.indexOf('desk:') === 0) return { key: r.lane, label: 'desk · ' + r.lane.slice(5), kind: 'desk' };
    const names = { gateRows: 'gate multipliers', gateDelta: 'gate delta', mod: 'mod delta',
                    normOut: 'norm_out', prefixKv: 'prefix K/V' };
    return { key: r.lane, label: names[r.lane] || r.lane, kind: 'hook' };
  }

  function rebuildLanes() {
    const by = {};
    lanes = [];
    ctx.armedControls().forEach((r) => {
      const l = laneOf(r);
      if (!l) return;
      if (!by[l.key]) { by[l.key] = { key: l.key, label: l.label, kind: l.kind, controls: [] }; lanes.push(by[l.key]); }
      by[l.key].controls.push(r);
    });
    if (selected && !by[selected]) selected = null;
    if (!selected && lanes.length) selected = lanes[0].key;
    renderLaneList();
    renderLaneSelect();
    draw();
  }

  function curveFor(key) {
    const n = steps();
    let c = curves[key];
    if (!c || !c.length) return PRESETS.flat(n);
    if (c.length === n) return c.slice();
    // Resample rather than pad: the shape is the intent, the step count is not.
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = (n > 1 ? i / (n - 1) : 0) * (c.length - 1);
      const a = Math.floor(x), b = Math.min(c.length - 1, a + 1), f = x - a;
      out[i] = (+c[a] || 0) * (1 - f) + (+c[b] || 0) * f;
    }
    return out;
  }
  function isFlat(key) {
    const c = curves[key];
    if (!c || !c.length) return true;
    for (let i = 0; i < c.length; i++) if (Math.abs(c[i] - 1) > 1e-6) return false;
    return true;
  }
  function setCurve(key, arr) {
    const flat = arr.every((v) => Math.abs(v - 1) < 1e-6);
    if (flat) delete curves[key]; else curves[key] = arr.slice();
    ctx.persist();
    renderLaneList();
    draw();
  }

  // ── the rail's lane list ────────────────────────────────────────────────
  function shapeOf(key) {
    if (isFlat(key)) return 'flat';
    const c = curveFor(key);
    return c.map((v) => (v <= 0.01 ? '·' : v >= 0.99 ? '█' : '▄')).join('');
  }
  function renderLaneList() {
    const host = $('sched-lanes');
    host.innerHTML = '';
    if (!lanes.length) {
      const e = document.createElement('div');
      e.className = 'deck-empty';
      e.textContent = 'nothing armed — a lane appears for every control off neutral';
      host.appendChild(e);
      return;
    }
    lanes.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'sched-lane-row' + (l.key === selected ? ' sel' : '');
      const nm = document.createElement('span');
      nm.className = 'sched-lane-name';
      nm.textContent = l.label;
      nm.title = l.controls.map((c) => c.label + ' ' + c.value().toFixed(2)).join(' · ');
      const sh = document.createElement('span');
      sh.className = 'sched-lane-shape';
      sh.textContent = shapeOf(l.key);
      row.appendChild(nm); row.appendChild(sh);
      row.addEventListener('click', () => { selected = l.key; renderLaneList(); renderLaneSelect(); draw(); });
      host.appendChild(row);
    });
  }
  function renderLaneSelect() {
    const sel = $('sched-lane');
    sel.innerHTML = '';
    lanes.forEach((l) => {
      const o = document.createElement('option');
      o.value = l.key; o.textContent = l.label;
      sel.appendChild(o);
    });
    if (selected) sel.value = selected;
    $('sched-steps-note').textContent = steps() + ' steps · ' + lanes.length + ' lane' +
      (lanes.length === 1 ? '' : 's');
  }

  // ── the timeline ────────────────────────────────────────────────────────
  function geom() {
    const n = steps();
    const w = canvas.width - LEFT - RIGHT;
    return { n: n, w: w, cw: w / n };
  }
  function draw() {
    const n = steps();
    const h = TOP + lanes.length * (LANE_H + LANE_GAP) + 26;
    if (canvas.height !== Math.max(120, h)) canvas.height = Math.max(120, h);
    const g = geom();
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    cctx.fillStyle = '#0b0e13';
    cctx.fillRect(0, 0, canvas.width, canvas.height);
    $('sched-hint').style.display = lanes.length ? 'none' : '';
    if (!lanes.length) return;

    // step ruler
    cctx.fillStyle = '#4d5562';
    cctx.font = '9px sans-serif';
    for (let i = 0; i < n; i++) {
      const x = LEFT + i * g.cw;
      cctx.fillStyle = (i % 2) ? '#0d1116' : '#10141b';
      cctx.fillRect(x, TOP, g.cw - 1, lanes.length * (LANE_H + LANE_GAP) - LANE_GAP);
      cctx.fillStyle = '#4d5562';
      cctx.fillText(String(i), x + 2, TOP - 5);
    }

    lanes.forEach((l, li) => {
      const y = TOP + li * (LANE_H + LANE_GAP);
      cctx.strokeStyle = l.key === selected ? '#c9822f' : '#1a1f27';
      cctx.lineWidth = 1;
      cctx.strokeRect(LEFT + 0.5, y + 0.5, g.w - 1, LANE_H - 1);
      cctx.fillStyle = l.key === selected ? '#f0a860' : '#9aa3b0';
      cctx.font = '11px sans-serif';
      cctx.fillText(l.label.slice(0, 20), 6, y + 15);
      cctx.fillStyle = '#4d5562';
      cctx.font = '9px sans-serif';
      cctx.fillText(l.controls.map((c) => c.value().toFixed(2)).join(' '), 6, y + 28);

      // The desk's own early/mid/late basis, behind a desk lane: what a
      // scheduled fader already does before any curve rides on it.
      if (l.kind === 'desk') {
        const B = ['#3a5a7a', '#3a7a5a', '#7a5a3a'];
        for (let b = 0; b < 3; b++) {
          cctx.strokeStyle = B[b];
          cctx.beginPath();
          for (let i = 0; i < n; i++) {
            const u = n > 1 ? i / (n - 1) : 0;
            const v = b === 0 ? Math.max(0, 1 - 2 * u)
                    : b === 1 ? 1 - Math.abs(2 * u - 1)
                              : Math.max(0, 2 * u - 1);
            const x = LEFT + (i + 0.5) * g.cw, yy = y + LANE_H - 3 - v * (LANE_H - 8);
            if (i === 0) cctx.moveTo(x, yy); else cctx.lineTo(x, yy);
          }
          cctx.stroke();
        }
      }

      const c = curveFor(l.key);
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(1.5, c[i]));
        const bh = (v / 1.5) * (LANE_H - 6);
        cctx.fillStyle = l.key === selected ? 'rgba(240,168,96,0.75)' : 'rgba(122,144,170,0.5)';
        cctx.fillRect(LEFT + i * g.cw + 1, y + LANE_H - 3 - bh, g.cw - 2, bh);
      }
      // the 1.0 line — "full setting"
      cctx.strokeStyle = 'rgba(255,255,255,0.18)';
      cctx.beginPath();
      const y1 = y + LANE_H - 3 - (1 / 1.5) * (LANE_H - 6);
      cctx.moveTo(LEFT, y1); cctx.lineTo(LEFT + g.w, y1);
      cctx.stroke();
    });
    $('sched-meta').textContent = lanes.filter((l) => !isFlat(l.key)).length + ' shaped · ' +
      lanes.length + ' armed';
  }

  // ── drawing on the canvas ───────────────────────────────────────────────
  let drawing = false;
  function paintAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.x) * (canvas.width / r.width);
    const y = (clientY - r.y) * (canvas.height / r.height);
    const li = Math.floor((y - TOP) / (LANE_H + LANE_GAP));
    if (li < 0 || li >= lanes.length) return;
    const g = geom();
    const i = Math.floor((x - LEFT) / g.cw);
    if (i < 0 || i >= g.n) return;
    const laneTop = TOP + li * (LANE_H + LANE_GAP);
    const v = Math.max(0, Math.min(1.5,
      ((laneTop + LANE_H - 3) - y) / (LANE_H - 6) * 1.5));
    const l = lanes[li];
    selected = l.key;
    const c = curveFor(l.key);
    c[i] = Math.round(v * 20) / 20;
    setCurve(l.key, c);
    renderLaneSelect();
  }
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    paintAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) paintAt(e.clientX, e.clientY); });
  const stop = () => {
    if (!drawing) return;
    drawing = false;
    if (ctx.live) ctx.schedule('full');
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  $('sched-lane').addEventListener('change', () => {
    selected = $('sched-lane').value;
    renderLaneList(); draw();
  });
  $('btn-sched-apply').addEventListener('click', () => {
    if (!selected) return;
    const fn = PRESETS[$('sched-preset').value] || PRESETS.flat;
    setCurve(selected, fn(steps()));
    if (ctx.live) ctx.schedule('full');
  });
  $('btn-sched-set').addEventListener('click', () => {
    if (!selected) return;
    const i = Math.max(0, Math.min(steps() - 1, +$('sched-step').value | 0));
    const c = curveFor(selected);
    c[i] = +$('sched-value').value || 0;
    setCurve(selected, c);
    if (ctx.live) ctx.schedule('full');
  });
  $('btn-sched-clear').addEventListener('click', () => {
    curves = {};
    ctx.persist();
    renderLaneList(); draw();
    if (ctx.live) ctx.schedule('full');
  });
  $('steps').addEventListener('change', () => { renderLaneSelect(); draw(); });

  ctx.onDeckRefresh(rebuildLanes);

  ctx.onPersist((p) => { p.curves = curves; });
  ctx.onGenerateMsg((msg) => {
    const n = steps();
    const out = { schedule: [], lanes: {} };
    lanes.forEach((l) => {
      if (isFlat(l.key)) return;
      const c = curveFor(l.key);
      if (l.kind === 'axis') {
        const name = l.key.slice(5);
        out.schedule.push({ axis: name, value: l.controls[0].value(), curve: c, lo: 0, hi: n });
      } else if (l.kind === 'desk') {
        out.lanes.desk = out.lanes.desk || {};
        out.lanes.desk[l.key.slice(5)] = c;
      } else {
        out.lanes[l.key] = c;
      }
    });
    if (out.schedule.length) msg.schedule = out.schedule;
    if (Object.keys(out.lanes).length) msg.lanes = out.lanes;
  });

  // Test seams: a curve is state, not a gesture.
  ctx.setCurve = (key, arr) => { setCurve(key, arr); renderLaneSelect(); };
  ctx.curveFor = curveFor;
  ctx.schedLanes = () => lanes.map((l) => ({ key: l.key, label: l.label, kind: l.kind }));
  ctx.selectLane = (k) => { selected = k; renderLaneList(); renderLaneSelect(); draw(); };

  rebuildLanes();
}
