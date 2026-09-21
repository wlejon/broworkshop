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
        key: 'desk.' + f.name, group: 'desk', lane: 'desk:' + f.name,
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
  // ── the prompt-conditioned desk ─────────────────────────────────────────
  // Round 2's diagnosis was that a fader's per-image inconsistency is a
  // shortfall of scene knowledge, and that no per-image gain fixes it: the
  // forward model has no scene input and structurally cannot know which
  // picture it is standing in front of. Round 3's `prompt` block gives it one
  // — the prompt's own conditioning rows, pooled to 4099 numbers, projected to
  // an 8-dimensional p, which indexes a Jacobian the fader directions are
  // re-derived from. One encode and one matrix product, no render.
  //
  // The FADER POSITIONS do not change when this is switched on. What changes
  // is where each fader points, so the panel prints the drift: the cosine
  // between the conditioned direction and the global one, and how much longer
  // or shorter it got.
  let conditioned = !!ctx.prefs.deskConditioned;
  $('desk-conditioned').checked = conditioned;

  function renderDrift(drift, p) {
    const host = $('desk-drift');
    host.innerHTML = '';
    if (!drift) return;
    drift.forEach((d) => {
      const line = document.createElement('div');
      line.className = 'travel-row';
      const nm = document.createElement('span');
      nm.className = 'travel-name'; nm.textContent = d.name;
      const amt = document.createElement('span');
      amt.className = 'travel-amt';
      amt.textContent = 'cos ' + d.cos.toFixed(3) + ' · ×' + d.ratio.toFixed(2);
      amt.title = 'cos 1.00 × 1.00 would mean this prompt asks for exactly the global fader';
      const note = document.createElement('span');
      note.className = 'travel-knobs';
      note.textContent = d.clipped ? 'clipped' : (d.cos < 0.9 ? 're-aimed' : '');
      line.appendChild(nm); line.appendChild(amt); line.appendChild(note);
      host.appendChild(line);
    });
    if (p && p.length) {
      const line = document.createElement('div');
      line.className = 'travel-row';
      const nm = document.createElement('span');
      nm.className = 'travel-name'; nm.textContent = 'p';
      const amt = document.createElement('span');
      amt.className = 'travel-amt';
      amt.textContent = p.map((v) => v.toFixed(2)).join(' ');
      line.appendChild(nm); line.appendChild(amt);
      host.appendChild(line);
    }
  }

  function syncConditioned(refresh) {
    const has = info && info.conditioned;
    $('desk-cond-row').style.display = has ? '' : 'none';
    if (!has) {
      $('desk-cond-state').textContent = 'global — this file has no prompt block';
      renderDrift(null);
      return;
    }
    if (!conditioned) {
      $('desk-cond-state').textContent = 'global';
      renderDrift(null);
      return;
    }
    if (!refresh || !ctx.loaded) { $('desk-cond-state').textContent = 'conditioned'; return; }
    ctx.setBusy(true);
    $('desk-cond-state').textContent = 'encoding the prompt…';
    ctx.client.send({ type: 'conditionDesk', prompt: $('prompt').value, on: true }, (err, resp) => {
      ctx.setBusy(false);
      if (err) {
        conditioned = false;
        $('desk-conditioned').checked = false;
        $('desk-cond-state').textContent = String(err.message || err);
        return;
      }
      $('desk-cond-state').textContent = 'conditioned on this prompt';
      renderDrift(resp.drift, resp.p);
    });
  }

  $('desk-conditioned').addEventListener('change', () => {
    conditioned = $('desk-conditioned').checked;
    ctx.persist();
    syncConditioned(true);
    if (ctx.live && !deskIsNeutral()) ctx.schedule('full');
  });
  $('prompt').addEventListener('change', () => { if (conditioned) syncConditioned(true); });

  ctx.onPersist((p) => {
    const d = {};
    for (const k in faders) if (faders.hasOwnProperty(k)) d[k] = faders[k].value;
    p.desk = d;
    p.deskConditioned = conditioned;
  });
  ctx.onGenerateMsg((msg) => {
    msg.desk = ctx.deskValues();
    if (conditioned) msg.conditioned = true;
  });
  ctx.onLoaded(() => syncConditioned(false));

  ctx.deskConditioned = () => conditioned;
  ctx.setDeskConditioned = (on) => {
    conditioned = !!on;
    $('desk-conditioned').checked = conditioned;
    ctx.persist();
    syncConditioned(true);
  };
  ctx.deskDriftText = () => $('desk-drift').textContent;

  applyDesk(null);   // the empty state, until a model load brings the file
  syncConditioned(false);
}
