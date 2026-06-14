// Attention — the cross-attention inspector.
//
// Two jobs: render the prompt as clickable token chips, and turn a captured
// trace into a heatmap grid. A trace is an array of cross-attention blocks,
// each { Lq, Lk, data } where data[q*Lk + k] is the head-averaged weight
// from spatial query q to context token k. Fixing k and walking q gives a
// spatial map of where that token's influence lands.
  // Recover a block's spatial dimensions from its query count, assuming the
  // latent aspect ratio is preserved at every U-Net scale.
  function blockDims(Lq, lw, lh) {
    var w = Math.round(Math.sqrt(Lq * lw / lh));
    if (w < 1) w = 1;
    var h = Math.round(Lq / w);
    if (w * h !== Lq) {
      w = Math.round(Math.sqrt(Lq));
      if (w < 1) w = 1;
      h = Math.round(Lq / w);
    }
    return { w: w, h: h };
  }

  // One block's contrastive column for context token k: the raw attention
  // weight data[q,k] minus, at each query q, the mean attention across the
  // prompt's content tokens (contentCols — the real words, not BOS/EOS/pad).
  //
  // That baseline is the token-agnostic signal: cross-attention concentrates
  // on whichever content token wherever the image has structural detail, so
  // every token's raw column lights up over detailed regions regardless of
  // meaning. Subtracting it leaves the token-specific part — where token k
  // drew attention beyond the field. Values come back raw (signed, un-scaled);
  // callers normalise once, after any cross-block aggregation, so a block's
  // weight in an average stays proportional to its real token-specific signal.
  //
  // contentCols null or shorter than 2 → no baseline (plain attention column).
  function blockColumn(block, k, contentCols) {
    var Lq = block.Lq, Lk = block.Lk, data = block.data;
    var col = new Float32Array(Lq);
    if (k < 0 || k >= Lk) return col;
    var M = contentCols ? contentCols.length : 0;
    for (var q = 0; q < Lq; q++) {
      var row = q * Lk, base = 0;
      if (M >= 2) {
        var s = 0;
        for (var m = 0; m < M; m++) {
          var c = contentCols[m];
          if (c >= 0 && c < Lk) s += data[row + c];
        }
        base = s / M;
      }
      col[q] = data[row + k] - base;
    }
    return col;
  }

  // Nearest-neighbour resample a w×h block column onto a gw×gh grid.
  function resample(col, w, h, gw, gh) {
    var out = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) {
      var by = Math.min(h - 1, (gy * h / gh) | 0);
      for (var gx = 0; gx < gw; gx++) {
        var bx = Math.min(w - 1, (gx * w / gw) | 0);
        out[gy * gw + gx] = col[by * w + bx];
      }
    }
    return out;
  }

  // Dropdown options for the layer selector.
  function blockOptions(trace, lw, lh) {
    var opts = [{ value: 'avg', label: 'All layers (avg)' }];
    if (!trace) return opts;
    for (var i = 0; i < trace.length; i++) {
      var d = blockDims(trace[i].Lq, lw, lh);
      opts.push({ value: i, label: 'L' + i + ' · ' + d.w + '×' + d.h });
    }
    return opts;
  }

  // Build a heatmap grid for context token `k`. blockSel is 'avg' or an
  // integer block index. contentCols is the prompt's content-token columns,
  // used by blockColumn for contrastive normalisation. Returns
  // { w, h, values:Float32Array } or null.
  //
  // 'avg' sums each block's *raw* contrastive column and normalises once at
  // the end — a magnitude-weighted mean, so a block contributes in proportion
  // to its actual token-specific signal rather than being stretched to full
  // range first (which would let near-flat blocks inject equal-weight noise).
  function computeHeatmap(trace, k, blockSel, lw, lh, contentCols) {
    if (!trace || !trace.length) return null;
    var gw = Math.max(1, lw), gh = Math.max(1, lh);

    if (blockSel !== 'avg') {
      var b = trace[blockSel | 0];
      if (!b) return null;
      var d = blockDims(b.Lq, lw, lh);
      var g = resample(blockColumn(b, k, contentCols), d.w, d.h, gw, gh);
      return { w: gw, h: gh, values: normalize(g) };
    }

    var acc = new Float32Array(gw * gh);
    for (var i = 0; i < trace.length; i++) {
      var blk = trace[i];
      var dd = blockDims(blk.Lq, lw, lh);
      var rs = resample(blockColumn(blk, k, contentCols), dd.w, dd.h, gw, gh);
      for (var j = 0; j < acc.length; j++) acc[j] += rs[j];
    }
    for (var n = 0; n < acc.length; n++) acc[n] /= trace.length;
    return { w: gw, h: gh, values: normalize(acc) };
  }

  // Min-max stretch to 0..1 in place. A flat array (no spread) carries no
  // spatial information — zero it so the overlay reads as empty rather than
  // amplifying float noise into a full-range pattern.
  function normalize(arr) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    var span = hi - lo;
    if (span > 1e-9) {
      for (var j = 0; j < arr.length; j++) arr[j] = (arr[j] - lo) / span;
    } else {
      arr.fill(0);
    }
    return arr;
  }

  // ── steering ────────────────────────────────────────────────────────
  //
  // Turn a token→bias map into the per-layer attnBias structure stepOnce()
  // expects. `shapes` is one { Lq, Lk } per cross-attention layer, learned
  // from a trace; each biased token gets its logit bias written into every
  // spatial query of every layer (column k of the (Lq, Lk) score matrix).
  function buildAttnBias(biasMap, shapes) {
    var keys = Object.keys(biasMap || {});
    return shapes.map(function (s) {
      var data = new Float32Array(s.Lq * s.Lk);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = +keys[ki], v = +biasMap[keys[ki]];
        if (!v || k < 0 || k >= s.Lk) continue;
        for (var q = 0; q < s.Lq; q++) data[q * s.Lk + k] = v;
      }
      return { Lq: s.Lq, Lk: s.Lk, data: data };
    });
  }

  // ── token-chip UI ──────────────────────────────────────────────────
  function create(tokensEl, hooks) {
    hooks = hooks || {};
    var chips = [];      // { el, contextIndex }
    var activeIdx = -1;

    function clear() {
      tokensEl.textContent = '';
      chips = [];
      activeIdx = -1;
    }

    function addChip(label, contextIndex, frame) {
      var el = document.createElement('span');
      el.className = 'tok' + (frame ? ' frame' : '');
      var txt = document.createElement('span');
      txt.textContent = label;
      el.appendChild(txt);
      el.addEventListener('click', function () {
        setActive(contextIndex);
        if (hooks.onSelect) hooks.onSelect(contextIndex, label);
      });
      tokensEl.appendChild(el);
      chips.push({ el: el, contextIndex: contextIndex, badge: null });
    }

    function chipFor(contextIndex) {
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].contextIndex === contextIndex) return chips[i];
      }
      return null;
    }

    // Reflect a token's steering bias on its chip — a +N / −N badge and a
    // boost/suppress tint. value 0 clears it.
    function setBias(contextIndex, value) {
      var c = chipFor(contextIndex);
      if (!c) return;
      c.el.classList.remove('boosted', 'suppressed');
      if (value) {
        if (!c.badge) {
          c.badge = document.createElement('span');
          c.badge.className = 'bias';
          c.el.appendChild(c.badge);
        }
        c.badge.textContent = (value > 0 ? '+' : '−') + Math.abs(value);
        c.el.classList.add(value > 0 ? 'boosted' : 'suppressed');
      } else if (c.badge) {
        c.el.removeChild(c.badge);
        c.badge = null;
      }
    }

    // enc — the result of Tokenizer.encodeContext()
    function setTokens(enc) {
      clear();
      addChip('[start]', enc.bosIndex, true);
      for (var i = 0; i < enc.tokens.length; i++) {
        var t = enc.tokens[i];
        addChip(t.text || '·', t.contextIndex, false);
      }
      addChip('[end]', enc.eosIndex, true);
    }

    function setActive(contextIndex) {
      activeIdx = contextIndex;
      for (var i = 0; i < chips.length; i++) {
        chips[i].el.classList.toggle('active',
          chips[i].contextIndex === contextIndex);
      }
    }

    return {
      setTokens: setTokens,
      setActive: setActive,
      setBias: setBias,
      clear: clear,
      activeIndex: function () { return activeIdx; },
      hasTokens: function () { return chips.length > 0; },
    };
  }

  export const Attention = {
    create: create,
    blockOptions: blockOptions,
    computeHeatmap: computeHeatmap,
    buildAttnBias: buildAttnBias,
    blockDims: blockDims,
  };
