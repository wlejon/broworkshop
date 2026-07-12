// ── find character panel ────────────────────────────────────────────────
// The identity-research M3 search promoted into the lab: hold a reference
// render's CHARACTER while every other control (prompt, dials, axes, LoRAs)
// says what to render. A staged beam over init seeds runs in the pipeline
// worker (judged x̂0 previews prune 32 → 16 → 8 → finish), and an identity
// judge — DINOv2 head localization + a Qwen3-VL attribute questionnaire —
// runs as a SECOND bro-headless process on its own GPU, bridged over
// bro.net. Fully automated: reference + current settings in, best image +
// its seed out. See D:/projects/identity-research/FINDINGS.md for the
// validation trail (M0–M5).

import { $ } from '/app/ui/util.js';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');

const PORT = 27071;

const SCHEMAS = {
  human: [
    ['age_band', 'child, teenager, young_adult, middle_aged, elderly'],
    ['hair_color', 'golden_blonde, light_blonde, brown, black, gray, white, red'],
    ['hair_texture', 'straight, wavy, curly'],
    ['hair_length', 'very_short, short, medium, long'],
    ['face_shape', 'narrow, oval, round, square'],
    ['build', 'slim, average, stocky, heavyset'],
  ],
  creature: [
    ['age_band', 'juvenile, adult'],
    ['muzzle_color', 'white, gray, mixed, dark'],
    ['eye_color', 'amber, brown, green, blue'],
    ['face_marking', 'none, thin_stripe, wide_band, patch'],
    ['ear_tip', 'black, dark, orange, white'],
    ['build', 'slim, average, stocky'],
  ],
};

// The app dir on disk. BRO_APP_DIR is set by both bro and bro-headless;
// the URL fallback covers older builds (headless pages live at bro://app/,
// where the pathname carries no directory at all).
function appDir() {
  const env = (process.env.BRO_APP_DIR || '').replace(/\\/g, '/');
  if (env) return env;
  let p = decodeURIComponent(location.pathname || '');
  p = p.replace(/\/index\.html$/i, '');
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);   // "/D:/x" -> "D:/x"
  return p;
}

export function initSearch(ctx) {
  const prefs = ctx.prefs;
  const client = ctx.client;

  // ── prefs ──────────────────────────────────────────────────────────────
  if (prefs.fcHeadless) $('fc-headless').value = prefs.fcHeadless;
  if (prefs.fcQwen) $('fc-qwen').value = prefs.fcQwen;
  if (prefs.fcDino) $('fc-dino').value = prefs.fcDino;
  if (prefs.fcBox) $('fc-box').value = prefs.fcBox;
  if (prefs.fcSchema) $('fc-schema').value = prefs.fcSchema;
  if (prefs.fcN) $('fc-n').value = prefs.fcN;
  ctx.onPersist((p) => {
    p.fcHeadless = $('fc-headless').value;
    p.fcQwen = $('fc-qwen').value;
    p.fcDino = $('fc-dino').value;
    p.fcBox = $('fc-box').value;
    p.fcSchema = $('fc-schema').value;
    p.fcN = $('fc-n').value;
  });

  // ── state ──────────────────────────────────────────────────────────────
  const runRoot = os.tmpdir().replace(/\\/g, '/') + '/krea2-find-character';
  let refPath = null, refSeed = null;
  let conn = null, judgeInited = false, judgeChild = null;
  const netWaiters = [];          // FIFO for init replies
  const judgeById = {};           // id -> worker bridging

  function fcStatus(msg, kind) {
    const el = $('fc-status');
    el.textContent = msg;
    el.className = 'hint' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  }

  // ── judge child + bro.net bridge ───────────────────────────────────────
  bro.net.onmessage = (id, data) => {
    let m;
    try { m = JSON.parse(new TextDecoder().decode(data)); } catch (e) { return; }
    if (m.type === 'ready' || (m.type === 'error' && m.id == null)) {
      const w = netWaiters.shift();
      if (w) w(m);
      return;
    }
    const kind = judgeById[m.id];
    if (kind == null) return;
    delete judgeById[m.id];
    if (m.type === 'error') {
      client.sendAux({ type: 'judgeRes', id: m.id, error: m.message });
    } else {
      client.sendAux({ type: 'judgeRes', id: m.id,
                       score: m.type === 'softscore' ? m.soft : m.score });
    }
  };

  client.onSide((msg) => {
    if (msg.type === 'judgeReq' || msg.type === 'softReq') {
      if (conn == null) {
        client.sendAux({ type: 'judgeRes', id: msg.id, error: 'judge gone' });
        return;
      }
      judgeById[msg.id] = msg.type;
      bro.net.send(conn, JSON.stringify({
        type: msg.type === 'softReq' ? 'soft' : 'judge',
        id: msg.id, path: msg.path,
      }));
    } else if (msg.type === 'searchProgress') {
      fcStatus('search ' + msg.stage + ' ' + msg.done + '/' + msg.total +
               ' · ' + msg.note);
    }
  });

  // The judge is a long-lived server, so cp.spawn (execFile is blocking in
  // brokit). Its output goes to judge_child.log; if it dies, every pending
  // request must fail — otherwise the search hangs forever on a reply that
  // will never come.
  function spawnJudge() {
    if (judgeChild) return;
    const exe = $('fc-headless').value.trim();
    if (!exe) throw new Error('set the bro-headless path');
    const dir = appDir() + '/judge';
    fs.mkdirSync(runRoot, { recursive: true });
    const childLog = runRoot + '/judge_child.log';
    judgeChild = cp.spawn(exe, [dir, dir + '/judge.js'], {
      env: Object.assign({}, process.env,
          { CUDA_VISIBLE_DEVICES: '1', BRO_JUDGE_PORT: String(PORT) }),
      stdoutFile: childLog,
      stderrFile: childLog,
    });
    judgeChild.on('exit', (code) => {
      judgeChild = null;
      judgeInited = false;
      conn = null;
      const err = { type: 'error',
                    message: 'judge exited (code ' + code + ') — see ' + childLog };
      while (netWaiters.length) netWaiters.shift()(err);
      for (const id of Object.keys(judgeById)) {
        delete judgeById[id];
        client.sendAux({ type: 'judgeRes', id: +id, error: err.message });
      }
    });
  }

  function connect() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      bro.net.onconnect = (id) => { conn = id; resolve(); };
      (function attempt() {
        if (conn != null) return;
        if (++tries > 60) { reject(new Error('judge unreachable')); return; }
        bro.net.connect('127.0.0.1:' + PORT);
        setTimeout(attempt, 1000);
      })();
    });
  }

  function judgeRequest(obj) {
    return new Promise((resolve) => {
      netWaiters.push(resolve);
      bro.net.send(conn, JSON.stringify(obj));
    });
  }

  // ── reference capture ──────────────────────────────────────────────────
  $('fc-set-ref').addEventListener('click', () => {
    const canvas = $('view');
    if (canvas.style.display === 'none' || !canvas.width) {
      fcStatus('render something first', 'err');
      return;
    }
    fs.mkdirSync(runRoot, { recursive: true });
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width,
                                                   canvas.height);
    refPath = runRoot + '/reference.png';
    bro.image.encodePngFile(refPath, d.data, d.width, d.height, 4,
                            d.width * 4);
    refSeed = $('seed').value;
    judgeInited = false;             // re-init the judge on the new anchor
    $('fc-ref-note').textContent =
        'reference set (seed ' + refSeed + ', ' + d.width + '×' + d.height +
        ') — now change settings and Find';
    fcStatus('');
  });

  // ── the button ─────────────────────────────────────────────────────────
  $('fc-go').addEventListener('click', async () => {
    try {
      if (!ctx.loaded) { fcStatus('load the model first', 'err'); return; }
      if (ctx.busy) { fcStatus('busy — wait for the current render', 'err'); return; }
      if (!refPath) { fcStatus('set a reference first', 'err'); return; }
      const box = ($('fc-box').value || '').split(',').map(Number);
      if (box.length !== 4 || box.some(isNaN)) {
        fcStatus('head box: x0,y0,x1,y1 in reference pixels', 'err');
        return;
      }
      const n = Math.max(4, Math.min(64, +$('fc-n').value || 32));
      ctx.persist();
      ctx.setBusy(true);

      fcStatus('starting judge…');
      spawnJudge();
      await connect();
      if (!judgeInited) {
        fcStatus('judge: loading models + reading reference…');
        const r = await judgeRequest({
          type: 'init',
          qwenDir: $('fc-qwen').value.trim(),
          dinoDir: $('fc-dino').value.trim(),
          refPath: refPath, headBox: box,
          schema: SCHEMAS[$('fc-schema').value] || SCHEMAS.human,
        });
        if (r.type === 'error') throw new Error('judge init: ' + r.message);
        judgeInited = true;
        $('fc-refcrop').src = r.refCropPath;   // unique path per init
        $('fc-refcrop').style.display = '';
        $('fc-ref-note').textContent = 'judge anchor: ' +
            Object.entries(r.refAnswers)
                  .map(([k, v]) => k + '=' + v).join(' ');
      }

      const runDir = runRoot + '/run_' + Date.now();
      fs.mkdirSync(runDir, { recursive: true });
      const seeds = [];
      for (let i = 0; i < n; i++) seeds.push(ctx.randomSeed());

      const base = ctx.buildGenerateMsg('full');
      fcStatus('searching ' + n + ' seeds…');
      client.send({ type: 'findCharacter', base: base, seeds: seeds,
                    runDir: runDir }, (err, resp) => {
        ctx.setBusy(false);
        if (err) { fcStatus(String(err.message || err), 'err'); return; }
        ctx.drawBitmap(resp.bitmap, resp.width, resp.height);
        $('seed').value = String(resp.seed);
        ctx.recordSeed(resp.seed);
        ctx.addHistoryEntry(resp.bitmap, resp.width, resp.height,
            { seed: resp.seed, steps: base.opts.steps,
              width: resp.width, height: resp.height });
        ctx.persist();
        fcStatus('found seed ' + resp.seed + ' · score ' +
                 resp.score.toFixed(2) +
                 (resp.soft != null ? ' · soft ' + resp.soft.toFixed(3) : '') +
                 ' · ' + Math.round(resp.ms / 1000) + 's', 'ok');
        // Parser-created <img> (createElement('img') returns the canvas
        // decode-Image, not a DOM element). Paths are unique per run dir, so
        // no cache-buster — the loader takes src as a literal file path.
        $('fc-ladder').innerHTML = resp.ladder.map((c) => {
          const title = 'seed ' + c.seed + ' · ' + c.final.toFixed(2) +
                        (c.soft != null ? ' · soft ' + c.soft.toFixed(3) : '');
          return '<img src="' + c.path + '" title="' + title + '" style="' +
                 'width:72px;height:72px;object-fit:cover;margin:2px;' +
                 (c.seed === resp.seed ? 'outline:2px solid #4a4' : '') + '">';
        }).join('');
      });
    } catch (e) {
      ctx.setBusy(false);
      fcStatus(String(e.message || e), 'err');
    }
  });
}
