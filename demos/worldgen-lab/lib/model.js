// ═══ checkpoint load + availability ══════════════════════════════════════════
import { $, state, status, emit } from "/app/lib/core.js";
import { pExists, _os, remember, recall } from "/app/lib/helpers.js";

export function setBadge(text, bad) {
    const b = $('#backend');
    if (!b) return;
    b.textContent = text;
    b.classList.toggle('err', !!bad);
}

// A converted checkpoint is a directory of config.json + the three safetensors +
// synthetic_map_stats.json. Probe a sensible default for this machine on first run.
export function defaultDir(htmlDefault) {
    let home = ''; try { home = _os && _os.homedir(); } catch (e) {}
    const cands = [
        recall('worldgen-lab.dir'),
        htmlDefault,
        home && home + '/projects/brodiffusion/weights/terrain-diffusion-30m-bro',
    ].filter(Boolean);
    for (const c of cands) if (pExists(c + '/config.json')) return c;
    return recall('worldgen-lab.dir') || htmlDefault;
}

// Load a checkpoint at the current seed asynchronously; the model loads on a
// background thread (~2 s) so the frame loop keeps running. Seed is fixed at
// load, so a reseed reloads. `then` fires once the world is live.
export function loadWorld(dir, seed, then) {
    dir = (dir || '').replace(/[\\\/]+$/, '');
    state.dir = dir;
    state.world = null;
    emit('world', null);                       // let probes clear
    if (bro.worldgen && bro.worldgen.available === false) {
        setBadge('bro.worldgen unavailable — build with BRO_WITH_DIFFUSION', true);
        return;
    }
    if (!pExists(dir + '/config.json')) { setBadge('no config.json in ' + dir, true); return; }
    if (state.loading) return;
    state.loading = true;
    setBadge('loading checkpoint… (~2 s)');
    try {
        bro.worldgen.init();
        bro.worldgen.loadWorld(dir, {
            seed,
            onReady: (w) => {
                state.loading = false;
                state.world = w;
                state.seed = seed;
                remember('worldgen-lab.dir', dir);
                setBadge('ready · seed ' + seed + ' · ' + w.cellSize + ' m/cell');
                emit('world', w);
            },
            onError: (m) => {
                state.loading = false;
                setBadge('load failed: ' + m, true);
            },
        });
    } catch (e) {
        state.loading = false;
        setBadge('load failed: ' + e.message, true);
    }
}

// Availability line for the very first frame, before anyone presses Load.
export function availabilityHint() {
    if (!window.bro || !bro.worldgen || bro.worldgen.available === false)
        return 'bro.worldgen is not available in this build — needs BRO_WITH_DIFFUSION';
    return 'press Load to read the checkpoint (~2 s), then aim on the map and Generate';
}
