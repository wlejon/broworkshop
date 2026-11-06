// demos/planet/views.js — canonical view ladder and look/A/B runner for
// Planet. Importing it only exports; look.js runs it.
//
// Usage (from repo root):
//   LOOK_SET=baseline bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//   LOOK_SET=candidate LOOK_COMPARE=baseline,candidate bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//   LOOK_VIEWS=river,m4-dusk LOOK_QUICK=1 bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//
// Environment variables (`LOOK_*` with `--grant env`, or `BRO_LOOK_*` without):
//   LOOK_OUT=tests/out/look/planet   Output directory root
//   LOOK_SET=<name>                  Capture view set into <LOOK_OUT>/<name> (default: 'current')
//   LOOK_VIEWS=v1,v2                 Comma-separated subset of view names
//   LOOK_QUICK=1                     Quick subset (orbit, river, m4-dusk) with shorter settle/timing
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
// The sites the look rounds were judged at (seed 7): a river in hill
// country, the M4 river (where the white rivers showed at dusk), a lake and
// the sea. `hour` is a number, 'noon' (the sun highest over the site) or
// 'low' (8 degrees up after noon, the camera turned to face it, for glints).
const SITES = {
    river: { lat: 0.4488, lon: -3.0869, heading: 0 },
    m4: { lat: 0.218244, lon: 0.48744, heading: -36.5 },
    lake: { lat: 0.30386, lon: -3.01224, heading: 0 },
    sea: { lat: 0.46627, lon: -3.05927, heading: 0 },
};
const at = (site, rest) => ({ ...SITES[site], ...rest });
const WIDE = [{ name: 'middle', x: 560, y: 380, w: 800, h: 400 }];
const LOW = [{ name: 'near', x: 560, y: 560, w: 800, h: 400 }, { name: 'far', x: 560, y: 200, w: 800, h: 300 }];

export const PLANET_VIEWS = [
    { name: 'orbit', description: 'the globe from 18000 km', lat: 0.45, lon: 0.30, alt: 1.8e7, pitch: -90, heading: 0, hour: 12, crops: WIDE },
    { name: 'continent', description: 'the river site from 800 km', ...at('river', { alt: 8e5, pitch: -27, hour: 'noon' }), crops: WIDE },
    { name: 'hills', description: 'the M4 hill country from 40 km', ...at('m4', { alt: 4e4, pitch: -45, hour: 'noon' }), crops: WIDE },
    { name: 'river-high', description: 'the river and its valley from 1.5 km', ...at('river', { alt: 1500, pitch: -22, hour: 'noon' }), crops: LOW },
    { name: 'river', description: 'the river from 300 m at noon', ...at('river', { alt: 300, pitch: -20, hour: 'noon' }), crops: LOW },
    { name: 'river-near', description: 'the river bank from 50 m', ...at('river', { alt: 50, pitch: -12, hour: 'noon' }), crops: LOW },
    { name: 'm4-dusk', description: 'the M4 river from 300 m at dusk (the white-river view)', ...at('m4', { alt: 300, pitch: -20, hour: 17.88 }), crops: LOW },
    { name: 'lake', description: 'the lake from 300 m', ...at('lake', { alt: 300, pitch: -20, hour: 'noon' }), crops: LOW },
    { name: 'sea-glint', description: 'the sea from 300 m facing a low sun', ...at('sea', { alt: 300, pitch: -20, hour: 'low' }), crops: LOW },
    { name: 'ground', description: 'the river site from eye height', ...at('river', { alt: 2, pitch: -6, hour: 'noon' }), crops: LOW },
];

export const QUICK_VIEW_NAMES = ['orbit', 'river', 'm4-dusk'];

// The sun's model (app.js setHour): NOON turned about the y axis by the hour.
const NOON = [-0.55, -0.35, -0.75];
const toSun = (hour) => {
    const a = (hour - 12) / 24 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const d = [NOON[0] * c + NOON[2] * s, NOON[1], -NOON[0] * s + NOON[2] * c];
    const l = Math.hypot(...d);
    return d.map((x) => -x / l);
};
const frameAt = (lat, lon) => {
    const up = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const e = [up[2], 0, -up[0]], el = Math.hypot(...e);
    const east = e.map((x) => x / el);
    const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    return { up, east, north };
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// The hour of 'noon' or 'low' over a site.
function siteHour(lat, lon, which) {
    const up = frameAt(lat, lon).up;
    const el = [];
    for (let h = 0; h < 24; h += 0.02) el.push([h, dot(toSun(h), up)]);
    let top = 0;
    for (let k = 1; k < el.length; k++) if (el[k][1] > el[top][1]) top = k;
    if (which === 'noon') return el[top][0];
    const target = Math.sin(8 * Math.PI / 180);
    for (let k = 0; k < el.length; k++) {
        const x = el[(top + k) % el.length];
        if (x[1] <= target) return x[0];
    }
    return 12;
}
const headingTo = (lat, lon, hour) => {
    const f = frameAt(lat, lon), t = toSun(hour);
    return Math.atan2(dot(t, f.east), dot(t, f.north)) * 180 / Math.PI;
};

export function applyPlanetView(view) {
    if (typeof view.setup === 'function') view.setup(view);
    const p = globalThis.planet;
    if (!p) throw new Error('views.js: globalThis.planet is not initialized');
    const hour = typeof view.hour === 'number' ? view.hour : siteHour(view.lat, view.lon, view.hour ?? 'noon');
    const heading = view.hour === 'low' ? headingTo(view.lat, view.lon, hour) : view.heading;
    for (const k of ['lat', 'lon', 'alt', 'pitch']) {
        if (view[k] != null) p.cam[k] = view[k];
    }
    if (heading != null) p.cam.heading = heading;
    p.setHour(hour);
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
        const targetName = (only && only[0]) || 'river';
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

