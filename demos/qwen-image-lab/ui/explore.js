// Explore — an N×N grid over two controls, and a 1-D walk along one.
//
// Every cell is the same message the deck's Generate sends, with two control
// values overridden and the size cut down, so a grid is not a special render
// path: what a cell shows is what adopting it will give you. Clicking one
// writes its two values back into the real controls.
//
// The walk strip carries the retention meter per frame, with round 3's 0.71
// collapse line marked. That line is the whole reason the strip exists: travel
// is NOT monotone in amplitude past a fader's gainCal edge — push harder and
// the picture swaps rather than the axis moving — and the CLIP probes that
// certified the round-2 desk could not see it happen. A strip with the
// retention number under every frame can.

import { $, retention, pixelMse } from '/app/ui/util.js';

export function initExplore(ctx) {
  const prefs = ctx.prefs;
  let cancelled = false;
  let running = false;
  let walkFrames = [];

  if (prefs.exN != null) $('ex-n').value = prefs.exN;
  if (prefs.exSize != null) $('ex-size').value = prefs.exSize;
  if (prefs.exSteps != null) $('ex-steps').value = prefs.exSteps;

  function status(text, kind) {
    const el = $('ex-status'); el.textContent = text; el.className = kind || '';
  }

  // ── the two control pickers ─────────────────────────────────────────────
  // Anything registered is offerable, but an armed control first: the point of
  // the grid is to see what the rack you already built does either side of
  // where it sits.
  function fillPickers() {
    const all = ctx.controls().filter((c) => c.set && c.key);
    const armed = all.filter((c) => c.active());
    const list = armed.concat(all.filter((c) => !c.active()));
    ['ex-row', 'ex-col'].forEach((id, k) => {
      const sel = $(id);
      const keep = sel.value;
      sel.innerHTML = '';
      if (id === 'ex-col') {
        const none = document.createElement('option');
        none.value = ''; none.textContent = '— none (1-D) —';
        sel.appendChild(none);
      }
      list.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.key;
        o.textContent = (c.active() ? '● ' : '') + c.section + ' · ' + c.label;
        sel.appendChild(o);
      });
      if (keep && list.some((c) => c.key === keep)) sel.value = keep;
      else if (list.length) sel.value = (id === 'ex-col' && list.length > 1) ? list[1].key : list[k] ? list[k].key : list[0].key;
    });
  }

  const pick = (id) => ctx.controlByKey($(id).value);

  // A painted mask and a painted region are token grids captured at the render
  // size. At any other size they are the wrong length and the worker refuses
  // the render — so they ride along only when the grid is at that same size,
  // which is also what makes a fader × arm-step grid possible at all.
  const gridPx = () => ctx.roundSize(+$('ex-size').value || 256);
  function sameSize() {
    const px = gridPx();
    return px === ctx.roundSize($('width').value) && px === ctx.roundSize($('height').value);
  }
  function paintedDropped() {
    if (sameSize()) return false;
    const probe = ctx.buildGenerateMsg();
    return !!(probe.gateMask || (probe.regions && probe.regions.length));
  }

  function baseMsg() {
    const msg = ctx.buildGenerateMsg();
    const px = gridPx();
    msg.opts.width = px; msg.opts.height = px;
    delete msg.opts.outputResolution;
    msg.opts.steps = Math.max(1, +$('ex-steps').value | 0);
    if (!sameSize()) { delete msg.gateMask; delete msg.regions; }
    delete msg.x0;
    return msg;
  }
  function override(ctl, value) {
    // The controls feed the message through their own hooks, so the honest way
    // to override one is to set it, rebuild, and put it back — which is also
    // what makes "adopt this cell" exactly the cell that was rendered.
    const was = ctl.value();
    ctl.set(value, { silent: true });
    const out = baseMsg();
    ctl.set(was, { silent: true });
    return out;
  }
  function withTwo(rowCtl, rowV, colCtl, colV) {
    const wasR = rowCtl.value();
    const wasC = colCtl ? colCtl.value() : 0;
    rowCtl.set(rowV, { silent: true });
    if (colCtl) colCtl.set(colV, { silent: true });
    const out = baseMsg();
    rowCtl.set(wasR, { silent: true });
    if (colCtl) colCtl.set(wasC, { silent: true });
    return out;
  }

  function lerp(lo, hi, i, n) { return n > 1 ? lo + (hi - lo) * (i / (n - 1)) : lo; }

  function thumbOf(frame, box) {
    const cv = document.createElement('canvas');
    const s = Math.min(box / frame.width, box / frame.height, 1);
    cv.width = Math.round(frame.width * s); cv.height = Math.round(frame.height * s);
    const tmp = document.createElement('canvas');
    tmp.width = frame.width; tmp.height = frame.height;
    tmp.getContext('2d').putImageData(frame, 0, 0);
    cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
    return cv;
  }

  function setRunning(on) {
    running = on;
    $('btn-ex-stop').disabled = !on;
    $('btn-ex-grid').disabled = on || !ctx.loaded;
    $('btn-ex-walk').disabled = on || !ctx.loaded;
  }

  // ── the grid ────────────────────────────────────────────────────────────
  function doGrid() {
    if (!ctx.loaded) { status('load a model first', 'err'); return; }
    const rowCtl = pick('ex-row');
    if (!rowCtl) { status('pick a row control', 'err'); return; }
    const colCtl = pick('ex-col');
    const n = Math.max(2, Math.min(6, +$('ex-n').value | 0));
    const rLo = +$('ex-row-lo').value, rHi = +$('ex-row-hi').value;
    const cLo = +$('ex-col-lo').value, cHi = +$('ex-col-hi').value;
    const cols = colCtl ? n : 1;
    const host = $('ex-grid');
    host.innerHTML = '';
    host.style.gridTemplateColumns = 'repeat(' + cols + ', max-content)';
    $('ex-walk').innerHTML = '';
    $('ex-hint').style.display = 'none';
    cancelled = false;
    setRunning(true);
    const t0 = Date.now();
    let k = 0;
    const total = n * cols;
    const dropped = paintedDropped();
    const step = () => {
      if (cancelled || k >= total) {
        setRunning(false);
        status(cancelled ? 'stopped after ' + k + ' cells'
                         : 'grid done · ' + total + ' cells in ' +
                           ((Date.now() - t0) / 1000).toFixed(1) + ' s' +
                           (dropped ? ' · painted cells left out — a grid away from the render ' +
                                      'size cannot carry them' : ''),
               cancelled ? '' : 'ok');
        return;
      }
      const ri = Math.floor(k / cols), ci = k % cols;
      const rv = lerp(rLo, rHi, ri, n);
      const cv = colCtl ? lerp(cLo, cHi, ci, cols) : 0;
      const msg = withTwo(rowCtl, rv, colCtl, cv);
      status('grid · ' + (k + 1) + ' / ' + total + ' · ' + rowCtl.label + ' ' + rv.toFixed(2) +
             (colCtl ? ' · ' + colCtl.label + ' ' + cv.toFixed(2) : ''));
      ctx.renderOffscreen(msg, (err, frame, resp, ms) => {
        if (err) { setRunning(false); status(String(err.message || err), 'err'); return; }
        const cell = document.createElement('div');
        cell.className = 'ex-cell';
        const thumb = thumbOf(frame, 160);
        thumb.title = 'adopt these settings';
        const lab = document.createElement('div');
        lab.className = 'ex-label';
        lab.textContent = rv.toFixed(2) + (colCtl ? ' · ' + cv.toFixed(2) : '');
        cell.appendChild(thumb); cell.appendChild(lab);
        cell.addEventListener('click', () => {
          rowCtl.set(rv);
          if (colCtl) colCtl.set(cv);
          host.querySelectorAll('.ex-cell').forEach((c) => c.classList.remove('pick'));
          cell.classList.add('pick');
          status('adopted ' + rowCtl.label + ' ' + rv.toFixed(2) +
                 (colCtl ? ' · ' + colCtl.label + ' ' + cv.toFixed(2) : ''), 'ok');
        });
        host.appendChild(cell);
        $('ex-timing').textContent = ms + ' ms / cell';
        k++;
        step();
      });
    };
    step();
  }

  // ── the 1-D walk ────────────────────────────────────────────────────────
  // The first frame is the reference every retention number is measured
  // against, so the strip reads "how much of the picture is left" along the
  // sweep and the 0.71 line says where it stopped being the same picture.
  function doWalk() {
    if (!ctx.loaded) { status('load a model first', 'err'); return; }
    const ctl = pick('ex-row');
    if (!ctl) { status('pick a control to walk', 'err'); return; }
    const n = Math.max(2, Math.min(12, (+$('ex-n').value | 0) * 2));
    const lo = +$('ex-row-lo').value, hi = +$('ex-row-hi').value;
    walkFrames = [];
    $('ex-grid').innerHTML = '';
    $('ex-walk').innerHTML = '';
    $('ex-hint').style.display = 'none';
    cancelled = false;
    setRunning(true);
    const dropped = paintedDropped();
    let i = 0;
    const step = () => {
      if (cancelled || i >= n) {
        setRunning(false);
        const collapsed = walkFrames.filter((f) => f.ret < 0.71).length;
        status(cancelled ? 'stopped' :
          'walk done · ' + n + ' frames · ' + collapsed + ' below the 0.71 bar' +
          (dropped ? ' · painted cells left out' : ''), 'ok');
        return;
      }
      const v = lerp(lo, hi, i, n);
      const msg = override(ctl, v);
      status('walk · ' + (i + 1) + ' / ' + n + ' · ' + ctl.label + ' ' + v.toFixed(2));
      ctx.renderOffscreen(msg, (err, frame, resp, ms) => {
        if (err) { setRunning(false); status(String(err.message || err), 'err'); return; }
        const ref = walkFrames.length ? walkFrames[0].frame : frame;
        const r = retention(ref, frame);
        walkFrames.push({ frame: frame, v: v, ret: r });
        const cell = document.createElement('div');
        cell.className = 'walk-cell';
        const thumb = thumbOf(frame, 140);
        thumb.title = 'adopt ' + ctl.label + ' = ' + v.toFixed(2);
        const lab = document.createElement('div');
        lab.className = 'walk-label'; lab.textContent = v.toFixed(2);
        const ret = document.createElement('div');
        ret.className = 'walk-ret' + (r < 0.71 ? ' under' : '');
        ret.textContent = r.toFixed(3);
        ret.title = 'retention against the first frame · pixel mse ' +
                    pixelMse(ref, frame).toFixed(0) +
                    (r < 0.71 ? ' — below round 3\'s 0.71 bar: a different picture' : '');
        cell.appendChild(thumb); cell.appendChild(lab); cell.appendChild(ret);
        cell.addEventListener('click', () => {
          ctl.set(v);
          status('adopted ' + ctl.label + ' ' + v.toFixed(2), 'ok');
        });
        $('ex-walk').appendChild(cell);
        $('ex-timing').textContent = ms + ' ms / frame';
        i++;
        step();
      });
    };
    step();
  }

  $('btn-ex-grid').addEventListener('click', doGrid);
  $('btn-ex-walk').addEventListener('click', doWalk);
  $('btn-ex-stop').addEventListener('click', () => { cancelled = true; });
  ['ex-n', 'ex-size', 'ex-steps'].forEach((id) => $(id).addEventListener('change', ctx.persist));

  ctx.onRefreshButtons((busyOrUnloaded) => {
    if (running) return;
    $('btn-ex-grid').disabled = busyOrUnloaded;
    $('btn-ex-walk').disabled = busyOrUnloaded;
  });
  ctx.onDeckRefresh(fillPickers);
  ctx.onPersist((p) => {
    p.exN = $('ex-n').value; p.exSize = $('ex-size').value; p.exSteps = $('ex-steps').value;
  });

  // Test seams.
  ctx.exploreGrid = doGrid;
  ctx.exploreWalk = doWalk;
  ctx.exploreFrames = () => walkFrames.slice();
  ctx.exploreCells = () => Array.from(document.querySelectorAll('#ex-grid .ex-cell'));
  ctx.explorePick = (rowKey, colKey) => {
    fillPickers();
    $('ex-row').value = rowKey;
    $('ex-col').value = colKey || '';
  };

  fillPickers();
}
