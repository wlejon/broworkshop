// demos/planet/views.js — canonical view ladder and look/A/B runner for Planet.
//
// Usage (from repo root):
//   LOOK_SET=baseline bro-headless --grant declared,files,env demos/planet demos/planet/views.js
//   LOOK_SET=candidate LOOK_COMPARE=baseline,candidate bro-headless --grant declared,files,env demos/planet demos/planet/views.js
//   LOOK_VIEWS=coast,river LOOK_QUICK=1 bro-headless --grant declared,files,env demos/planet demos/planet/views.js
//
// Environment variables (`LOOK_*` with `--grant env`, or `BRO_LOOK_*` without):
//   LOOK_OUT=tests/out/look/planet   Output directory root
//   LOOK_SET=<name>                  Capture view set into <LOOK_OUT>/<name> (default: 'current')
//   LOOK_VIEWS=v1,v2                 Comma-separated subset of view names
//   LOOK_QUICK=1                     Quick subset (orbit, coast, river) with shorter settle/timing
//   LOOK_COMPARE=setA,setB           Compare two captured sets in <LOOK_OUT>/<setA> and <LOOK_OUT>/<setB>
//   LOOK_AB=1                        Run an in-process A/B timing check on the selected views

import { captureViews, compareLookSets, abMeasure } from "/lib/kit/look.js";
import { QUICK } from "/lib/kit/test.js";

function env(k) {
    try {
        const p = globalThis.process || require('process');
        const e = (p && p.env) || {};
        return e[k] || e['BRO_' + k] || '';
    } catch (_) {
        return '';
    }
}

function arg(name) {
    try {
        const p = globalThis.process || require('process');
        const argv = (p && p.argv) || [];
        const prefix = `--${name}=`;
        for (let i = 0; i < argv.length; i++) {
            const a = String(argv[i]);
            if (a === `--${name}`) return '1';
            if (a.startsWith(prefix)) return a.slice(prefix.length);
        }
    } catch (_) {}
    return '';
}

/**
 * Canonical planet views spanning scales, biomes, water, clouds, and sun angles.
 * Coordinates: `lat`, `lon` in radians; `alt` in metres above surface/sea;
 * `pitch`, `heading` in degrees; `hour` in 0..24 solar time.
 */
export const PLANET_VIEWS = [
    {
        name: 'orbit',
        description: 'Full-globe orbital overview with continental drainage, clouds, and limb atmosphere',
        lat: 0.45, lon: 0.30, alt: 1.8e7, pitch: -90, heading: 0, hour: 12.0,
        crops: [
            { name: 'center', x: 760, y: 340, w: 400, h: 400 },
            { name: 'limb',   x: 380, y: 200, w: 320, h: 320 },
        ],
    },
    {
        name: 'coast',
        description: 'Coastal headland, surf zone, and river mouth looking across a bay',
        lat: 0.448, lon: 0.295, alt: 420, pitch: -14, heading: 35, hour: 13.5,
        crops: [
            { name: 'horizon', x: 640, y: 200, w: 640, h: 240 },
            { name: 'shore',   x: 560, y: 520, w: 640, h: 360 },
        ],
    },
    {
        name: 'alpine',
        description: 'High alpine ridges, snowline transitions, and steep valley shadows',
        lat: 0.515, lon: 0.345, alt: 2600, pitch: -12, heading: 110, hour: 10.5,
        crops: [
            { name: 'peaks',  x: 560, y: 220, w: 800, h: 300 },
            { name: 'slopes', x: 560, y: 540, w: 800, h: 360 },
        ],
    },
    {
        name: 'river',
        description: 'Carved river valley with meanders, banks, and screen-space water reflections',
        lat: 0.452, lon: 0.302, alt: 280, pitch: -16, heading: 165, hour: 14.0,
        crops: [
            { name: 'channel', x: 600, y: 480, w: 720, h: 420 },
            { name: 'banks',   x: 480, y: 300, w: 640, h: 280 },
        ],
    },
    {
        name: 'forest',
        description: 'Low-altitude view over wooded hills and grass clearings',
        lat: 0.458, lon: 0.308, alt: 95, pitch: -10, heading: 60, hour: 11.2,
        crops: [
            { name: 'canopy', x: 560, y: 420, w: 800, h: 420 },
        ],
    },
    {
        name: 'clouds',
        description: 'Cumulus cloud deck seen from above the cloud base with ground shadows below',
        lat: 0.450, lon: 0.300, alt: 2200, pitch: -18, heading: 0, hour: 12.5,
        crops: [
            { name: 'deck',    x: 480, y: 240, w: 960, h: 360 },
            { name: 'shadows', x: 560, y: 620, w: 800, h: 320 },
        ],
    },
    {
        name: 'dusk',
        description: 'Low golden-hour sun grazing ridges with long horizon shadows and warm scatter',
        lat: 0.465, lon: 0.312, alt: 850, pitch: -9, heading: 255, hour: 17.4,
        crops: [
            { name: 'glint',  x: 560, y: 180, w: 800, h: 320 },
            { name: 'relief', x: 560, y: 520, w: 800, h: 360 },
        ],
    },
    {
        name: 'shallows',
        description: 'Shallow coastal shelf color, wave spectrum, and underwater drainage floor',
        lat: 0.442, lon: 0.288, alt: 160, pitch: -28, heading: 200, hour: 12.8,
        crops: [
            { name: 'water', x: 560, y: 420, w: 800, h: 460 },
        ],
    },
];

export const QUICK_VIEW_NAMES = ['orbit', 'coast', 'river'];

export function applyPlanetView(view) {
    if (typeof view.setup === 'function') view.setup(view);
    const p = globalThis.planet;
    if (!p) throw new Error('views.js: globalThis.planet is not initialized');
    for (const k of ['lat', 'lon', 'alt', 'pitch', 'heading']) {
        if (view[k] != null) p.cam[k] = view[k];
    }
    if (view.hour != null && typeof p.setHour === 'function') {
        p.setHour(view.hour);
    } else if (typeof p.setHour === 'function') {
        p.setHour(12);
    }
    if (typeof p.frame === 'function') p.frame();
}

export function settlePlanetView(view, options = {}) {
    const maxFrames = view.settleFrames ?? options.settleFrames ?? 900;
    const held = view.held ?? options.held ?? false;
    if (typeof perf !== 'undefined' && typeof perf.settle === 'function') {
        return perf.settle({ maxFrames, held });
    }
    for (let i = 0, quiet = 0; i < maxFrames && quiet < 8; i++) {
        advanceTime(16);
        flush();
        quiet = i >= 4 && planet.cache.pending === 0 ? quiet + 1 : 0;
    }
    return { settled: planet.cache.pending === 0 };
}

export function runPlanetLook(opts = {}) {
    const outDir = opts.outDir || arg('out') || env('LOOK_OUT') || 'tests/out/look/planet';
    const setOverride = opts.setName || arg('set') || env('LOOK_SET');
    const setName = setOverride || 'current';
    const compareSpec = opts.compare || arg('compare') || env('LOOK_COMPARE');
    const rawViews = arg('views') || env('LOOK_VIEWS');
    const viewsFilter = opts.views || (rawViews ? rawViews.split(',').map((s) => s.trim()).filter(Boolean) : null);
    const isQuick = opts.quick ?? (QUICK || /^(1|true|yes)$/i.test(arg('quick') || env('LOOK_QUICK')));
    const rawAb = arg('ab') || env('LOOK_AB');
    const doAb = opts.ab ?? !!rawAb;

    const only = viewsFilter || (isQuick ? QUICK_VIEW_NAMES : null);
    const settleFrames = isQuick ? 400 : 900;
    const timingFrames = isQuick ? 4 : 8;

    let manifest = null;
    if (opts.capture !== false && (!compareSpec || setOverride)) {
        manifest = captureViews(PLANET_VIEWS, {
            outDir,
            setName,
            only,
            settleFrames,
            timingFrames,
            held: false,
            applyView: applyPlanetView,
            settle: (v) => settlePlanetView(v, { settleFrames, held: false }),
        });
    }

    let comparison = null;
    if (compareSpec) {
        const [a, b] = Array.isArray(compareSpec) ? compareSpec : String(compareSpec).split(',').map((s) => s.trim());
        if (!a || !b) throw new Error('views.js: LOOK_COMPARE must be "setA,setB"');
        const dirA = a.includes('/') ? a : `${outDir}/${a}`;
        const dirB = b.includes('/') ? b : `${outDir}/${b}`;
        const diffDir = `${outDir}/diff-${a}-vs-${b}`;
        comparison = compareLookSets(dirA, dirB, diffDir);
    }

    let ab = null;
    if (doAb) {
        const targetName = (only && only[0]) || 'coast';
        const view = PLANET_VIEWS.find((v) => v.name === targetName) || PLANET_VIEWS[1];
        applyPlanetView(view);
        settlePlanetView(view, { settleFrames, held: false });
        const hasShaderDir = typeof rawAb === 'string' && rawAb && !/^(1|true|yes)$/i.test(rawAb);
        if (hasShaderDir && typeof perf !== 'undefined' && typeof perf.loadShaderSet === 'function') {
            perf.loadShaderSet(rawAb);
        }
        const setupA = opts.setupA || (hasShaderDir
            ? () => { if (typeof perf !== 'undefined' && typeof perf.useShaderSet === 'function') perf.useShaderSet('a'); }
            : () => {});
        const setupB = opts.setupB || (hasShaderDir
            ? () => { if (typeof perf !== 'undefined' && typeof perf.useShaderSet === 'function') perf.useShaderSet('b'); }
            : () => {});
        ab = abMeasure(
            setupA,
            setupB,
            {
                warmup: isQuick ? 2 : 4,
                rounds: isQuick ? 6 : 16,
                framesPerRound: 2,
                labelA: opts.labelA || 'A',
                labelB: opts.labelB || (hasShaderDir ? rawAb : 'B'),
            }
        );
    }

    return { manifest, comparison, ab };
}

if (!globalThis.__PLANET_VIEWS_NO_AUTORUN) {
    runPlanetLook();
}
