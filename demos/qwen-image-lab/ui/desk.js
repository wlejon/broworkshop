// The desk — assets/controller.json's fitted faders.
//
// A fader is a direction in the scheduled knob-parameter space (29 parameters
// over 17 knobs in the round-2 file, more in round 3's), derived by ridge from
// a dataset of renders scored against 27 CLIP/pixel readouts and inverted with
// a regularised right pseudo-inverse. A slider of 1.0 means "move this axis by
// tau * gainCal[fader] sigmas of its own readout and leave the other target
// axes alone". The safe range is +/-2.
//
// gainCal is the box redrawn BY RENDER (round 3): per fader, the largest
// amplitude whose +/-2 renders still hold their subject. Travel is NOT monotone
// in amplitude past that edge — pushing harder swaps the picture rather than
// moving the axis, and the CLIP probes that certified the old desk could not
// see it happen.
//
// The fader -> knob-vector -> per-step hook mapping lives in the worker (a port
// of the research lib's controller/sched/dials/hooks); this panel is the
// sliders, what each one spends, and the retention meter that says whether the
// render is still the same picture.

import { $, pixelMse, retention } from '/app/ui/util.js';

export function initDesk(ctx) {
  let faders = {};        // { name: buildCtl handle }
  let info = null;
  let baseline = null;    // ImageData of the untouched render
  let baselineNote = '';

  function applyDesk(deskInfo) {
    info = deskInfo;
    const host = $('desk-rows');
    host.innerHTML = '';
    ctx.unregisterGroup('desk');
    faders = {};
    if (!info || !info.faders || !info.faders.length) {
      const e = document.createElement('div');
      e.className = 'deck-empty';
      e.textContent = 'no controller.json loaded';
      host.appendChild(e);
      $('desk-sub').textContent = '—';
      ctx.refreshDeck();
      return;
    }
    $('desk-sub').textContent =
      'v' + info.version + ' · ' + info.model + ' · ' + info.faders.length + ' faders over ' +
      info.knobs.length + ' knobs' + (info.scheduled ? ' · scheduled' : ' · static');
    const saved = (ctx.prefs.desk && typeof ctx.prefs.desk === 'object') ? ctx.prefs.desk : {};
    info.faders.forEach((f) => {
      faders[f.name] = ctx.buildCtl({
        label: f.name,
        title: f.name + ' — reads ' + f.feat + ' · 1.0 ≈ ' + f.tau.toFixed(2) +
               ' sigma (tau x gainCal ' + f.gain + ')' +
               (f.knobs.length ? ' · spends ' + f.knobs.join(', ') : '') +
               (f.clipped ? ' · clipped at fit time' : ''),
        key: 'desk.' + f.name, group: 'desk',
        min: -2, max: 2, step: 0.05,
        value: +saved[f.name] || 0,
        section: 'desk', host: host,
        chip: () => f.name,
        commit: () => {},
      });
    });
    $('desk-tau').textContent = info.faders.length
      ? info.faders[0].tau.toFixed(2) + '–' +
        info.faders.map((f) => f.tau).reduce((a, b) => Math.max(a, b), 0).toFixed(2)
      : 'tau';
    renderTravel();
    ctx.refreshDeck();
  }

  // What each non-zero fader is currently spending, in the knob names the
  // research file uses — the honest answer to "what is this slider doing".
  function renderTravel() {
    const host = $('desk-travel');
    host.innerHTML = '';
    if (!info) return;
    const active = info.faders.filter((f) => faders[f.name] && faders[f.name].value !== 0);
    if (!active.length) {
      const e = document.createElement('div');
      e.className = 'dim';
      e.textContent = 'every fader at zero — this render is the baseline.';
      host.appendChild(e);
      return;
    }
    active.forEach((f) => {
      const v = faders[f.name].value;
      const line = document.createElement('div');
      line.className = 'travel-row';
      const nm = document.createElement('span');
      nm.className = 'travel-name';
      nm.textContent = f.name;
      const amt = document.createElement('span');
      amt.className = 'travel-amt';
      amt.textContent = (v > 0 ? '+' : '') + v.toFixed(2) + ' ≈ ' +
                        (v * f.tau).toFixed(1) + 'σ ' + f.feat;
      const knobs = document.createElement('span');
      knobs.className = 'travel-knobs';
      knobs.textContent = f.knobs.join(' · ');
      line.appendChild(nm); line.appendChild(amt); line.appendChild(knobs);
      host.appendChild(line);
    });
  }

  // ── retention ───────────────────────────────────────────────────────────
  // Round 3's bar asked whether the render is still the same picture, and
  // answered with CLIP image similarity at a 0.71 cut. There is no CLIP in the
  // app, so this is the structural-similarity proxy over 8x8 luma blocks, plus
  // the raw pixel MSE — enough to see a fader stop moving an axis and start
  // replacing the subject.
  function deskIsNeutral() {
    for (const k in faders) if (faders.hasOwnProperty(k) && faders[k].value !== 0) return false;
    return true;
  }
  function setBaseline(frame, note) {
    baseline = frame;
    baselineNote = note || '';
    updateMeter(frame);
  }
  function updateMeter(frame) {
    const fill = $('ret-fill'), text = $('ret-text');
    if (!baseline || !frame) {
      fill.style.width = '0%';
      text.textContent = 'render with the desk at zero to set a baseline';
      $('retention').classList.remove('over');
      return;
    }
    if (baseline.width !== frame.width || baseline.height !== frame.height) {
      fill.style.width = '0%';
      text.textContent = 'baseline is ' + baseline.width + '×' + baseline.height +
                         ' — re-pin it at this size';
      return;
    }
    const r = retention(baseline, frame);
    const mse = pixelMse(baseline, frame);
    fill.style.width = Math.max(0, Math.min(100, r * 100)).toFixed(0) + '%';
    $('retention').classList.toggle('over', r < 0.71);
    text.textContent = 'retention ' + r.toFixed(3) + ' · pixel mse ' + mse.toFixed(0) +
                       (r < 0.71 ? ' — below the 0.71 bar: this is a different picture'
                                 : (baselineNote ? ' vs ' + baselineNote : ''));
  }

  $('btn-set-baseline').addEventListener('click', () => {
    const frame = ctx.lastFrame();
    if (!frame) { ctx.status('render something first', 'err'); return; }
    setBaseline(frame, 'the pinned render');
    ctx.status('baseline pinned', 'ok');
  });
  $('btn-reset-desk').addEventListener('click', () => {
    let any = false;
    for (const k in faders) {
      if (!faders.hasOwnProperty(k)) continue;
      if (faders[k].value !== 0) any = true;
      faders[k].set(0, { silent: true });
    }
    renderTravel();
    if (any && ctx.live) ctx.schedule('full');
  });

  ctx.onRender((frame) => {
    // A render with the whole desk at zero IS the untouched picture — adopt it
    // automatically so the first comparison needs no ceremony.
    if (deskIsNeutral() && (!baseline || baseline.width !== frame.width ||
                            baseline.height !== frame.height)) {
      setBaseline(frame, 'the untouched render');
    } else {
      updateMeter(frame);
    }
    renderTravel();
  });
  ctx.onDeckRefresh(renderTravel);

  ctx.applyDesk = applyDesk;
  ctx.deskValues = () => {
    const out = {};
    for (const k in faders) if (faders.hasOwnProperty(k) && faders[k].value) out[k] = faders[k].value;
    return out;
  };
  ctx.setFader = (n, v) => { if (faders[n]) faders[n].set(v); };
  ctx.faderNames = () => Object.keys(faders);
  ctx.baselineFrame = () => baseline;
  ctx.onPersist((p) => {
    const d = {};
    for (const k in faders) if (faders.hasOwnProperty(k)) d[k] = faders[k].value;
    p.desk = d;
  });
  ctx.onGenerateMsg((msg) => { msg.desk = ctx.deskValues(); });

  applyDesk(null);   // the empty state, until a model load brings the file
}
