// Frame-time budget, vsync defaults, and rolling percentile frame stats.

export const wallMs = typeof globalThis.perf?.now === 'function'
    ? () => globalThis.perf.now()
    : () => performance.now();

const WINDOW = 512;
const samples = new Float64Array(WINDOW);
const sorted = new Float64Array(WINDOW);
let cursor = 0;
let filled = 0;
let totalFrames = 0;
let over5msCount = 0;
let maxSpikeMs = 0;
let frameStart = 0;
let hasStart = false;
let initialized = false;

const snapshot = {
    fps: 0,
    meanMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxSpikeMs: 0,
    frameCount: 0,
    over5msCount: 0,
    vsync: false,
};

function resetWindow() {
    samples.fill(0);
    cursor = 0;
    filled = 0;
    totalFrames = 0;
    over5msCount = 0;
    maxSpikeMs = 0;
    hasStart = false;
}

export function initPerfDefaults() {
    if (initialized) return;
    initialized = true;
    try {
        bro.settings?.setDefault?.('graphics.vsync', false);
        bro.settings?.setDefault?.('graphics.maxFps', 0);
    } catch (_) {
        // Headless or settings API unavailable
    }
    resetWindow();
}

export function applyScenePerfBudget(scene, targetMs = 4.0) {
    if (!scene) return;
    try {
        scene.setFrameTarget?.(targetMs);
    } catch (_) {}
}

export function recordFrameMs(ms) {
    if (!(ms >= 0) || ms > 10000) return;
    samples[cursor] = ms;
    cursor = (cursor + 1) % WINDOW;
    if (filled < WINDOW) filled++;
    totalFrames++;
    if (ms > 5) over5msCount++;
    if (ms > maxSpikeMs) maxSpikeMs = ms;
}

export function beginPerfFrame() {
    frameStart = wallMs();
    hasStart = true;
}

export function endPerfFrame() {
    if (!hasStart) {
        beginPerfFrame();
        return;
    }
    hasStart = false;
    recordFrameMs(wallMs() - frameStart);
}

export function resetPerfStats() {
    resetWindow();
    snapshot.fps = 0;
    snapshot.meanMs = 0;
    snapshot.p50Ms = 0;
    snapshot.p95Ms = 0;
    snapshot.p99Ms = 0;
    snapshot.frameCount = 0;
    snapshot.over5msCount = 0;
    snapshot.maxSpikeMs = 0;
}

export function getPerfSnapshot() {
    if (filled === 0) {
        snapshot.fps = 0;
        snapshot.meanMs = 0;
        snapshot.p50Ms = 0;
        snapshot.p95Ms = 0;
        snapshot.p99Ms = 0;
        snapshot.maxSpikeMs = 0;
        snapshot.frameCount = 0;
        snapshot.over5msCount = 0;
    } else {
        let sum = 0;
        for (let i = 0; i < filled; i++) {
            sorted[i] = samples[i];
            sum += samples[i];
        }
        sorted.fill(Infinity, filled);
        sorted.sort();
        const last = filled - 1;
        const meanMs = sum / filled;
        snapshot.fps = meanMs > 1e-6 ? 1000 / meanMs : 9999;
        snapshot.meanMs = meanMs;
        snapshot.p50Ms = sorted[Math.min(last, Math.floor(0.50 * last))];
        snapshot.p95Ms = sorted[Math.min(last, Math.floor(0.95 * last))];
        snapshot.p99Ms = sorted[Math.min(last, Math.floor(0.99 * last))];
        snapshot.maxSpikeMs = maxSpikeMs;
        snapshot.frameCount = totalFrames;
        snapshot.over5msCount = over5msCount;
    }
    try {
        snapshot.vsync = !!bro.settings?.get?.('graphics.vsync');
    } catch (_) {}
    return snapshot;
}

export function toggleVsync() {
    try {
        const cur = !!bro.settings?.get?.('graphics.vsync');
        bro.settings?.set?.('graphics.vsync', !cur);
        return !cur;
    } catch (_) {
        return false;
    }
}
