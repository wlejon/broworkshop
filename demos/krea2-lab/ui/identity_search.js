// Identity Search tab: find where in seed space the character lives at the
// CURRENT conditions. The identity is a model built across seeds — a set of
// accepted exemplar renders whose embedding centroid defines "who this is";
// every scene you accept it in makes the centroid more scene-invariant.
//
// Scoring pipeline (humanoid-targeted): BiRefNet cuts the figure out of the
// frame (composited on neutral gray, cropped to the matte bbox, so the
// background can't contaminate the descriptor), DINOv3 ViT-H embeds the
// cutout, and a candidate's score is the cosine of its CLS embedding against
// the exemplar centroid. Frames with no discernible figure fall back to a
// full-frame embedding.
//
// Search: N random seeds rendered sequentially through the worker at the FULL
// current state (prompt, axis walk, banks, dials, transport — exactly what
// Generate would send), ranked live as scores land. Accepting a candidate
// adopts its seed (pinned), shows it on the render tab, files it in history,
// and adds it to the identity model. The workflow the panel is built for:
// render the character, add it as the first exemplar, shift the scene hard,
// search, accept the best match — repeat, and the identity model comes to
// span the walk.
//
// Candidates always render at the CURRENT size: Krea 2's seed noise is drawn
// per-latent-size, so a low-res probe of seed k is a DIFFERENT noise field
// than the full-res render — a cheap-screen-then-upscale flow would rank
// seeds that don't reproduce. Drop the steps field to 4 for faster searches
// instead; the initial noise (the identity carrier) is unchanged by that.

import { $ } from '/app/ui/util.js';

const DINO_PATH =
  'D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors';
const BIREFNET_PATH =
  'D:/projects/brovisionml/weights/triposplat/background_removal/birefnet.safetensors';
// Matting resolution: identity scoring needs the figure region, not
// reference-grade edges — 512 is ~4x faster than BiRefNet's default 1024.
const REMBG_SIZE = 512;

export function initIdentitySearch(ctx) {
  const prefs = ctx.prefs;
  const scorer = { dino: null, rembg: null, ready: false, loading: false };
  let exemplars = [];      // {id, canvas, w, h, emb (unit Float32Array)}
  let exSeq = 0;
  let centroid = null;     // unit Float32Array, or null with no exemplars
  let results = [];        // current search: {seed, canvas, w, h, emb, score, accepted}
  let searching = false, stopRequested = false;

  if (prefs.idsCount != null) $('ids-count').value = prefs.idsCount;

  function status(msg, kind) {
    const el = $('ids-status');
    el.textContent = msg;
    el.className = kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '';
  }

  // ── scorer (lazy: ~2.6 GB of VRAM only once identity search is used) ──────
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

  // ── the identity model (exemplars + centroid) ─────────────────────────────
  function recomputeCentroid() {
    if (!exemplars.length) { centroid = null; return; }
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

  const EX_THUMB = 88;
  function renderExemplars() {
    const host = $('ids-exemplars');
    host.innerHTML = '';
    if (!exemplars.length) {
      const e = document.createElement('div');
      e.className = 'ids-empty';
      e.textContent = 'No exemplars — render the character, then add it as the first exemplar.';
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
      x.title = 'remove this exemplar from the identity';
      x.addEventListener('click', () => removeExemplar(ex.id));
      cell.appendChild(cv); cell.appendChild(x);
      host.appendChild(cell);
    });
  }

  function addFromCurrentRender() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) {
      status('render something first — the current render becomes the exemplar', 'err');
      return;
    }
    ensureScorer(() => {
      ctx.setBusy(true);
      status('embedding exemplar…');
      let emb;
      try { emb = embedIdentity(view); }
      catch (e) {
        ctx.setBusy(false);
        status('embed failed: ' + (e.message || e), 'err');
        return;
      }
      addExemplar(view, view.width, view.height, emb);
      ctx.setBusy(false);
      status('exemplar added (' + exemplars.length + ') — shift the scene, then search', 'ok');
    });
  }

  // ── search ────────────────────────────────────────────────────────────────
  function renderGrid() {
    const grid = $('ids-grid');
    grid.innerHTML = '';
    if (!results.length) {
      const e = document.createElement('div');
      e.className = 'mint-gallery-empty';
      e.textContent = 'Search renders candidates here, ranked by identity score.';
      grid.appendChild(e);
      return;
    }
    const THUMB = 168;
    results.forEach((res) => {
      const cell = document.createElement('div');
      cell.className = 'mint-cell ids-cell' + (res.accepted ? ' accepted' : '');
      const cv = document.createElement('canvas');
      const s = Math.min(THUMB / res.w, THUMB / res.h, 1);
      cv.width = Math.max(1, Math.round(res.w * s));
      cv.height = Math.max(1, Math.round(res.h * s));
      cv.getContext('2d').drawImage(res.canvas, 0, 0, cv.width, cv.height);
      cv.title = 'seed ' + res.seed + ' · score ' + res.score.toFixed(3) + ' · click to view';
      cv.onclick = () => {
        ctx.drawBitmap(res.canvas, res.w, res.h);
        ctx.status('candidate · seed ' + res.seed + ' · identity ' + res.score.toFixed(3), 'ok');
      };
      const badge = document.createElement('div');
      badge.className = 'ids-score';
      badge.textContent = res.score.toFixed(3);
      const meta = document.createElement('div');
      meta.className = 'ids-cell-meta';
      const seedEl = document.createElement('span');
      seedEl.textContent = 'seed ' + res.seed;
      const acc = document.createElement('button');
      acc.textContent = res.accepted ? 'accepted ✓' : 'accept';
      acc.disabled = !!res.accepted;
      acc.title = 'adopt this seed and add the render to the identity model';
      acc.addEventListener('click', () => acceptResult(res));
      meta.appendChild(seedEl); meta.appendChild(acc);
      cell.appendChild(cv); cell.appendChild(badge); cell.appendChild(meta);
      grid.appendChild(cell);
    });
  }

  function acceptResult(res) {
    if (res.accepted) return;
    res.accepted = true;
    addExemplar(res.canvas, res.w, res.h, res.emb);
    $('seed').value = String(res.seed);
    $('rand-seed').checked = false;
    ctx.recordSeed(res.seed);
    ctx.addHistoryEntry(res.canvas, res.w, res.h, {
      seed: res.seed, steps: +$('steps').value || ctx.DEFAULTS.steps,
      width: res.w, height: res.h,
    });
    ctx.drawBitmap(res.canvas, res.w, res.h);
    ctx.persist();
    renderGrid();
    status('accepted seed ' + res.seed + ' → exemplar ' + exemplars.length +
           ' · the identity now spans this scene', 'ok');
  }

  function doSearch() {
    if (searching || !ctx.loaded || ctx.busy) return;
    ensureScorer(() => {
      if (!exemplars.length) {
        // Seed the identity from what's on the canvas — the common flow is
        // "this is my character, now find them elsewhere".
        const view = $('view');
        if (view.style.display === 'none' || !ctx.history.length) {
          status('no identity yet — render the character and add it as an exemplar', 'err');
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
      runSearch();
    });
  }

  function runSearch() {
    const n = Math.max(2, Math.min(64, Math.round(+$('ids-count').value || 12)));
    $('ids-count').value = String(n);
    ctx.persist();
    searching = true;
    stopRequested = false;
    ctx.setBusy(true);
    ctx.refreshButtons();
    results = [];
    renderGrid();
    const t0 = Date.now();
    // The exact message Generate would send — the search honors the full
    // current state (prompt, walk, banks, dials, transport), seed swapped
    // per candidate.
    const base = ctx.buildGenerateMsg('full');
    let done = 0;
    (function next() {
      if (stopRequested || done >= n) {
        searching = false;
        ctx.setBusy(false);
        ctx.refreshButtons();
        $('ids-timing').textContent = Math.round((Date.now() - t0) / 1000) + ' s';
        const best = results.length ? results[0].score.toFixed(3) : '—';
        status('search done · ' + results.length + ' candidates · best ' + best +
               (stopRequested ? ' · stopped' : ''), 'ok');
        ctx.pump();
        return;
      }
      const seed = ctx.randomSeed();
      status('search ' + (done + 1) + '/' + n + ' · seed ' + seed + '…');
      const msg = Object.assign({}, base, {
        opts: Object.assign({}, base.opts, { seed: seed }),
      });
      ctx.client.send(msg, (err, resp) => {
        if (err) {
          searching = false;
          ctx.setBusy(false);
          ctx.refreshButtons();
          status('search failed: ' + (err.message || err), 'err');
          return;
        }
        const c = document.createElement('canvas');
        c.width = resp.width; c.height = resp.height;
        c.getContext('2d').drawImage(resp.bitmap, 0, 0);
        let emb, score;
        try {
          emb = embedIdentity(c);
          score = dot(emb, centroid);
        } catch (e) {
          searching = false;
          ctx.setBusy(false);
          ctx.refreshButtons();
          status('scoring failed: ' + (e.message || e), 'err');
          return;
        }
        results.push({ seed: seed, canvas: c, w: resp.width, h: resp.height,
                       emb: emb, score: score, accepted: false });
        results.sort((a, b) => b.score - a.score);
        renderGrid();
        done++;
        next();
      });
    })();
  }

  function clearIdentityModel() {
    exemplars = [];
    recomputeCentroid();
    renderExemplars();
    ctx.refreshButtons();
    status('identity model cleared');
  }

  // ── wire up ───────────────────────────────────────────────────────────────
  $('btn-ids-add').addEventListener('click', addFromCurrentRender);
  $('btn-ids-search').addEventListener('click', doSearch);
  $('btn-ids-stop').addEventListener('click', () => { stopRequested = true; });
  $('btn-ids-clear').addEventListener('click', clearIdentityModel);
  $('ids-count').addEventListener('change', ctx.persist);

  ctx.onPersist((p) => { p.idsCount = $('ids-count').value; });
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-ids-add').disabled = busyOrUnloaded;
    $('btn-ids-search').disabled = busyOrUnloaded;
    $('btn-ids-stop').disabled = !searching;
    $('btn-ids-clear').disabled = searching || !exemplars.length;
  });

  renderExemplars();
  renderGrid();
}
