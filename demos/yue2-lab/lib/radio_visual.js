// The radio's visualizer: what plays, drawn on the Now playing card.
//
// The engine's AnalyserNode (source 0) reads the live output mix and runs
// the FFT on demand (docs/audio-api.js), so this file only draws. Four
// styles: bars (a log-frequency spectrum with falling peaks), scope (the
// waveform, triggered on a rising zero crossing, with a fading trail),
// waterfall (a spectrogram scrolling right to left) and ring (the spectrum
// around a circle that swells with the bass, each bass hit rippling out).
// A switch turns it off; the
// style and the switch are remembered.

import { h } from "/lib/kit/dom.js";
import { audioContext } from "/lib/kit/audio.js";
import { prefStore } from "/lib/kit/prefs.js";

export const VIS_STYLES = ['bars', 'scope', 'waterfall', 'ring'];
const MIN_HZ = 30, MAX_HZ = 16000, MIN_DB = -95, MAX_DB = -20;

// Magma-like ramp for the waterfall: the card's surface → purple → orange →
// pale yellow, so silence reads as the card.
const RAMP = [[16, 20, 28], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
const LUT = (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const x = i / 255 * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(x)), f = x - k;
        for (let c = 0; c < 3; c++) lut[i * 3 + c] = RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * f;
    }
    return lut;
})();

const level = (db) => Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));

/**
 * The visualizer into `canvasHost` (a <canvas>) with its controls in
 * `ctlHost`. Handle: tick(dt) once a frame (draws when on and laid out),
 * get on / style.
 */
export function radioVisual(canvas, ctlHost) {
    const prefs = prefStore('yue2-lab.visual', { on: true, style: 'bars' });
    if (!VIS_STYLES.includes(prefs.data.style)) prefs.data.style = 'bars';
    let an = null, freq = null, wave = null;
    let bands = new Float32Array(0), peaks = new Float32Array(0), peakHold = new Float32Array(0);
    let g = null, W = 0, H = 0, wf = null, wfCarry = 0;
    let ripples = [], bassMean = 0, sinceRipple = 0;

    const toggle = h('input#radio-vis-on', { type: 'checkbox' });
    toggle.checked = !!prefs.data.on;
    const styleBtns = VIS_STYLES.map((s) => h('button.radio-vis-style', { 'data-style': s, title: s }, s));
    const styles = h('span.radio-vis-styles', null, ...styleBtns);
    ctlHost.append(styles, h('label.radio-vis-switch', { title: 'show what plays' }, toggle, h('span', null, 'visuals')));

    function sync() {
        canvas.hidden = !prefs.data.on;
        styles.hidden = !prefs.data.on;
        for (const b of styleBtns) b.classList.toggle('on', b.dataset.style === prefs.data.style);
    }
    toggle.addEventListener('change', () => { prefs.set({ on: toggle.checked }); sync(); });
    for (const b of styleBtns) b.addEventListener('click', () => { prefs.set({ style: b.dataset.style }); wf = null; sync(); });
    sync();

    function analyser() {
        if (an) return an;
        try {
            an = audioContext().createAnalyser();
            an.fftSize = 4096;
            an.smoothingTimeConstant = 0.6;
            freq = new Float32Array(an.frequencyBinCount);
            wave = new Float32Array(an.fftSize);
        } catch (e) { an = null; }
        return an;
    }

    // Log-spaced bands over MIN_HZ..MAX_HZ, each the loudest bin it covers
    // (the nearest bin when it covers none), as 0..1.
    function readBands(n) {
        if (bands.length !== n) { bands = new Float32Array(n); peaks = new Float32Array(n); peakHold = new Float32Array(n); }
        an.getFloatFrequencyData(freq);
        const binHz = audioContext().sampleRate / an.fftSize, nb = freq.length;
        for (let i = 0; i < n; i++) {
            const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / n), f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / n);
            let b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
            b0 = Math.min(nb - 1, b0); b1 = Math.min(nb, b1);
            let m = -Infinity;
            for (let b = b0; b < b1; b++) if (freq[b] > m) m = freq[b];
            bands[i] = level(m);
        }
        return bands;
    }

    function size() {
        const r = canvas.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
        if (w !== W || hh !== H || !g) {
            canvas.width = W = w; canvas.height = H = hh;
            g = canvas.getContext('2d');
            wf = null;
        }
        return true;
    }

    function drawBars(dt) {
        const n = Math.max(24, Math.min(96, Math.floor(W / 14)));
        const v = readBands(n);
        g.clearRect(0, 0, W, H);
        const gap = Math.max(1, Math.round(W / n * 0.22)), bw = W / n - gap;
        const grad = g.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, '#2c5fb8'); grad.addColorStop(0.55, '#5c9dff'); grad.addColorStop(1, '#7fe6a8');
        g.fillStyle = grad;
        for (let i = 0; i < n; i++) {
            const bh = Math.max(2, Math.pow(v[i], 1.4) * (H - 4));
            g.fillRect(i * (bw + gap) + gap / 2, H - bh, bw, bh);
            // Peaks hold a moment, then fall.
            if (bh >= peaks[i]) { peaks[i] = bh; peakHold[i] = 0.35; }
            else if ((peakHold[i] -= dt) <= 0) peaks[i] = Math.max(bh, peaks[i] - H * 0.9 * dt);
        }
        g.fillStyle = 'rgba(234, 255, 242, 0.85)';
        for (let i = 0; i < n; i++) g.fillRect(i * (bw + gap) + gap / 2, H - peaks[i] - 3, bw, 2);
    }

    function drawScope() {
        an.getFloatTimeDomainData(wave);
        g.fillStyle = 'rgba(16, 20, 28, 0.38)';   // the trail fades into the card
        g.fillRect(0, 0, W, H);
        const span = 2048;
        let t0 = 0;
        for (let i = 1; i < wave.length - span; i++) if (wave[i - 1] < 0 && wave[i] >= 0) { t0 = i; break; }
        let peak = 0.05;
        for (let i = 0; i < span; i++) peak = Math.max(peak, Math.abs(wave[t0 + i]));
        const gain = Math.min(6, 0.8 / peak) * H / 2;
        g.lineWidth = Math.max(1.5, H / 70);
        g.lineJoin = 'round';
        g.strokeStyle = '#5c9dff';
        g.beginPath();
        for (let x = 0; x < W; x++) {
            const y = H / 2 - wave[t0 + Math.floor(x / W * span)] * gain;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.strokeStyle = 'rgba(127, 230, 168, 0.25)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    }

    // The image lives in JS; each frame shifts it left by the columns
    // elapsed (one copyWithin: a row's first pixels land in the last columns
    // of the row before, which the new columns then overwrite) and draws the
    // new columns at the right edge, low frequencies at the bottom.
    function drawWaterfall(dt) {
        if (!wf || wf.width !== W || wf.height !== H) {
            wf = g.createImageData(W, H);
            for (let i = 0; i < wf.data.length; i += 4) { wf.data[i] = LUT[0]; wf.data[i + 1] = LUT[1]; wf.data[i + 2] = LUT[2]; wf.data[i + 3] = 255; }
            wfCarry = 0;
        }
        wfCarry += dt * 60 * (window.devicePixelRatio || 1);
        const k = Math.min(W, Math.floor(wfCarry));
        if (k > 0) {
            wfCarry -= k;
            const v = readBands(H);
            const d = wf.data;
            d.copyWithin(0, 4 * k);
            for (let y = 0; y < H; y++) {
                const c = Math.round(Math.pow(v[H - 1 - y], 1.2) * 255) * 3;
                for (let x = W - k; x < W; x++) {
                    const o = (y * W + x) * 4;
                    d[o] = LUT[c]; d[o + 1] = LUT[c + 1]; d[o + 2] = LUT[c + 2]; d[o + 3] = 255;
                }
            }
        }
        g.putImageData(wf, 0, 0);
    }

    // A bass hit (the low bands well over their running mean) sends a ripple
    // out across the strip.
    function drawRing(dt) {
        const n = 72;
        const v = readBands(n);
        g.clearRect(0, 0, W, H);
        let bass = 0;
        for (let i = 0; i < 8; i++) bass += v[i];
        bass /= 8;
        bassMean += (bass - bassMean) * Math.min(1, dt * 3);
        sinceRipple += dt;
        if (bass > 0.25 && bass > bassMean * 1.12 && sinceRipple > 0.18) { ripples.push({ r: 0, a: Math.min(1, bass) }); sinceRipple = 0; }
        const cx = W / 2, cy = H / 2, R = H * (0.2 + 0.06 * bass), reach = H * 0.27;
        g.lineWidth = Math.max(1.5, H / 90);
        for (const p of ripples) {
            p.r += dt * W * 0.32;
            const fade = Math.max(0, 1 - p.r / (W * 0.5));
            g.strokeStyle = 'rgba(92, 157, 255, ' + (p.a * fade * 0.55).toFixed(3) + ')';
            g.beginPath(); g.ellipse(cx, cy, R + p.r, (R + p.r) * 0.42, 0, 0, Math.PI * 2); g.stroke();
        }
        ripples = ripples.filter((p) => p.r < W * 0.5);
        const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
        glow.addColorStop(0, 'rgba(92, 157, 255, ' + (0.12 + 0.35 * bass).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(92, 157, 255, 0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
        g.lineCap = 'round';
        g.lineWidth = Math.max(2, Math.min(W, H) / 70);
        // Mirrored: low frequencies at the top, high at the bottom, both sides.
        for (let i = 0; i < n; i++) {
            const len = 2 + Math.pow(v[i], 1.3) * reach;
            g.strokeStyle = 'hsl(' + (215 - i / n * 75).toFixed(0) + ', 85%, ' + (55 + v[i] * 20).toFixed(0) + '%)';
            for (const side of [1, -1]) {
                const a = -Math.PI / 2 + side * (i + 0.5) / n * Math.PI;
                const c = Math.cos(a), s = Math.sin(a);
                g.beginPath();
                g.moveTo(cx + c * R, cy + s * R);
                g.lineTo(cx + c * (R + len), cy + s * (R + len));
                g.stroke();
            }
        }
        g.strokeStyle = 'rgba(207, 224, 255, 0.5)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, R - 3, 0, Math.PI * 2); g.stroke();
    }

    return {
        tick(dt) {
            if (!prefs.data.on || !size() || !analyser()) return;
            const s = prefs.data.style;
            if (s === 'scope') drawScope();
            else if (s === 'waterfall') drawWaterfall(dt);
            else if (s === 'ring') drawRing(dt);
            else drawBars(dt);
        },
        get on() { return !!prefs.data.on; },
        get style() { return prefs.data.style; },
    };
}
