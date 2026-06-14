// Listen Lab — gestures (tier-0 non-speech) + clip editor + mic recording.
// (load after timeline.js)
//
// The gesture VOCABULARY is shared (one master, bro.gesture = the mic stream's
// matcher); the right-column rows render it. But EVERY stream runs its own
// gesture session (the mic's master + each added stream's handle session) over
// the shared SensorHub, so a click/whistle on any source fires on THAT stream's
// dashboard. Enrolling adds to the master and mirrors onto every stream.
import { LL } from "/app/core.js";
    const { $gestures, $noGest, $record, $phrase, $spotCount,
            status, fusionRow, mkbtn, playSamples, logEvent } = LL;

const gestRows = {};            // name -> { root, body, editBtn }
const clipStore = {};           // name -> Float32Array (raw 16 kHz enroll clip)
const policyStore = {};         // name -> per-gesture tolerance overrides
let openEditor = null;          // name of the gesture whose editor is expanded
let currentEd = null;           // the live editor object (for listener teardown)
let recording = false;          // a mic ● Record capture is in progress
const GEST_RATE = 16000;        // bro.gesture.sampleRate() — fixed host rate

function rhythmShape(v) {
    if (!v.onsets || !v.onsets.length) return '';
    let voiced = 0, pitchSum = 0, pitchN = 0;
    for (const o of v.onsets) {
        if (o.voiced >= 0.5) { voiced++; if (o.pitchHz > 0) { pitchSum += o.pitchHz; pitchN++; } }
    }
    if (voiced === 0) return ' · clicks';
    if (voiced === v.onsets.length)
        return pitchN ? ' · voiced ~' + Math.round(pitchSum / pitchN) + ' Hz' : ' · voiced';
    return ' · mixed';
}

function gestureSummary(v) {
    if (!v) return '';
    if (v.kind === 'tone')
        return 'tone · ' + Math.round(v.toneHz) + ' Hz · ' + Math.round(v.toneMs) +
            ' ms · ±' + (v.toneSpread * 100).toFixed(1) + '%';
    const taps = v.intervalsMs.length + 1;
    return 'rhythm · ' + taps + ' taps · ' +
        v.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms' + rhythmShape(v);
}

function renderGestureRows() {
    Object.keys(gestRows).forEach((k) => { gestRows[k].root.remove(); delete gestRows[k]; });
    const names = bro.gesture.templates();
    $noGest.style.display = names.length ? 'none' : '';
    for (const name of names) {
        const v = bro.gesture.inspect(name);
        const root = document.createElement('div');
        root.className = 'gest';
        root.innerHTML =
            '<div class="grow">' +
              '<span class="gname"></span>' +
              '<span class="gkind ' + (v ? v.kind : '') + '">' + (v ? v.kind : '?') + '</span>' +
              '<span class="gmeta"></span>' +
              '<button class="edit" title="audition, trim, tune">edit</button>' +
              '<button class="rm" title="remove">×</button>' +
            '</div><div class="geditor"></div>';
        root.querySelector('.gname').textContent = name;
        root.querySelector('.gmeta').textContent = gestureSummary(v);
        const editBtn = root.querySelector('.edit');
        editBtn.disabled = !clipStore[name];
        editBtn.title = clipStore[name] ? 'audition, trim, tune' : 'no retained clip (enrolled before edit existed)';
        editBtn.addEventListener('click', () => toggleEditor(name));
        root.querySelector('.rm').addEventListener('click', () => {
            if (openEditor === name) openEditor = null;
            delete clipStore[name]; delete policyStore[name];
            withMutableGesture(() => bro.gesture.remove(name));
        });
        $gestures.appendChild(root);
        gestRows[name] = { root, body: root.querySelector('.geditor'), editBtn };
    }
    if (openEditor && gestRows[openEditor]) buildEditor(openEditor);
}

function flashGesture(name) {
    const row = gestRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    setTimeout(() => { if (gestRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── clip editor (audition / trim / re-record / tune) ─────────────────────────

function detachEditor() {
    if (currentEd && currentEd._detach) currentEd._detach();
    currentEd = null;
}

function toggleEditor(name) {
    if (!clipStore[name]) { status('no retained clip for "' + name + '" — re-record to edit', true); return; }
    openEditor = (openEditor === name) ? null : name;
    Object.keys(gestRows).forEach((k) => {
        if (k !== openEditor) { gestRows[k].body.innerHTML = ''; gestRows[k].editBtn.classList.remove('open'); }
    });
    if (!openEditor) { detachEditor(); return; }
    buildEditor(openEditor);
}

function pitchColor(hz, alpha) {
    const lo = Math.log2(150), hi = Math.log2(4000);
    const t = Math.max(0, Math.min(1, (Math.log2(Math.max(1, hz)) - lo) / (hi - lo)));
    return 'hsla(' + (210 - t * 210).toFixed(0) + ',72%,56%,' + (alpha != null ? alpha : 0.34) + ')';
}

function gainedSlice(clip, gain, a, b) {
    const out = new Float32Array(b - a);
    for (let i = a; i < b; i++) out[i - a] = clip[i] * gain;
    return out;
}

function clipPeakDb(clip, gain, a, b) {
    let pk = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(clip[i] * gain); if (v > pk) pk = v; }
    return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
}

function fitWave(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

function drawWave(ed) {
    const canvas = ed.canvas, clip = ed.clip, a = ed.analysis;
    const w = Math.max(180, (canvas.parentNode.clientWidth || 320));
    const h = 76;
    const ctx = fitWave(canvas, w, h);
    const n = clip.length, mid = h / 2;
    const x = (samp) => samp / n * w;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, w, h);

    if (a) {
        for (let f = 0; f < a.frames; f++) {
            if (a.flags[f] & 2) {
                const x0 = x(f * a.hop), x1 = x(f * a.hop + a.hop);
                ctx.fillStyle = pitchColor(a.dominantHz[f]);
                ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
            }
        }
    }
    ctx.strokeStyle = '#1d2330';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    ctx.strokeStyle = '#9aa6bc'; ctx.lineWidth = 1;
    ctx.beginPath();
    const g = ed.gain;
    for (let px = 0; px < w; px++) {
        const s0 = Math.floor(px / w * n);
        const s1 = Math.max(s0 + 1, Math.floor((px + 1) / w * n));
        let mn = 1, mx = -1;
        for (let i = s0; i < s1 && i < n; i++) { const val = clip[i] * g; if (val < mn) mn = val; if (val > mx) mx = val; }
        if (mn > mx) { mn = 0; mx = 0; }
        ctx.moveTo(px + 0.5, mid - mx * mid * 0.92);
        ctx.lineTo(px + 0.5, mid - mn * mid * 0.92);
    }
    ctx.stroke();

    if (a) {
        ctx.fillStyle = '#ffb454';
        for (let f = 0; f < a.frames; f++)
            if (a.flags[f] & 4) ctx.fillRect(x(f * a.hop) - 0.5, 0, 1.5, h);
    }

    const xa = x(ed.sel.a), xb = x(ed.sel.b);
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.fillRect(0, 0, xa, h); ctx.fillRect(xb, 0, w - xb, h);
    ctx.fillStyle = '#54d68a';
    ctx.fillRect(xa - 1, 0, 2, h); ctx.fillRect(xb - 1, 0, 2, h);
    ctx.fillRect(xa - 3, mid - 8, 6, 16); ctx.fillRect(xb - 3, mid - 8, 6, 16);
    ed._w = w;
}

function updateInfo(ed) {
    const a = Math.round(ed.sel.a), b = Math.round(ed.sel.b);
    const dur = (b - a) / GEST_RATE;
    const v = ed.v;
    const kindStr = v ? (v.kind === 'tone'
        ? 'tone · ' + Math.round(v.toneHz) + ' Hz · captured ±' + (v.toneSpread * 100).toFixed(1) + '% spread'
        : 'rhythm · ' + (v.intervalsMs.length + 1) + ' taps' + rhythmShape(v)) : '';
    const pk = clipPeakDb(ed.clip, ed.gain, a, b);
    const pkStr = ' · peak ' + (pk === -Infinity ? '−∞' : pk.toFixed(1)) + ' dB' +
        (pk > -0.1 ? ' ⚠ clipping' : '');
    ed.info.textContent = 'selection ' + dur.toFixed(2) + ' s · ' + kindStr + pkStr;
}

function attachTrim(ed) {
    const canvas = ed.canvas;
    let drag = null;
    const sampAt = (clientX) => {
        const r = canvas.getBoundingClientRect();
        const px = Math.max(0, Math.min(ed._w, clientX - r.left));
        return Math.round(px / ed._w * ed.clip.length);
    };
    const moveHandle = (s) => {
        if (drag === 'a') ed.sel.a = Math.min(s, ed.sel.b - 1);
        else ed.sel.b = Math.max(s, ed.sel.a + 1);
        ed.sel.a = Math.max(0, ed.sel.a);
        ed.sel.b = Math.min(ed.clip.length, ed.sel.b);
        drawWave(ed); updateInfo(ed);
    };
    canvas.addEventListener('mousedown', (e) => {
        const s = sampAt(e.clientX);
        drag = Math.abs(s - ed.sel.a) <= Math.abs(s - ed.sel.b) ? 'a' : 'b';
        moveHandle(s); e.preventDefault();
    });
    const onMove = (e) => { if (drag) moveHandle(sampAt(e.clientX)); };
    const onUp = () => { drag = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    ed._detach = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
    };
}

function addSlider(parent, label, key, val, min, max, step, name) {
    const wrap = document.createElement('label');
    wrap.className = 'gslider';
    const span = document.createElement('span'); span.textContent = label;
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = val;
    const out = document.createElement('b'); out.textContent = (val * 100).toFixed(0) + '%';
    input.addEventListener('input', () => { out.textContent = (+input.value * 100).toFixed(0) + '%'; });
    input.addEventListener('change', () => {
        const pol = Object.assign({}, policyStore[name] || {});
        pol[key] = +input.value;
        reEnroll(name, clipStore[name], pol);
    });
    wrap.append(span, input, out);
    parent.appendChild(wrap);
}

function addGainSlider(parent, ed, name) {
    const wrap = document.createElement('label');
    wrap.className = 'gslider';
    const span = document.createElement('span'); span.textContent = 'volume';
    const input = document.createElement('input');
    input.type = 'range'; input.min = 0; input.max = 4; input.step = 0.05; input.value = ed.gain;
    const out = document.createElement('b'); out.textContent = '×' + ed.gain.toFixed(2);
    input.addEventListener('input', () => {
        ed.gain = +input.value;
        out.textContent = '×' + ed.gain.toFixed(2);
        drawWave(ed); updateInfo(ed);
    });
    input.addEventListener('change', () => {
        ed.gain = +input.value;
        if (Math.abs(ed.gain - 1) < 1e-3) return;
        reEnroll(name, gainedSlice(ed.clip, ed.gain, 0, ed.clip.length), policyStore[name]);
    });
    wrap.append(span, input, out);
    parent.appendChild(wrap);
}

function buildEditor(name) {
    const row = gestRows[name];
    if (!row) return;
    const clip = clipStore[name];
    if (!clip) { row.body.innerHTML = '<span class="ghint">no retained clip — re-record to edit</span>'; return; }
    detachEditor();
    row.editBtn.classList.add('open');
    const v = bro.gesture.inspect(name);
    const ed = { name, clip, analysis: bro.sense.analyze(clip), v, gain: 1,
                 sel: { a: 0, b: clip.length }, canvas: null, info: null };
    currentEd = ed;

    const body = row.body;
    body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'gwave';
    body.appendChild(canvas);
    ed.canvas = canvas;

    const info = document.createElement('div');
    info.className = 'ginfo';
    body.appendChild(info);
    ed.info = info;

    const acts = document.createElement('div');
    acts.className = 'gacts';
    acts.appendChild(mkbtn('▶ Play', () =>
        playSamples(gainedSlice(clip, ed.gain, Math.round(ed.sel.a), Math.round(ed.sel.b)), GEST_RATE)));
    const rerec = mkbtn('● Re-record', () => startRecord(name, rerec));
    acts.appendChild(rerec);
    acts.appendChild(mkbtn('✂ Trim & re-enroll', () => {
        const a = Math.round(ed.sel.a), b = Math.round(ed.sel.b);
        if (b - a < GEST_RATE / 10) { status('selection too short (<0.1 s)', true); return; }
        reEnroll(name, gainedSlice(clip, ed.gain, a, b), policyStore[name]);
    }));
    body.appendChild(acts);

    const tol = document.createElement('div');
    tol.className = 'gtol';
    const pol = policyStore[name] || {};
    addGainSlider(tol, ed, name);
    if (v && v.kind === 'tone') {
        addSlider(tol, 'pitch ±', 'pitchTol', pol.pitchTol != null ? pol.pitchTol : 0.12, 0.02, 0.30, 0.01, name);
        addSlider(tol, 'steadiness', 'pitchStabilityTol', pol.pitchStabilityTol != null ? pol.pitchStabilityTol : 0.06, 0.01, 0.20, 0.005, name);
    } else {
        addSlider(tol, 'tempo ±', 'tempoTol', pol.tempoTol != null ? pol.tempoTol : 0.40, 0.05, 0.80, 0.05, name);
        addSlider(tol, 'shape ±', 'shapeTol', pol.shapeTol != null ? pol.shapeTol : 0.30, 0.10, 0.60, 0.05, name);
    }
    body.appendChild(tol);

    drawWave(ed); updateInfo(ed); attachTrim(ed);
}

function reEnroll(name, clip, policy) {
    withMutableGesture(() => {
        bro.gesture.enrollFromAudio(name, clip, policy || {});
        clipStore[name] = clip;
        if (policy) policyStore[name] = policy;
        const view = bro.gesture.inspect(name);
        status('re-enrolled "' + name + '" (' + gestureSummary(view) + ')');
        fusionRow(LL.active, 'info', 're-enrolled gesture "' + name + '" — ' + gestureSummary(view));
    });
}

// ── per-stream gesture sessions ───────────────────────────────────────────────

function onGestureFire(st, name, confidence, kind, span) {
    st.spots++;
    fusionRow(st, 'spot', 'gesture "' + name + '" (' + kind + ') @ conf ' + confidence.toFixed(3));
    logEvent(st, 'gesture', name, confidence, kind, null, span);
    if (st === LL.active) {
        flashGesture(name);
        $spotCount.textContent = String(st.spots);
    }
}

function startStreamGesture(st) {
    if (st.gestureListening) return;
    st.source.gesture.listen({
        onGesture: (name, confidence, kind, span) => onGestureFire(st, name, confidence, kind, span),
    });
    st.gestureListening = true;
}

function stopStreamGesture(st) {
    try { st.source.gesture.stop(); } catch (e) { /* not listening */ }
    st.gestureListening = false;
}

// Replay the master gesture vocabulary onto every added (handle) stream's own
// session — the mic stream IS the master, so it's skipped. Sessions must be
// stopped first (mutators share the matcher feed thread).
function mirrorGesturesToStreams() {
    for (const st of LL.streams) {
        if (!st.source.isHandle) continue;
        try { st.source.gesture.clear && st.source.gesture.clear(); } catch (e) { /* best-effort */ }
        for (const name of bro.gesture.templates()) {
            const clip = clipStore[name];
            if (clip) {
                try { st.source.gesture.enrollFromAudio(name, clip, policyStore[name] || {}); }
                catch (e) { /* skip a clip that won't enroll on this session */ }
            }
        }
    }
}

// Gesture mutators share the matcher's feed thread — bounce EVERY stream's
// session around any vocabulary change, then re-mirror + restart.
function withMutableGesture(fn) {
    const were = LL.streams.filter((st) => st.gestureListening);
    for (const st of were) stopStreamGesture(st);
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    renderGestureRows();
    mirrorGesturesToStreams();
    if (bro.gesture.templates().length)
        for (const st of LL.streams) startStreamGesture(st);
}

function enrollGesture(name, clip) {
    if (!LL.kwsReady) return;
    withMutableGesture(() => {
        bro.gesture.enrollFromAudio(name, clip, policyStore[name] || {});
        clipStore[name] = clip;
        const v = bro.gesture.inspect(name);
        status('enrolled gesture "' + name + '" (' + gestureSummary(v) + ')');
        fusionRow(LL.active, 'info', 'enrolled gesture "' + name + '" — ' + gestureSummary(v) +
            ' (' + (clip.length / bro.gesture.sampleRate()).toFixed(1) + ' s clip)');
    });
}

function enrollGestureFromTimeline(name, clip) {
    openEditor = name;
    enrollGesture(name, clip);
}

// ● Record: capture raw (no-AGC) mic PCM at the spotter rate via bro.mic.
let recChunks = [];
let recordTarget = null;
let recBtn = null;

function startRecord(target, btn) {
    if (!LL.kwsReady) return;
    if (recording) { stopRecord(); return; }
    recChunks = [];
    try {
        bro.mic.start({
            chunkFrames: 160, targetRate: bro.kws.sampleRate(), agc: false, samples: true,
            onChunk: (c) => { if (c.samples) recChunks.push(c.samples.slice()); },
        });
    } catch (e) { status('mic: ' + (e.message || e), true); return; }
    recording = true;
    recordTarget = target || null;
    recBtn = btn || $record;
    recBtn.textContent = '■ Stop';
    recBtn.classList.add('rec');
    status(recordTarget
        ? 'recording — re-perform "' + recordTarget + '", then Stop'
        : 'recording — perform the gesture (clicks, taps, a whistle), then Stop');
}

function stopRecord() {
    bro.mic.stop();
    recording = false;
    const target = recordTarget; recordTarget = null;
    const btn = recBtn; recBtn = null;
    if (btn) { btn.textContent = btn === $record ? '● Record' : '● Re-record'; btn.classList.remove('rec'); }
    let n = 0;
    for (const c of recChunks) n += c.length;
    if (n < bro.kws.sampleRate() / 10) { status('recording too short, discarded', true); recChunks = []; return; }
    const clip = new Float32Array(n);
    let o = 0;
    for (const c of recChunks) { clip.set(c, o); o += c.length; }
    recChunks = [];
    if (target) {
        reEnroll(target, clip, policyStore[target]);
    } else {
        enrollGesture($phrase.value.trim() || ('gesture-' + (++LL.gestureN)), clip);
        $phrase.value = '';
    }
}

function toggleRecord() { startRecord(null, $record); }

    Object.assign(LL, {
        enrollGesture, enrollGestureFromTimeline, renderGestureRows, withMutableGesture,
        startStreamGesture, stopStreamGesture, mirrorGesturesToStreams, gestureSummary,
        buildEditor, gainedSlice, clipStore, policyStore, gestRows, flashGesture,
        startRecord, stopRecord, toggleRecord,
    });
