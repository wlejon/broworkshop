// Identity Breeding tab: the identity IS the initial latent. Research showed
// each seed carries a character, so instead of searching random seeds and
// hoping one matches (the old accept-a-candidate flow — at one set of
// conditions every seed is simply a DIFFERENT character, so there was
// nothing to pick), the character is made a first-class crafted object: a
// noise field, seeded from the reference seed's real pipeline noise and
// REFINED by evolution until it is resilient to condition shifts.
//
// The loop (CEM in noise space, buffers live worker-side):
//   - Each generation samples children: small Gaussian drifts of the current
//     identity noise (cos to parent = sqrt(1-drift^2)).
//   - Every child renders at every PROBE — captured condition sets (shift the
//     scene, click "+ probe"). Resilience is the objective, not a hope: a
//     child only scores well if its character survives ALL the probes.
//   - Scores are cosine against the exemplar model (BiRefNet cuts the figure
//     out on neutral gray, cropped to the matte bbox, DINOv3 ViT-H embeds the
//     cutout — frames with no discernible figure fall back to full-frame).
//     Children within a generation render under identical conditions, so
//     absolute cosine ranks them fairly (the scene term is common to all) —
//     the failure mode that killed absolute scoring across random seeds
//     doesn't exist here.
//   - The identity itself rides along as the "keeper" row each generation —
//     the baseline a child must beat — and the identity then becomes the
//     renormed mean of the top scorers (keeper included when it ranks).
//   - Drift decays each generation: explore, then settle.
//
// Once bred, "use identity" makes every Generate start from the identity
// latent (opts.identNoise -> worker resolves to initNoise) — walk the axes
// freely, the character carries. Noise is drawn per-latent-size, so an
// identity is bound to the size it was bred at; render at that size or
// re-breed. Save/load round-trips the buffer through a JSON file.

import { $, f32ToB64, b64ToF32 } from '/app/ui/util.js';

const DINO_PATH =
  'D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors';
const BIREFNET_PATH =
  'D:/projects/brovisionml/weights/triposplat/background_removal/birefnet.safetensors';
// Matting resolution: identity scoring needs the figure region, not
// reference-grade edges — 512 is ~4x faster than BiRefNet's default 1024.
const REMBG_SIZE = 512;
const STRIP_THUMB = 128;
const EX_THUMB = 88;

export function initIdentitySearch(ctx) {
  const prefs = ctx.prefs;
  const scorer = { dino: null, rembg: null, ready: false, loading: false };
  let exemplars = [];      // {id, canvas, w, h, emb} — what "who this is" means
  let exSeq = 0;
  let centroid = null;     // unit mean of exemplar embeddings
  let probes = [];         // {id, label, msg} — captured condition sets
  let probeSeq = 0;
  let identity = null;     // {w, h, seed, gens} — the buffer lives in the worker
  let breeding = false, stopRequested = false;

  ['idsPop', 'idsGens', 'idsDrift'].forEach((k, i) => {
    const id = ['ids-pop', 'ids-gens', 'ids-drift'][i];
    if (prefs[k] != null) $(id).value = prefs[k];
  });

  function status(msg, kind) {
    const el = $('ids-status');
    el.textContent = msg;
    el.className = kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '';
  }

  // ── scorer (lazy: ~2.6 GB of VRAM only once breeding is used) ─────────────
  function ensureScorer(onReady) {
    if (scorer.ready) { onReady(); return; }
    if (scorer.loading) return;
    scorer.loading = true;
    ctx.setBusy(true);
    status('loading identity scorer — DINOv3 + BiRefNet…');
    const fail = (m) => {
      scorer.loading = false;
      ctx.setBusy(false);
      status('scorer load failed: ' + m, 'err');
    };
    try {
      bro.vision.loadDinov3(DINO_PATH, {
        device: 'cuda',
        onReady: (d3) => {
          scorer.dino = d3;
          try {
            bro.vision.loadBirefnet(BIREFNET_PATH, {
              device: 'cuda', modelSize: REMBG_SIZE,
              onReady: (bg) => {
                scorer.rembg = bg;
                scorer.ready = true;
                scorer.loading = false;
                ctx.setBusy(false);
                status('identity scorer ready', 'ok');
                onReady();
              },
              onError: fail,
            });
          } catch (e) { fail(e.message || e); }
        },
        onError: fail,
      });
    } catch (e) { fail(e.message || e); }
  }

  // Breeding runs the 18 GB pipeline and the ~3 GB scorer back-to-back on
  // the same card — measured peak 23.7/24 GB at 1024², which fits headless
  // but OOMs windowed once the desktop takes its share. Two disciplines keep
  // the peak down: trim the allocator between the render and embed phases
  // (each re-allocates its own scratch instead of both staying cached), and
  // free the scorer's weights entirely when a breed finishes (it lazy-loads
  // again in a few seconds on the next use).
  function gpuTrim() {
    try { bro.gpu.trim('cuda'); } catch (e) { /* CPU build / no trimmer */ }
  }
  function releaseScorer() {
    if (!scorer.ready) return;
    try { if (scorer.dino && scorer.dino.dispose) scorer.dino.dispose(); } catch (e) {}
    try { if (scorer.rembg && scorer.rembg.dispose) scorer.rembg.dispose(); } catch (e) {}
    scorer.dino = null;
    scorer.rembg = null;
    scorer.ready = false;
    gpuTrim();
  }

  function unit(v) {
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1e-9;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
  }
  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // Figure-targeted embedding: matte the frame, composite the cutout on
  // neutral gray, crop to the figure's bbox (with a small margin) so most of
  // DINO's 224² input is the character, then take the unit CLS embedding.
  function embedIdentity(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const frame = srcCanvas.getContext('2d').getImageData(0, 0, w, h);
    let region = null;
    try {
      const cut = scorer.rembg.removeBackground(frame);
      const a = cut.alpha, W = cut.width, H = cut.height;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y += 2) {
        const row = y * W;
        for (let x = 0; x < W; x += 2) {
          if (a[row + x] > 0.5) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      // Require a plausible figure (>0.5% of the frame) before trusting the
      // matte; tiny specks would crop to noise.
      if (x1 >= x0 && (x1 - x0) * (y1 - y0) > 0.005 * W * H) {
        const pad = Math.round(0.05 * Math.max(x1 - x0, y1 - y0));
        const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad);
        const bw = Math.min(W, x1 + pad) - bx, bh = Math.min(H, y1 + pad) - by;
        const c = document.createElement('canvas');
        c.width = bw; c.height = bh;
        const cc = c.getContext('2d');
        cc.fillStyle = '#808080';
        cc.fillRect(0, 0, bw, bh);
        cc.drawImage(cut.image, bx, by, bw, bh, 0, 0, bw, bh);
        region = cc.getImageData(0, 0, bw, bh);
      }
    } catch (e) {
      // fall through to the full frame
    }
    const r = scorer.dino.encode(region || frame);
    return unit(r.features.subarray(0, r.dim));   // row 0 = CLS
  }

  // ── the exemplar model (what the scorer matches against) ──────────────────
  function recomputeCentroid() {
    centroid = null;
    if (!exemplars.length) return;
    const dim = exemplars[0].emb.length;
    const m = new Float32Array(dim);
    exemplars.forEach((e) => { for (let i = 0; i < dim; i++) m[i] += e.emb[i]; });
    centroid = unit(m);
  }

  function addExemplar(canvas, w, h, emb) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0);
    exemplars.push({ id: ++exSeq, canvas: c, w: w, h: h, emb: emb });
    recomputeCentroid();
    renderExemplars();
    ctx.refreshButtons();
  }

  function removeExemplar(id) {
    exemplars = exemplars.filter((e) => e.id !== id);
    recomputeCentroid();
    renderExemplars();
    ctx.refreshButtons();
  }

  function renderExemplars() {
    const host = $('ids-exemplars');
    host.innerHTML = '';
    if (!exemplars.length) {
      const e = document.createElement('div');
      e.className = 'ids-empty';
      e.textContent = 'No exemplars — render the character, then add it. More exemplars (any scene) sharpen the target.';
      host.appendChild(e);
      return;
    }
    exemplars.forEach((ex) => {
      const cell = document.createElement('div');
      cell.className = 'ids-ex';
      const cv = document.createElement('canvas');
      const s = Math.min(EX_THUMB / ex.w, EX_THUMB / ex.h, 1);
      cv.width = Math.max(1, Math.round(ex.w * s));
      cv.height = Math.max(1, Math.round(ex.h * s));
      cv.getContext('2d').drawImage(ex.canvas, 0, 0, cv.width, cv.height);
      cv.title = 'exemplar — click to view';
      cv.onclick = () => ctx.drawBitmap(ex.canvas, ex.w, ex.h);
      const x = document.createElement('button');
      x.className = 'ids-ex-x'; x.textContent = '×';
      x.title = 'remove this exemplar';
      x.addEventListener('click', () => removeExemplar(ex.id));
      cell.appendChild(cv); cell.appendChild(x);
      host.appendChild(cell);
    });
  }

  // Embed any canvas into the model — the "+ exemplar" button (current view)
  // and the history cards' "exemplar" action (ctx.addIdentityExemplar) both
  // land here.
  function embedAndAddExemplar(canvas, w, h) {
    ensureScorer(() => {
      ctx.setBusy(true);
      status('embedding exemplar…');
      let emb;
      try { emb = embedIdentity(canvas); }
      catch (e) {
        ctx.setBusy(false);
        status('embed failed: ' + (e.message || e), 'err');
        return;
      }
      addExemplar(canvas, w, h, emb);
      ctx.setBusy(false);
      status('exemplar added (' + exemplars.length + ')', 'ok');
    });
  }

  function addFromCurrentRender() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) {
      status('render something first — the current render becomes the exemplar', 'err');
      return;
    }
    embedAndAddExemplar(view, view.width, view.height);
  }

  // ── probes (the condition sets resilience is scored against) ──────────────
  // The exact message Generate would send right now, minus any identity noise
  // (each breeding render sets its own child id).
  function captureMsg() {
    const msg = ctx.buildGenerateMsg('full');
    if (msg.opts) delete msg.opts.identNoise;
    return msg;
  }

  function probeLabel(msg) {
    const parts = [];
    const ac = msg.axisControls || {};
    Object.keys(ac).forEach((k) => {
      const v = Math.round(ac[k] * 10) / 10;
      parts.push(k.split('.').pop() + (v > 0 ? '+' : '') + v);
    });
    if (msg.expression && msg.expression.adj) parts.push('“' + msg.expression.adj + '”');
    ['spectrum', 'mouth'].forEach((bank) => {
      const b = msg[bank] || {};
      Object.keys(b).forEach((k) => {
        const v = Math.round(b[k] * 10) / 10;
        if (v) parts.push(k + (v > 0 ? '+' : '') + v);
      });
    });
    return parts.length ? parts.join(' · ') : 'neutral';
  }

  // Thumbnail of what the canvas shows right now — the chip label alone
  // ("drama+1.5") doesn't say what the look IS.
  function viewThumb() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) return null;
    const thumb = document.createElement('canvas');
    const s = 40 / view.height;
    thumb.width = Math.max(1, Math.round(view.width * s));
    thumb.height = 40;
    thumb.getContext('2d').drawImage(view, 0, 0, thumb.width, thumb.height);
    return thumb;
  }

  function addProbe() {
    if (!ctx.loaded) return;
    const msg = captureMsg();
    probes.push({ id: ++probeSeq, label: probeLabel(msg), msg: msg, thumb: viewThumb() });
    renderProbes();
    refreshPlan();
    ctx.refreshButtons();
    status('probe captured — breeding scores the identity at every probe', 'ok');
  }

  function removeProbe(id) {
    probes = probes.filter((p) => p.id !== id);
    renderProbes();
    refreshPlan();
    ctx.refreshButtons();
  }

  function renderProbes() {
    const host = $('ids-probes');
    host.innerHTML = '';
    if (!probes.length) {
      const e = document.createElement('div');
      e.className = 'ids-empty';
      e.textContent = 'No probes — Breed builds a default set (this look + closeup + dramatic). ' +
                      'To choose your own: shift the scene, then "+ probe" each look the identity must survive.';
      host.appendChild(e);
      return;
    }
    probes.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'ids-probe';
      if (p.thumb) chip.appendChild(p.thumb);
      const label = document.createElement('span');
      label.textContent = p.label;
      label.title = p.msg.prompt;
      const x = document.createElement('button');
      x.className = 'ids-ex-x'; x.textContent = '×';
      x.title = 'remove this probe';
      x.addEventListener('click', () => removeProbe(p.id));
      chip.appendChild(label); chip.appendChild(x);
      host.appendChild(chip);
    });
  }

  // Planned render count for the current knobs — breeding cost is the thing
  // to budget (VRAM headroom and minutes), so say it up front.
  function refreshPlan() {
    const P = Math.round(+$('ids-pop').value || 5);
    const G = Math.round(+$('ids-gens').value || 4);
    const n = Math.max(1, probes.length);
    $('ids-plan').textContent = '= ' + (G * (P + 1) * n + n) + ' renders';
  }

  // ── identity meta + final strip ────────────────────────────────────────────
  function renderIdentityMeta() {
    $('ids-ident-meta').textContent = identity
      ? 'seed ' + identity.seed + ' · ' + identity.w + '×' + identity.h +
        ' · ' + identity.gens + ' generation' + (identity.gens === 1 ? '' : 's') + ' bred'
      : 'none — breeding starts one from the current seed';
    ctx.refreshButtons();
    ctx.refreshDeck();   // the "bred identity" chip keys off identity + the toggle
  }

  // ── strips (one row = one noise candidate across all probes) ──────────────
  function makeStrip(host, label) {
    const row = document.createElement('div');
    row.className = 'ids-strip';
    const head = document.createElement('div');
    head.className = 'ids-strip-head';
    const name = document.createElement('span');
    name.textContent = label;
    const score = document.createElement('span');
    score.className = 'ids-strip-score';
    head.appendChild(name); head.appendChild(score);
    const cells = document.createElement('div');
    cells.className = 'ids-strip-cells';
    row.appendChild(head); row.appendChild(cells);
    host.appendChild(row);
    return {
      row: row,
      addCell(canvas, w, h, title) {
        const cv = document.createElement('canvas');
        const s = Math.min(STRIP_THUMB / w, STRIP_THUMB / h, 1);
        cv.width = Math.max(1, Math.round(w * s));
        cv.height = Math.max(1, Math.round(h * s));
        cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
        cv.title = title + ' · click to view';
        cv.onclick = () => {
          ctx.drawBitmap(canvas, w, h);
          ctx.status(title, 'ok');
        };
        cells.appendChild(cv);
      },
      setScore(v) { score.textContent = v.toFixed(3); },
      markElite() { row.classList.add('elite'); },
    };
  }

  // ── the breeding loop ──────────────────────────────────────────────────────
  function breedFail(err) {
    breeding = false;
    ctx.setBusy(false);
    ctx.refreshButtons();
    status('breed failed: ' + (err.message || err), 'err');
  }

  // Render row.id ('current' or a child id) at every probe, embedding and
  // scoring each render as it lands. Calls onDone(meanScore | null-on-stop).
  function scoreRow(strip, rowId, probeSet, onDone) {
    let pi = 0, sum = 0;
    (function nextProbe() {
      if (stopRequested) { onDone(null); return; }
      if (pi >= probeSet.length) { onDone(sum / probeSet.length); return; }
      const p = probeSet[pi];
      const msg = Object.assign({}, p.msg, {
        opts: Object.assign({}, p.msg.opts, { identNoise: rowId }),
      });
      ctx.client.send(msg, (err, resp) => {
        if (err) { onDone(null, err); return; }
        const c = document.createElement('canvas');
        c.width = resp.width; c.height = resp.height;
        c.getContext('2d').drawImage(resp.bitmap, 0, 0);
        let s;
        try { s = dot(embedIdentity(c), centroid); }
        catch (e) { onDone(null, e); return; }
        gpuTrim();   // return the embed scratch before the next render allocates
        strip.addCell(c, resp.width, resp.height, p.label + ' · identity ' + s.toFixed(3));
        sum += s;
        pi++;
        nextProbe();
      });
    })();
  }

  function doBreed() {
    if (breeding || !ctx.loaded || ctx.busy) return;
    ensureScorer(() => {
      const view = $('view');
      if (!exemplars.length) {
        // Seed the identity target from what's on the canvas — the common flow
        // is "this is my character, make them resilient".
        if (view.style.display === 'none' || !ctx.history.length) {
          status('no exemplar — render the character first', 'err');
          return;
        }
        ctx.setBusy(true);
        try { addExemplar(view, view.width, view.height, embedIdentity(view)); }
        catch (e) {
          ctx.setBusy(false);
          status('embed failed: ' + (e.message || e), 'err');
          return;
        }
        ctx.setBusy(false);
      }

      const P = Math.max(2, Math.min(12, Math.round(+$('ids-pop').value || 5)));
      const G = Math.max(1, Math.min(10, Math.round(+$('ids-gens').value || 4)));
      let eps = Math.max(0.05, Math.min(0.9, +$('ids-drift').value || 0.3));
      $('ids-pop').value = String(P);
      $('ids-gens').value = String(G);
      $('ids-drift').value = String(eps);
      ctx.persist();

      // No probes captured? Build the default set right here, as visible,
      // removable chips — the current look anchors the identity, and two
      // canonical hard shifts (a face-filling closeup, a full mood swing)
      // give the breed something real to survive. Knowing which axes to walk
      // shouldn't be an entry requirement.
      if (!probes.length) {
        const anchor = captureMsg();
        probes.push({ id: ++probeSeq, label: probeLabel(anchor) + ' · auto',
                      msg: anchor, thumb: viewThumb() });
        [{ key: 'composition.proximity', delta: 3.5 },
         { key: 'mood.drama', delta: 4 }].forEach((shift) => {
          const msg = captureMsg();
          msg.axisControls = Object.assign({}, msg.axisControls);
          msg.axisControls[shift.key] =
            (+msg.axisControls[shift.key] || 0) + shift.delta;
          probes.push({ id: ++probeSeq, label: probeLabel(msg) + ' · auto',
                        msg: msg, thumb: null });
        });
        renderProbes();
        refreshPlan();
      }
      const probeSet = probes.slice();
      const w = +probeSet[0].msg.opts.width, h = +probeSet[0].msg.opts.height;
      for (const p of probeSet) {
        if (+p.msg.opts.width !== w || +p.msg.opts.height !== h) {
          status('probes disagree on size (' + w + '×' + h + ' vs ' +
                 p.msg.opts.width + '×' + p.msg.opts.height +
                 ') — noise is per-size, recapture them at one size', 'err');
          return;
        }
      }
      if (identity && (identity.w !== w || identity.h !== h)) {
        status('identity is bred at ' + identity.w + '×' + identity.h +
               ' — breed at that size, or clear the identity to restart here', 'err');
        return;
      }

      breeding = true;
      stopRequested = false;
      ctx.setBusy(true);
      ctx.refreshButtons();
      $('ids-grid').innerHTML = '';
      $('ids-identity').innerHTML = '';
      const t0 = Date.now();
      const total = G * (P + 1) * probeSet.length + probeSet.length;
      let rendered = 0;
      const tick = (what) => {
        const elapsed = (Date.now() - t0) / 1000;
        const eta = rendered > 0 ? Math.round((total - rendered) * (elapsed / rendered)) : 0;
        status('breeding · ' + what + ' · render ' + (rendered + 1) + '/' + total +
               (eta ? ' · ~' + (eta > 90 ? Math.round(eta / 60) + ' min' : eta + ' s') +
                      ' left' : ''));
      };

      const start = (next) => {
        if (identity) { next(); return; }
        const seed = +$('seed').value || 0;
        status('drawing identity noise from seed ' + seed + '…');
        ctx.client.send({ type: 'identNoiseInit', prompt: probeSet[0].msg.prompt,
                          opts: probeSet[0].msg.opts, seed: seed }, (err, resp) => {
          if (err) { breedFail(err); return; }
          identity = { w: resp.w, h: resp.h, seed: resp.seed, gens: 0 };
          renderIdentityMeta();
          next();
        });
      };

      const finish = (aborted) => {
        // Pin the bred identity as its own strip — what "the character" now
        // renders as at every probe. Clear the stop flag so the strip itself
        // isn't skipped by the very stop that got us here.
        stopRequested = false;
        const strip = makeStrip($('ids-identity'), 'identity');
        scoreRow(strip, 'current', probeSet, (score, err) => {
          breeding = false;
          // The scorer's ~3 GB goes back to the card until the next breed —
          // interactive rendering with "use identity" shouldn't pay for it.
          releaseScorer();
          ctx.setBusy(false);
          ctx.refreshButtons();
          $('ids-timing').textContent = Math.round((Date.now() - t0) / 1000) + ' s';
          if (err) { status('breed finished but the identity strip failed: ' + (err.message || err), 'err'); return; }
          if (score != null) strip.setScore(score);
          // Breeding's whole point is to render with the result — arm it.
          $('ids-use').checked = true;
          ctx.persist();
          status('breed ' + (aborted ? 'stopped' : 'done') + ' · identity scores ' +
                 (score != null ? score.toFixed(3) : '—') + ' across ' +
                 probeSet.length + ' probe' + (probeSet.length === 1 ? '' : 's') +
                 ' · "use identity" is ON — walk the axes, the character carries', 'ok');
          if (ctx.live && ctx.loaded) ctx.schedule('full');
          ctx.pump();
        });
      };

      const generation = (g) => {
        if (stopRequested || g > G) { finish(stopRequested); return; }
        const genHost = document.createElement('div');
        genHost.className = 'ids-gen';
        const head = document.createElement('div');
        head.className = 'imgaxis-gallery-head';
        head.textContent = 'generation ' + g + ' / ' + G + ' · drift ' + eps.toFixed(2);
        genHost.appendChild(head);
        $('ids-grid').insertBefore(genHost, $('ids-grid').firstChild);

        // Sample P children, then score keeper + children sequentially.
        const rows = [{ id: 'current', label: 'keeper' }];
        let made = 0;
        const sample = () => {
          if (made >= P) { score(0); return; }
          ctx.client.send({ type: 'identNoiseChild', eps: eps, rngSeed: ctx.randomSeed() },
                          (err, resp) => {
            if (err) { breedFail(err); return; }
            rows.push({ id: resp.id, label: 'child ' + (made + 1) });
            made++;
            sample();
          });
        };
        const score = (ri) => {
          if (stopRequested) { finish(true); return; }
          if (ri >= rows.length) { adopt(); return; }
          const row = rows[ri];
          tick('generation ' + g + '/' + G + ' · ' + row.label);
          const strip = makeStrip(genHost, row.label);
          row.strip = strip;
          scoreRow(strip, row.id, probeSet, (meanScore, err) => {
            rendered += probeSet.length;
            if (err) { breedFail(err); return; }
            if (meanScore == null) { finish(true); return; }
            row.score = meanScore;
            strip.setScore(meanScore);
            score(ri + 1);
          });
        };
        const adopt = () => {
          rows.sort((a, b) => b.score - a.score);
          const elite = rows.slice(0, Math.max(2, Math.round(rows.length / 3)));
          elite.forEach((r) => r.strip.markElite());
          ctx.client.send({ type: 'identNoiseAdopt', ids: elite.map((r) => r.id) },
                          (err) => {
            if (err) { breedFail(err); return; }
            identity.gens++;
            renderIdentityMeta();
            head.textContent += ' · best ' + rows[0].score.toFixed(3) +
                                (rows[0].id === 'current' ? ' (keeper held)' : '');
            eps *= 0.85;
            generation(g + 1);
          });
        };
        sample();
      };

      start(() => generation(1));
    });
  }

  // ── save / load (the bred latent as a JSON file) ───────────────────────────
  function saveIdentity() {
    if (!identity || ctx.busy) return;
    if (typeof window.showSaveFileDialog !== 'function') {
      status('save dialog unavailable in this build', 'err'); return;
    }
    const name = 'identity_' + identity.seed + '_' + identity.w + 'x' + identity.h + '.json';
    const path = window.showSaveFileDialog('Krea 2 identity|json', name);
    if (!path) return;
    ctx.client.send({ type: 'identNoiseExport' }, (err, resp) => {
      if (err) { status('export failed: ' + err.message, 'err'); return; }
      try {
        require('fs').writeFileSync(path, JSON.stringify({
          kind: 'krea2-identity-noise', w: resp.w, h: resp.h, seed: resp.seed,
          gens: identity.gens, data: f32ToB64(resp.data),
        }));
        status('identity saved → ' + path, 'ok');
      } catch (e) { status('save failed: ' + (e.message || e), 'err'); }
    });
  }

  function loadIdentity() {
    if (ctx.busy) return;
    if (typeof window.showOpenFileDialog !== 'function') {
      status('file dialog unavailable in this build', 'err'); return;
    }
    const files = window.showOpenFileDialog('Krea 2 identity|json');
    if (!files || !files.length) return;
    let obj;
    try { obj = JSON.parse(require('fs').readFileSync(files[0], 'utf8')); }
    catch (e) { status('load failed: ' + (e.message || e), 'err'); return; }
    if (!obj || obj.kind !== 'krea2-identity-noise' || !obj.data) {
      status('not an identity file: ' + files[0], 'err'); return;
    }
    ctx.client.send({ type: 'identNoiseImport', data: b64ToF32(obj.data),
                      w: obj.w, h: obj.h, seed: obj.seed }, (err, resp) => {
      if (err) { status('import failed: ' + err.message, 'err'); return; }
      identity = { w: resp.w, h: resp.h, seed: resp.seed, gens: obj.gens || 0 };
      renderIdentityMeta();
      status('identity loaded (' + identity.w + '×' + identity.h + ') — turn on "use identity"', 'ok');
    });
  }

  function clearAll() {
    exemplars = [];
    probes = [];
    recomputeCentroid();
    renderExemplars();
    renderProbes();
    $('ids-grid').innerHTML = '';
    $('ids-identity').innerHTML = '';
    if (identity) {
      ctx.client.send({ type: 'identNoiseClear' }, () => {});
      identity = null;
    }
    $('ids-use').checked = false;
    renderIdentityMeta();
    ctx.refreshButtons();
    status('identity, exemplars, and probes cleared');
  }

  // ── wire up ───────────────────────────────────────────────────────────────
  $('btn-ids-add').addEventListener('click', addFromCurrentRender);
  $('btn-ids-probe').addEventListener('click', addProbe);
  $('btn-ids-breed').addEventListener('click', doBreed);
  $('btn-ids-stop').addEventListener('click', () => { stopRequested = true; });
  $('btn-ids-save').addEventListener('click', saveIdentity);
  $('btn-ids-load').addEventListener('click', loadIdentity);
  $('btn-ids-clear').addEventListener('click', clearAll);
  $('ids-use').addEventListener('change', () => {
    ctx.persist();
    if (ctx.live && ctx.loaded) ctx.schedule('full');
  });
  ['ids-pop', 'ids-gens', 'ids-drift'].forEach((id) => {
    $(id).addEventListener('change', () => { refreshPlan(); ctx.persist(); });
  });

  // Every Generate starts from the bred latent while "use identity" is on —
  // the whole point: walk the axes, the character carries.
  ctx.onGenerateMsg((msg) => {
    if ($('ids-use').checked && identity) msg.opts.identNoise = 'current';
  });
  // History cards feed the model directly ("exemplar" action in render.js).
  ctx.addIdentityExemplar = (canvas, w, h) => {
    if (ctx.busy) return;
    ctx.switchTab('idsearch');
    embedAndAddExemplar(canvas, w, h);
  };
  // The toggle joins the Active Controls deck like any other shaping control
  // — "what is forming this image" must include the bred latent.
  ctx.registerDeckEntry({
    section: 'idsearch',
    active: () => $('ids-use').checked && !!identity,
    chip: () => 'bred identity',
    chipValue: () => identity ? 'seed ' + identity.seed : '',
    zero: (opts) => {
      $('ids-use').checked = false;
      ctx.persist();
      if ((!opts || !opts.silent) && ctx.live && ctx.loaded) ctx.schedule('full');
    },
    reveal: () => ctx.switchTab('idsearch'),
  });
  ctx.onPersist((p) => {
    p.idsPop = $('ids-pop').value;
    p.idsGens = $('ids-gens').value;
    p.idsDrift = $('ids-drift').value;
  });
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-ids-add').disabled = busyOrUnloaded;
    $('btn-ids-probe').disabled = busyOrUnloaded;
    $('btn-ids-breed').disabled = busyOrUnloaded;
    $('btn-ids-stop').disabled = !breeding;
    $('btn-ids-save').disabled = !identity || ctx.busy;
    $('btn-ids-load').disabled = ctx.busy;
    $('btn-ids-clear').disabled = breeding ||
      (!identity && !exemplars.length && !probes.length);
    $('ids-use').disabled = !identity;
  });

  renderExemplars();
  renderProbes();
  refreshPlan();
  renderIdentityMeta();
}
