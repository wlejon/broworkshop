// Node Forge — generalized AR-trace probe widget (code raster + confidence +
// waveform, frame-aligned, with a shared hover-crosshair cross-highlight).
//
// Generalizes qwen-tts-lab/lib/render.js's persistent-card pattern: each
// named card owns ONE canvas, reused (resized + redrawn in place) across
// renders rather than rebuilt, plus a transparent overlay canvas for the
// hover highlight so the base raster is never re-rasterized on mousemove.
// All frame-aligned cards (codes / confidence / waveform) share one drawn
// width (TRACE_W) and one frame axis, so hovering any of them highlights the
// same instant on all three — a code lines up with the slice of audio it
// produced.
//
// createTraceView(host) mounts nothing itself; a node's own trace section
// calls beginFrame() once per fresh trace, then the render* methods per
// stage, then clear(keepNames) to drop stale cards from a prior trace shape.
//   view.beginFrame()                    reset the shared cursor + frame count
//   view.renderCodes(name, title, desc, stage, opts)
//     stage = {h, w, data} row-major h x F code grid (e.g. 16 x F RVQ codes).
//     opts.onPick(frame, row, code) — fired on a click (e.g. stage a logit
//       bias); omit for a read-only raster.
//   view.renderConf(name, title, desc, stage)      stage = {w, data} 1 x F
//   view.renderWave(name, title, desc, samples, sampleRate, frameAligned)
//     frameAligned = false for a plain (non-cross-highlighted) waveform,
//     e.g. a live streaming meter — call beginFrame() first there too, so
//     no stale frame-aligned overlay from a previous trace lingers.
//   view.clear(exceptNames)   drop any card not in exceptNames

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // A sequential colormap (dark -> blue -> green -> amber -> white-ish) for code ids.
  function seqColor(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const stops = [[12, 16, 28], [38, 70, 160], [40, 165, 145], [225, 175, 60], [250, 240, 210]];
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, x | 0), f = x - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  // Confidence color: red (unsure) -> amber -> green (sure).
  function confColor(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const r = t < 0.5 ? 230 : 230 - (t - 0.5) * 2 * 150;
    const g = t < 0.5 ? 90 + t * 2 * 130 : 220;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',90)';
  }

  const TRACE_W = 1100;

  export function createTraceView(host) {
    let cards = {};
    let overlayDrawers = [];
    let traceFrames = 0;
    let readoutEl = null;
    const READOUT_IDLE = 'hover a trace card to line up frames with audio';

    function ensureReadout() {
      if (readoutEl && readoutEl.parentNode) return;
      readoutEl = el('div', 'trace-readout', READOUT_IDLE);
      host.insertBefore(readoutEl, host.firstChild);
    }
    function setCursor(frame, info) {
      for (const d of overlayDrawers) d(frame);
      if (readoutEl) readoutEl.textContent = frame < 0 ? READOUT_IDLE : ('frame ' + frame + (info || ''));
    }
    function canvasXY(ev, canvas) {
      const r = canvas.getBoundingClientRect();
      return [(ev.clientX - r.left) * (canvas.width / (r.width || canvas.width)),
              (ev.clientY - r.top) * (canvas.height / (r.height || canvas.height))];
    }
    function card(name, title, desc) {
      let c = cards[name];
      if (!c) {
        const wrap = el('div', 'trace-card');
        const head = el('div', 'trace-head');
        head.appendChild(el('span', 'trace-name', title));
        if (desc) head.appendChild(el('span', null, desc));
        wrap.appendChild(head);
        const cwrap = el('div', 'trace-canvas-wrap');
        const canvas = document.createElement('canvas'); canvas.className = 'curve-canvas';
        cwrap.appendChild(canvas);
        wrap.appendChild(cwrap);
        const note = el('div', 'axis-note', '');
        wrap.appendChild(note);
        host.appendChild(wrap);
        c = cards[name] = { wrap, cwrap, canvas, ctx: canvas.getContext('2d'), note };
      }
      return c;
    }
    function cardCanvas(c, W, H) {
      if (c.canvas.width !== W) c.canvas.width = W;
      if (c.canvas.height !== H) c.canvas.height = H;
      c.ctx.clearRect(0, 0, W, H);
      return c.ctx;
    }
    function cardOverlay(c, W, H) {
      if (!c.overlay) {
        const o = document.createElement('canvas');
        o.className = 'overlay';
        c.cwrap.appendChild(o);
        c.overlay = o; c.octx = o.getContext('2d');
      }
      if (c.overlay.width !== W) c.overlay.width = W;
      if (c.overlay.height !== H) c.overlay.height = H;
      c.octx.clearRect(0, 0, W, H);
      return c.octx;
    }

    function beginFrame() { overlayDrawers = []; traceFrames = 0; setCursor(-1); }
    function clear(except) {
      for (const k of Object.keys(cards)) {
        if (except && except.indexOf(k) >= 0) continue;
        cards[k].wrap.remove(); delete cards[k];
      }
    }

    function renderCodes(name, title, desc, stage, opts) {
      opts = opts || {};
      ensureReadout();
      const c = card(name, title, desc);
      const W = TRACE_W, rowH = 15, H = stage.h * rowH;
      const ctx = cardCanvas(c, W, H);
      const lo = new Float32Array(stage.h), hi = new Float32Array(stage.h);
      for (let r = 0; r < stage.h; r++) {
        let mn = Infinity, mx = -Infinity; const base = r * stage.w;
        for (let x = 0; x < stage.w; x++) { const v = stage.data[base + x]; if (v < mn) mn = v; if (v > mx) mx = v; }
        lo[r] = mn; hi[r] = mx;
      }
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const r = Math.min(stage.h - 1, (y / rowH) | 0), base = r * stage.w, span = (hi[r] - lo[r]) || 1;
        for (let x = 0; x < W; x++) {
          const sx = Math.min(stage.w - 1, (x * stage.w / W) | 0);
          const col = seqColor((stage.data[base + sx] - lo[r]) / span);
          const o = (y * W + x) * 4;
          img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let r = 1; r < stage.h; r++) ctx.fillRect(0, r * rowH, W, 1);
      c.note.textContent = stage.h + ' rows x ' + stage.w + ' frames · hover to line up with audio' +
        (opts.onPick ? ' · click row 0 to steer' : '');

      traceFrames = stage.w;
      const octx = cardOverlay(c, W, H);
      let hoverRow = 0;
      overlayDrawers.push((f) => {
        octx.clearRect(0, 0, W, H);
        if (f < 0 || f >= stage.w) return;
        const x = f * W / stage.w, bw = Math.max(2, W / stage.w);
        octx.fillStyle = 'rgba(255,255,255,0.10)'; octx.fillRect(x, 0, bw, H);
        octx.strokeStyle = 'rgba(143,208,255,0.85)'; octx.strokeRect(x + 0.5, 0.5, bw - 1, H - 1);
        octx.lineWidth = 2; octx.strokeStyle = '#ffd86a';
        octx.strokeRect(x + 1, hoverRow * rowH + 1, bw - 2, rowH - 2); octx.lineWidth = 1;
      });
      c.canvas.style.cursor = opts.onPick ? 'crosshair' : 'default';
      c.canvas.onmousemove = (ev) => {
        const [cx, cy] = canvasXY(ev, c.canvas);
        const f = Math.min(stage.w - 1, Math.max(0, (cx * stage.w / W) | 0));
        hoverRow = Math.min(stage.h - 1, Math.max(0, (cy / rowH) | 0));
        const code = Math.round(stage.data[hoverRow * stage.w + f]);
        setCursor(f, ' · row ' + hoverRow + ' = ' + code);
      };
      c.canvas.onmouseout = () => setCursor(-1);
      c.canvas.onclick = opts.onPick ? (ev) => {
        const [cx, cy] = canvasXY(ev, c.canvas);
        const f = Math.min(stage.w - 1, Math.max(0, (cx * stage.w / W) | 0));
        const row = Math.min(stage.h - 1, Math.max(0, (cy / rowH) | 0));
        opts.onPick(f, row, Math.round(stage.data[row * stage.w + f]));
      } : null;
    }

    function renderConf(name, title, desc, stage) {
      ensureReadout();
      const c = card(name, title, desc);
      const W = TRACE_W, H = 90;
      const ctx = cardCanvas(c, W, H);
      ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
      const n = stage.w, bw = W / n;
      let mn = 1, mx = 0, sum = 0;
      for (let i = 0; i < n; i++) { const v = stage.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
      for (let i = 0; i < n; i++) {
        const v = stage.data[i], h = Math.max(1, v * (H - 2));
        ctx.fillStyle = confColor(v);
        ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h);
      }
      c.note.textContent = 'min ' + mn.toFixed(2) + ' · mean ' + (sum / n).toFixed(2) + ' · max ' + mx.toFixed(2) +
        ' — dips are where the model hedged';

      const octx = cardOverlay(c, W, H);
      overlayDrawers.push((f) => {
        octx.clearRect(0, 0, W, H);
        if (f < 0 || f >= n) return;
        const x = f * W / n, bw2 = Math.max(2, W / n);
        octx.fillStyle = 'rgba(255,255,255,0.10)'; octx.fillRect(x, 0, bw2, H);
        octx.strokeStyle = 'rgba(143,208,255,0.85)'; octx.strokeRect(x + 0.5, 0.5, bw2 - 1, H - 1);
      });
      c.canvas.onmousemove = (ev) => {
        const [cx] = canvasXY(ev, c.canvas);
        const f = Math.min(n - 1, Math.max(0, (cx * n / W) | 0));
        setCursor(f, ' · confidence ' + stage.data[f].toFixed(2));
      };
      c.canvas.onmouseout = () => setCursor(-1);
    }

    function renderWave(name, title, desc, samples, sampleRate, frameAligned) {
      ensureReadout();
      const c = card(name, title, desc);
      const W = TRACE_W, H = 120, mid = H / 2;
      const ctx = cardCanvas(c, W, H);
      ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
      const n = samples.length, per = Math.max(1, Math.floor(n / W));
      let peak = 1e-6; for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
      ctx.strokeStyle = '#5aa0e0';
      for (let x = 0; x < W; x++) {
        let lo = 0, hi = 0; const s0 = x * per, s1 = Math.min(n, s0 + per);
        for (let i = s0; i < s1; i++) { if (samples[i] < lo) lo = samples[i]; if (samples[i] > hi) hi = samples[i]; }
        ctx.beginPath();
        ctx.moveTo(x, mid - (hi / peak) * mid); ctx.lineTo(x, mid - (lo / peak) * mid + 0.5); ctx.stroke();
      }
      c.note.textContent = (n / (sampleRate || 24000)).toFixed(2) + 's · ' + (sampleRate || 0) + 'Hz';

      if (!frameAligned || !traceFrames) { c.canvas.onmousemove = null; c.canvas.style.cursor = 'default'; return; }
      const F = traceFrames;
      const x0 = (f) => Math.floor(f * n / F) * W / n;
      const octx = cardOverlay(c, W, H);
      overlayDrawers.push((f) => {
        octx.clearRect(0, 0, W, H);
        if (f < 0 || f >= F) return;
        const a = x0(f), b = x0(f + 1), w = Math.max(2, b - a);
        octx.fillStyle = 'rgba(143,208,255,0.16)'; octx.fillRect(a, 0, w, H);
        octx.strokeStyle = 'rgba(143,208,255,0.8)'; octx.strokeRect(a + 0.5, 0.5, w - 1, H - 1);
      });
      c.canvas.style.cursor = 'crosshair';
      c.canvas.onmousemove = (ev) => {
        const [cx] = canvasXY(ev, c.canvas);
        const f = Math.min(F - 1, Math.max(0, ((cx / W) * F) | 0));
        setCursor(f);
      };
      c.canvas.onmouseout = () => setCursor(-1);
    }

    return { beginFrame, renderCodes, renderConf, renderWave, clear, resetCursor: () => setCursor(-1) };
  }
