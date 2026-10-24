// Lockstep tab: a tick function is sealed into a capsule
// (bro.net.createVerifiedCapsule), checked by the gate (determinism lint and
// SHA-256 digest; bro.net.verifyCapsule), and run by two rollback sessions
// whose inputs reach each other `delay` frames late. Each peer predicts the
// other's input, rolls back when the real one arrives and resimulates. The
// page replays the tick itself with the true inputs to get the ground truth
// for every frame, so it can show where each peer's live view was wrong and
// that both still end on the truth. It also recomputes the capsule digest.

import { $, h, clear, readout, frameLoop } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, alpha, compileFn, verdict, checks, legend, presetPicker, short } from "./common.js";

const AW = 600, AH = 360;
const INIT = [150, 180, 450, 180, 0, 0];

export const PRESETS = {
  arena: {
    label: 'Arena',
    note: 'Two players steered by 4-bit inputs, wrapping at the edges. Each peer guesses that the other keeps pressing what it pressed last; every change of input is a misprediction the peer later rolls back.',
    src: `function tick(state, inputs) {
  for (let p = 0; p < 2; p++) {
    const i = inputs[p] | 0;
    const vx = ((i & 2) ? 5 : 0) - ((i & 1) ? 5 : 0);
    const vy = ((i & 8) ? 5 : 0) - ((i & 4) ? 5 : 0);
    state[2 * p] = (state[2 * p] + vx + 600) % 600;
    state[2 * p + 1] = (state[2 * p + 1] + vy + 360) % 360;
  }
  state[4] = (state[4] + 1) | 0;
}`,
  },
  tag: {
    label: 'Tag',
    note: 'The same players bouncing off the walls, with a contact counter. Game logic that branches on positions makes a wrong guess cost more: the counter itself has to be rolled back.',
    src: `function tick(state, inputs) {
  for (let p = 0; p < 2; p++) {
    const i = inputs[p] | 0;
    const vx = ((i & 2) ? 6 : 0) - ((i & 1) ? 6 : 0);
    const vy = ((i & 8) ? 6 : 0) - ((i & 4) ? 6 : 0);
    let x = state[2 * p] + vx, y = state[2 * p + 1] + vy;
    if (x < 0) x = -x;
    if (x > 600) x = 1200 - x;
    if (y < 0) y = -y;
    if (y > 360) y = 720 - y;
    state[2 * p] = x;
    state[2 * p + 1] = y;
  }
  const dx = state[0] - state[2], dy = state[1] - state[3];
  if (dx * dx + dy * dy < 1600) state[5] = (state[5] + 1) | 0;
  state[4] = (state[4] + 1) | 0;
}`,
  },
  hazard: {
    label: 'Nondeterministic',
    note: 'Random jitter, the wall clock and a transcendental: each gives peers (or a replay) different answers. The gate rejects the capsule before either session runs it.',
    src: `function tick(state, inputs) {
  const jitter = Math.floor(Math.random() * 10);
  const clock = Date.now() & 7;
  const sway = Math.sin(state[4] * 0.1) * 4;
  state[0] = (state[0] + (inputs[0] | 0) + jitter) | 0;
  state[1] = (state[1] + clock + sway) | 0;
  state[4] = (state[4] + 1) | 0;
}`,
  },
};

// Held inputs per player: a 4-bit direction kept for 6 to 17 frames.
function inputScript(frames, seed) {
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const out = [];
  let cur = 0, left = 0;
  const dirs = [2, 1, 8, 4, 10, 6, 9, 5, 0];
  for (let f = 0; f < frames; f++) {
    if (left-- <= 0) { cur = dirs[rnd() % dirs.length]; left = 6 + (rnd() % 12); }
    out.push(cur);
  }
  return out;
}

export function createLockstepTab(app) {
  const kv = readout('#lock-kv', {
    capsule: 'capsule',
    rollbacks: 'rollbacks (peer 0 / 1)',
    resim: 'frames resimulated',
    wrong: 'frames a view was wrong',
    checksum: 'final checksum',
  });
  const answer = verdict('#lock-verdict');
  const checkList = checks('#lock-checks');
  const picker = presetPicker('#lock-presets', PRESETS, (k) => load(k));
  const state = { key: null, capsule: null, verifyResult: null, sim: null, frame: 0, playing: true, listing: null };

  const delayEl = $('#lock-delay'), framesEl = $('#lock-frames'), frameEl = $('#lock-frame');
  const sync = () => {
    $('#lock-delay-val').textContent = delayEl.value + ' fr';
    $('#lock-frames-val').textContent = framesEl.value;
  };

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#lock-note').textContent = p.note;
    $('#lock-src').value = p.src;
    run();
  }

  function run() {
    const src = $('#lock-src').value;
    const capsule = bro.net.createVerifiedCapsule(src, { entryName: 'tick', authorId: 'solver-lab' });
    const sent = $('#lock-tamper').checked ? tamper(capsule) : capsule;
    const ver = bro.net.verifyCapsule(sent, { requireDeterminismLint: true, requireHazardFree: true });
    state.capsule = sent;
    state.verifyResult = ver;
    state.sim = null;

    if (!ver.valid) {
      rejected(sent, ver);
    } else {
      const loaded = bro.net.loadVerifiedCapsule(sent, { requireDeterminismLint: true, requireHazardFree: true });
      state.sim = simulate(loaded.fn, compileFn(src), Number(framesEl.value), Number(delayEl.value));
      accepted(sent, ver);
    }
    digestCheck(sent);
    app.redraw();
  }

  // Change the first integer literal above 1, as a man in the middle might.
  function tamper(capsule) {
    let done = false;
    const source = capsule.source.replace(/\b([2-9])\b/, (m) => { done = true; return String(Number(m) + 1); });
    return Object.assign({}, capsule, { source: done ? source : capsule.source + ' ' });
  }

  function simulate(tickFn, pageTick, frames, delay) {
    const inputs = [inputScript(frames, 0x9E3779B9), inputScript(frames, 0x85EBCA6B)];
    const peers = [0, 1].map((id) => bro.net.createRollbackSession({
      tick: tickFn, initialState: new Int32Array(INIT), playerCount: 2, localPlayerId: id, maxRollbackFrames: 64,
    }));

    // Ground truth: the page's own replay with every input known.
    const truth = [];
    const t = new Int32Array(INIT);
    for (let f = 0; f < frames; f++) {
      pageTick(t, [inputs[0][f], inputs[1][f]]);
      truth.push(Array.from(t));
    }

    // A frame is confirmed once both inputs for it have arrived; its snapshot
    // is compared then, while it is still in the sessions' rollback history.
    const confirmed = new Array(frames).fill(false);
    const confirm = (d) => {
      const a = peers[0].getSnapshot(d + 1), b = peers[1].getSnapshot(d + 1);
      confirmed[d] = !!(a && b && a.checksumHex === b.checksumHex && peers[0].verifyPeerChecksum(d + 1, b.checksumHex));
    };
    const deliver = (d) => {
      peers[0].receiveRemoteInput(d, 1, inputs[1][d]);
      peers[1].receiveRemoteInput(d, 0, inputs[0][d]);
      confirm(d);
    };
    const live = [[], []], rolled = [[], []];
    for (let f = 0; f < frames; f++) {
      const before = peers.map((p) => p.getStats().rollbackCount);
      peers[0].advanceFrame(inputs[0][f]);
      peers[1].advanceFrame(inputs[1][f]);
      if (f - delay >= 0) deliver(f - delay);
      peers.forEach((p, i) => {
        live[i].push(Array.from(p.state));
        rolled[i].push(p.getStats().rollbackCount - before[i]);
      });
    }
    for (let d = Math.max(0, frames - delay); d < frames; d++) deliver(d);
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    const wrong = [0, 1].map((i) => live[i].map((s, f) => !same(s, truth[f])));
    const stats = peers.map((p) => p.getStats());
    return {
      frames, delay, inputs, truth, live, rolled, wrong, confirmed,
      final: peers.map((p) => Array.from(p.state)),
      checksums: peers.map((p) => p.checksumHex),
      rollbacks: stats.map((s) => s.rollbackCount),
      resim: stats.reduce((n, s) => n + s.totalFramesResimulated, 0),
      desync: peers.some((p) => p.desyncDetected),
      lint: peers[0].determinismLintPassed,
      desyncDetectionEnabled: peers[0].desyncDetectionEnabled,
    };
  }

  function accepted(capsule, ver) {
    const s = state.sim;
    const allMatched = s.confirmed.every(Boolean);
    const wrongFrames = s.wrong[0].filter(Boolean).length + s.wrong[1].filter(Boolean).length;
    answer.set(allMatched ? 'ok' : 'err', allMatched ? 'IN SYNC' : 'DESYNC',
      `${s.frames} frames, inputs ${s.delay} frames late, ${s.rollbacks[0] + s.rollbacks[1]} rollbacks`);
    kv.set('capsule', `verified, sha ${short(ver.sha256, 10)}`, true);
    kv.set('rollbacks', `${s.rollbacks[0]} / ${s.rollbacks[1]}`);
    kv.set('resim', String(s.resim));
    kv.set('wrong', `${wrongFrames} of ${2 * s.frames}`);
    kv.set('checksum', s.checksums[0] === s.checksums[1] ? s.checksums[0] : `${s.checksums[0]} ≠ ${s.checksums[1]}`, s.checksums[0] === s.checksums[1]);

    const finalTruth = s.truth[s.frames - 1];
    const replayOk = s.final.every((st) => st.every((v, i) => v === finalTruth[i]));
    state.baseChecks = [
      { ok: allMatched, label: allMatched ? `both peers hold the same confirmed checksum on all ${s.frames} frames` : `${s.confirmed.filter((x) => !x).length} frames confirm different checksums` },
      { ok: replayOk, label: replayOk ? 'both end on the state the page reaches replaying the tick itself with every input known' : 'the peers\' final state differs from the page\'s own replay', detail: `final state [${finalTruth.join(', ')}]` },
      { ok: null, label: `the live views were wrong on ${wrongFrames} peer-frames while inputs were in flight; rollback repaired every one`, detail: 'amber cells in the timeline' },
    ];
    renderChecks();
    frameEl.max = String(s.frames - 1);
    state.frame = Math.min(state.frame, s.frames - 1);
    state.listing = null;
    app.report({ verdict: allMatched ? 'in sync' : 'desync', solved: `${s.rollbacks[0] + s.rollbacks[1]} rollbacks`, checks: '' },
      allMatched ? 'Both peers agree on every confirmed frame' : 'Peers disagree', allMatched && replayOk ? 'ok' : 'warn');
  }

  function rejected(capsule, ver) {
    const hz = ver.hazards || [];
    answer.set('err', 'REJECTED', ver.tampered ? 'the capsule was altered after it was sealed' : `${hz.length} determinism hazard${hz.length === 1 ? '' : 's'} in the tick`);
    kv.set('capsule', ver.tampered ? 'digest mismatch' : 'failed the lint', false);
    for (const k of ['rollbacks', 'resim', 'wrong', 'checksum']) kv.set(k, '—', false);
    state.baseChecks = [{ ok: true, label: 'neither session ran the tick: the gate stopped it first', detail: ver.reason }];
    renderChecks();
    state.listing = { source: capsule.source, hazards: hz, tampered: ver.tampered };
    app.report({ verdict: 'rejected', solved: ver.tampered ? 'tampered' : `${hz.length} hazards`, checks: '' },
      ver.tampered ? 'Capsule rejected: its digest no longer matches its source' : `Capsule rejected: ${hz.length} hazards`, 'warn');
  }

  // The digest the gate trusts, recomputed by the page with WebCrypto.
  function digestCheck(capsule) {
    state.digest = null;
    const subtle = globalThis.crypto && crypto.subtle;
    if (!subtle) { state.digest = { ok: null, label: 'no WebCrypto here to recompute the digest' }; renderChecks(); return; }
    const sealed = state.capsule === capsule ? capsule.sha256 : null;
    subtle.digest('SHA-256', new TextEncoder().encode(capsule.source)).then((buf) => {
      if (state.capsule !== capsule) return;
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      const tampered = state.verifyResult && state.verifyResult.tampered;
      state.digest = tampered
        ? { ok: hex !== sealed, label: 'the page\'s SHA-256 of the received source differs from the sealed digest too', detail: `${short(hex, 16)} vs ${short(sealed, 16)}` }
        : { ok: hex === sealed, label: hex === sealed ? 'the page\'s own SHA-256 of the source equals the sealed digest' : 'the page computes a different digest than the capsule carries', detail: short(hex, 24) };
      renderChecks();
    }, () => {});
  }

  function renderChecks() {
    const list = (state.baseChecks || []).concat(state.digest ? [state.digest] : []);
    const tally = checkList.set(list);
    app.reportChecks(`${tally.passed}/${list.filter((c) => c.ok !== null).length}`);
  }

  function draw() {
    const listing = $('#lock-listing'), canvas = $('#lock-view');
    $('#lock-scrub').hidden = !state.sim;
    if (state.listing) {
      canvas.hidden = true;
      listing.hidden = false;
      drawListing(listing);
      return;
    }
    canvas.hidden = false;
    listing.hidden = true;
    const s = state.sim;
    const { ctx, w, h: hh } = fitCanvas('#lock-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    if (!s) return;
    const f = state.frame;
    $('#lock-title').textContent = `Two peers, inputs ${s.delay} frames late: frame ${f + 1} of ${s.frames}`;
    $('#lock-frame-val').textContent = `${f + 1} / ${s.frames}`;
    if (Number(frameEl.value) !== f) frameEl.value = String(f);
    legend('#lock-legend', [[C.accent, 'player 0'], [C.ok, 'player 1'], [C.warn, 'where it really is', 'ring'], [alpha(C.warn, 0.7), 'view wrong'], [C.err, 'rollback', 'line']]);

    // Arenas as large as the width allows, the timeline taking what height is
    // left (within reason), the whole block centred.
    const pad = 18, gap = 18, label = 14, axis = 22;
    const minTl = 118, maxTl = 200;
    const arenaH = Math.max(80, hh - minTl - pad * 3 - label - axis);
    const aw = Math.min((w - pad * 2 - gap) / 2, arenaH * AW / AH);
    const ah = aw * AH / AW;
    const tlH = Math.max(minTl, Math.min(maxTl, hh - ah - pad * 3 - label - axis));
    const blockH = label + ah + pad + tlH + axis;
    const top = Math.max(pad, (hh - blockH) / 2);
    const left = (w - (aw * 2 + gap)) / 2;
    for (let i = 0; i < 2; i++) drawArena(ctx, left + i * (aw + gap), top + label, aw, ah, i, f);
    drawTimeline(ctx, left, top + label + ah + pad, aw * 2 + gap, tlH, f);
  }

  function drawArena(ctx, x, y, w, hh, peer, f) {
    const s = state.sim;
    const sx = (v) => x + (v / AW) * w, sy = (v) => y + (v / AH) * hh;
    ctx.font = C.font;
    ctx.fillStyle = C.muted;
    ctx.fillText(`Peer ${peer}'s live view`, x, y - 5);
    const isWrong = s.wrong[peer][f];
    ctx.fillStyle = isWrong ? '#17140e' : C.surface;
    ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = isWrong ? alpha(C.warn, 0.6) : C.border;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    if (isWrong) {
      ctx.fillStyle = C.warn;
      ctx.textAlign = 'right';
      ctx.fillText('predicting the other player', x + w - 8, y + 16);
      ctx.textAlign = 'left';
    }
    const cols = [C.accent, C.ok];
    for (let p = 0; p < 2; p++) {
      ctx.strokeStyle = alpha(cols[p], 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (let k = Math.max(0, f - 40); k <= f; k++) {
        const st = s.live[peer][k], prev = k > 0 ? s.live[peer][k - 1] : null;
        const px = sx(st[2 * p]), py = sy(st[2 * p + 1]);
        const jump = prev && (Math.abs(st[2 * p] - prev[2 * p]) > 40 || Math.abs(st[2 * p + 1] - prev[2 * p + 1]) > 40);
        if (!pen || jump) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
      const st = s.live[peer][f], tr = s.truth[f];
      if (st[2 * p] !== tr[2 * p] || st[2 * p + 1] !== tr[2 * p + 1]) {
        ctx.strokeStyle = C.warn;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(sx(st[2 * p]), sy(st[2 * p + 1])); ctx.lineTo(sx(tr[2 * p]), sy(tr[2 * p + 1])); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx(tr[2 * p]), sy(tr[2 * p + 1]), 9, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = cols[p];
      ctx.beginPath(); ctx.arc(sx(st[2 * p]), sy(st[2 * p + 1]), 7, 0, Math.PI * 2); ctx.fill();
    }
    if (state.key === 'tag') {
      ctx.fillStyle = C.muted;
      ctx.fillText(`contacts ${s.live[peer][f][5]}  (really ${s.truth[f][5]})`, x + 8, y + hh - 8);
    }
  }

  // Per-frame rows: was each live view right, did a rollback happen, does the
  // confirmed checksum match.
  function drawTimeline(ctx, x, y, w, hh, f) {
    const s = state.sim;
    const labelW = 150;
    const cw = (w - labelW) / s.frames;
    const rows = [
      ['peer 0 view', (k) => (s.wrong[0][k] ? alpha(C.warn, 0.7) : alpha(C.ok, 0.35))],
      ['peer 1 view', (k) => (s.wrong[1][k] ? alpha(C.warn, 0.7) : alpha(C.ok, 0.35))],
      ['rollbacks', null],
      ['confirmed checksums', (k) => (s.confirmed[k] ? alpha(C.ok, 0.6) : C.err)],
    ];
    const rh = (hh - 8) / rows.length;
    ctx.font = C.font;
    rows.forEach(([label, color], r) => {
      const ry = y + r * rh;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, x, ry + rh / 2 + 4);
      if (color) {
        for (let k = 0; k < s.frames; k++) {
          ctx.fillStyle = color(k);
          ctx.fillRect(x + labelW + k * cw, ry + 3, Math.max(1, cw - 1), rh - 6);
        }
      } else {
        ctx.fillStyle = C.input;
        ctx.fillRect(x + labelW, ry + 3, w - labelW, rh - 6);
        for (let k = 0; k < s.frames; k++) {
          const n = s.rolled[0][k] + s.rolled[1][k];
          if (!n) continue;
          ctx.fillStyle = C.err;
          ctx.fillRect(x + labelW + k * cw + cw / 2 - 1, ry + 3, 2, rh - 6);
        }
      }
    });
    // Frame axis.
    const every = cw * 10 >= 36 ? 10 : cw * 20 >= 36 ? 20 : 50;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    for (let k = 0; k <= s.frames; k += every) {
      const px = x + labelW + k * cw;
      ctx.fillRect(px, y + hh - 6, 1, 4);
      ctx.fillText(String(k), px, y + hh + 10);
    }
    ctx.textAlign = 'left';
    ctx.fillText('frame', x, y + hh + 10);
    ctx.fillStyle = C.text;
    ctx.fillRect(x + labelW + f * cw + cw / 2 - 1, y - 2, 2, hh - 4);
  }

  function drawListing(node) {
    const L = state.listing;
    $('#lock-title').textContent = L.tampered ? 'The capsule as received: altered in transit' : 'Rejected by the determinism lint';
    legend('#lock-legend', L.tampered ? [] : [[C.err, 'hazard']]);
    clear(node);
    const byLine = {};
    for (const hz of L.hazards) (byLine[hz.line] = byLine[hz.line] || []).push(hz);
    const lines = L.source.split('\n');
    lines.forEach((text, i) => {
      const hz = byLine[i + 1];
      const row = h(hz ? 'span.hz' : 'span', null, h('span.ln', null, String(i + 1)), text, hz ? '' : '\n');
      node.appendChild(row);
      if (hz) for (const z of hz) node.appendChild(h('span.note', null, `${z.kind}: ${z.message}`, h('small', null, 'fix: ' + z.remediation)));
    });
    if (L.tampered) node.appendChild(h('span.note', null, 'The source no longer hashes to the digest it was sealed with.', h('small', null, 'bro.net.verifyCapsule refuses it, so no peer can load it.')));
  }

  const loop = frameLoop(() => {
    if (!state.playing || !state.sim || state.listing || app.active() !== 'lockstep') return;
    state.frame = (state.frame + 1) % state.sim.frames;
    draw();
  });
  $('#lock-play').addEventListener('click', () => {
    state.playing = !state.playing;
    $('#lock-play').textContent = state.playing ? 'Pause' : 'Play';
  });
  frameEl.addEventListener('input', () => {
    state.frame = Number(frameEl.value);
    state.playing = false;
    $('#lock-play').textContent = 'Play';
    draw();
  });
  for (const el of [delayEl, framesEl]) {
    el.addEventListener('input', sync);
    el.addEventListener('change', run);
  }
  $('#lock-tamper').addEventListener('change', run);
  $('#lock-run').addEventListener('click', run);
  delayEl.value = '4';
  framesEl.value = '120';
  sync();

  return { state, load, run, draw, loop, question: 'Do two peers with late inputs still agree on every frame?' };
}
