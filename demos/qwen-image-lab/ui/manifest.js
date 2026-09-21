// Save all — every image in the history, plus a manifest naming every control
// that made each one, and the reverse: load a manifest and put its rack back.
//
// The point is reproducibility of a SESSION, not of a file. A render here is
// the sum of nine surfaces — a prompt, a seed, 88 bank sliders plus whatever
// was minted, eight desk faders (global or prompt-conditioned), four gate
// multipliers and a band, a post-tanh delta, a painted mask, a rack of spatial
// regions, four modulation chunks, norm_out, the prefix-K/V dial, a prefix
// blend and a curve per armed lane — and a PNG carries none of it. The
// manifest carries all of it, keyed the way the controls are keyed, so
// restoring is setting each control by name rather than replaying a script.
//
// It also carries the message the worker was actually sent, verbatim, minus
// the megabyte-scale payloads (painted cells, condition-image pixels). That is
// the record of what the model was told, as distinct from what the UI thought
// it was asking for — and the two disagreeing is exactly the bug a manifest is
// worth having for.

import { $ } from '/app/ui/util.js';

const MANIFEST = 'manifest.json';

export function initManifest(ctx) {
  // Every registered control's current value, by key — the rack, flat.
  function snapshot() {
    const out = {};
    ctx.controls().forEach((c) => { if (c.key) out[c.key] = c.value(); });
    return out;
  }
  ctx.snapshotControls = snapshot;

  // A generate message with the bulk taken out. Cells and pixels are the only
  // things in it that are not small, and neither is human-readable.
  function slimMsg(msg) {
    if (!msg) return null;
    const out = {};
    for (const k in msg) {
      if (!msg.hasOwnProperty(k)) continue;
      if (k === 'gateMask' && msg.gateMask) {
        out.gateMask = { wp: msg.gateMask.wp, hp: msg.gateMask.hp, which: msg.gateMask.which,
                         at: msg.gateMask.at, lo: msg.gateMask.lo, hi: msg.gateMask.hi,
                         painted: msg.gateMask.cells.filter((v) => v !== 1).length };
      } else if (k === 'regions' && msg.regions) {
        out.regions = msg.regions.map((r) => ({
          name: r.name, wp: r.wp, hp: r.hp, which: r.which, at: r.at, lo: r.lo, hi: r.hi,
          feather: r.feather, axes: r.axes || null,
          painted: r.coverage ? r.coverage.filter((v) => v).length : 0,
        }));
      } else if (k === 'conditionImages' && msg.conditionImages) {
        out.conditionImages = msg.conditionImages.map((c) => (c.path ? c.path
          : '<' + c.width + '×' + c.height + ' pixels>'));
      } else {
        out[k] = msg[k];
      }
    }
    return out;
  }

  function buildManifest(history) {
    return {
      app: 'qwen-image-lab',
      version: 2,
      savedAt: new Date().toISOString(),
      modelDir: $('model-dir').value,
      minted: (ctx.mintedDefs ? ctx.mintedDefs() : []).map((m) => ({
        name: m.name, scale: m.scale, kind: m.kind, consistency: m.consistency,
      })),
      // oldest first, matching the file numbering
      renders: history.slice().reverse().map((h, i) => ({
        index: i + 1,
        file: fileNameFor(h, i, history.length),
        seed: h.seed, steps: h.steps, width: h.w, height: h.h,
        at: h.at ? new Date(h.at).toISOString() : null,
        prompt: h.msg ? h.msg.prompt : null,
        controls: h.controls || null,
        message: slimMsg(h.msg),
      })),
    };
  }

  function fileNameFor(h, k, total) {
    // Control-driven re-renders deliberately reuse the seed, so seed+size is
    // NOT unique across the history — index the names.
    const pad = String(total).length;
    const idx = String(k + 1);
    return 'qwen21_' + '0'.repeat(Math.max(0, pad - idx.length)) + idx +
           '_' + h.seed + '_' + h.w + 'x' + h.h + '.png';
  }

  function saveAll() {
    const history = ctx.history;
    if (!history.length) { ctx.status('nothing in the history', 'err'); return; }
    if (typeof window.showOpenFolderDialog !== 'function') {
      ctx.status('folder dialog unavailable in this build', 'err'); return;
    }
    const dir = window.showOpenFolderDialog('');
    if (!dir) return;
    writeAll(dir);
  }

  function writeAll(dir) {
    const history = ctx.history;
    const sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
    let n = 0, failed = 0, lastErr = '';
    for (let i = history.length - 1, k = 0; i >= 0; i--, k++) {
      const h = history[i];
      try {
        const px = h.canvas.getContext('2d').getImageData(0, 0, h.w, h.h);
        bro.image.encodePngFile(dir + sep + fileNameFor(h, k, history.length), px.data, h.w, h.h, 4);
        n++;
      } catch (e) { failed++; lastErr = e.message || String(e); }
    }
    let manifestPath = '';
    try {
      manifestPath = dir + sep + MANIFEST;
      require('fs').writeFileSync(manifestPath, JSON.stringify(buildManifest(history), null, 1));
    } catch (e) { failed++; lastErr = e.message || String(e); manifestPath = ''; }
    ctx.status('saved ' + n + ' image' + (n === 1 ? '' : 's') +
               (manifestPath ? ' + ' + MANIFEST : '') + ' to ' + dir +
               (failed ? ' · ' + failed + ' failed: ' + lastErr : ''),
               failed ? 'err' : (n ? 'ok' : 'err'));
    return { dir: dir, images: n, manifest: manifestPath, failed: failed };
  }

  // ── loading one back ────────────────────────────────────────────────────
  // A manifest holds many renders; the one restored is the last, because that
  // is where the session was when it was saved. Anything else is a click on a
  // history thumbnail, which the rail already does.
  function applyEntry(entry) {
    if (!entry) return { set: 0, missing: [] };
    const m = entry.message || {};
    if (entry.prompt != null) $('prompt').value = entry.prompt;
    if (entry.seed != null) { $('seed').value = String(entry.seed); $('rand-seed').checked = false; }
    if (entry.steps != null) $('steps').value = String(entry.steps);
    if (m.opts && m.opts.width) { $('width').value = String(m.opts.width); $('height').value = String(m.opts.height); }
    const byKey = {};
    ctx.controls().forEach((c) => { if (c.key) byKey[c.key] = c; });
    let set = 0;
    const missing = [];
    const ctls = entry.controls || {};
    for (const k in ctls) {
      if (!ctls.hasOwnProperty(k)) continue;
      const c = byKey[k];
      if (!c) { missing.push(k); continue; }
      if (c.value() !== +ctls[k]) c.set(+ctls[k], { silent: true });
      set++;
    }
    // The curves are not controls — they are the shape a control rides on, so
    // they are restored separately and by the same key the lanes use.
    if (m.schedule) {
      m.schedule.forEach((s) => {
        if (ctx.setCurve && s.curve) ctx.setCurve('axis:' + s.axis, s.curve);
      });
    }
    if (m.lanes) {
      for (const lk in m.lanes) {
        if (!m.lanes.hasOwnProperty(lk)) continue;
        if (lk === 'desk') {
          for (const d in m.lanes.desk) {
            if (m.lanes.desk.hasOwnProperty(d) && ctx.setCurve) ctx.setCurve('desk:' + d, m.lanes.desk[d]);
          }
        } else if (ctx.setCurve) ctx.setCurve(lk, m.lanes[lk]);
      }
    }
    ctx.persist();
    ctx.refreshDeck();
    return { set: set, missing: missing };
  }

  function loadManifest(path) {
    let json;
    try {
      json = JSON.parse(require('fs').readFileSync(path, 'utf8'));
    } catch (e) {
      ctx.status('could not read ' + path + ': ' + (e.message || e), 'err');
      return null;
    }
    if (!json || json.app !== 'qwen-image-lab' || !json.renders || !json.renders.length) {
      ctx.status(path + ' is not a qwen-image-lab manifest', 'err');
      return null;
    }
    const entry = json.renders[json.renders.length - 1];
    const r = applyEntry(entry);
    ctx.status('restored ' + r.set + ' control' + (r.set === 1 ? '' : 's') +
               ' from render ' + entry.index + ' of ' + json.renders.length +
               (r.missing.length ? ' · ' + r.missing.length + ' unknown (' +
                r.missing.slice(0, 3).join(', ') + ')' : ''),
               r.missing.length ? 'warn' : 'ok');
    return { json: json, entry: entry, applied: r };
  }

  function doLoad() {
    if (typeof window.showOpenFileDialog !== 'function') {
      ctx.status('file dialog unavailable in this build', 'err'); return;
    }
    const p = window.showOpenFileDialog('Manifest|json');
    if (p) loadManifest(p);
  }

  $('btn-hist-save-all').addEventListener('click', saveAll);
  $('btn-hist-load').addEventListener('click', doLoad);

  // Test seams: the dialogs are the only part a headless run cannot drive.
  ctx.saveAllTo = writeAll;
  ctx.loadManifest = loadManifest;
  ctx.buildManifest = () => buildManifest(ctx.history);
  ctx.applyManifestEntry = applyEntry;
}
