// The view ladder's look/A/B runner for the planet: the active world's views
// (its `views`, worlds/<name>/), captured, compared and timed. Importing it
// only exports; look.js runs it.
//
// Usage (from repo root; --world=<name> after the script picks the world):
//   LOOK_SET=baseline bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//   LOOK_SET=candidate LOOK_COMPARE=baseline,candidate bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//   LOOK_VIEWS=river,m4-dusk LOOK_QUICK=1 bro-headless --grant declared,files,env demos/planet demos/planet/look.js
//
// Environment variables (`LOOK_*` with `--grant env`, or `BRO_LOOK_*` without):
//   LOOK_OUT=tests/out/look/planet/<world>   Output directory root
//   LOOK_SET=<name>                  Capture view set into <LOOK_OUT>/<name> (default: 'current')
//   LOOK_VIEWS=v1,v2                 Comma-separated subset of view names
//   LOOK_QUICK=1                     The world's quick subset (its quickViews) with shorter settle/timing
//   LOOK_COMPARE=setA,setB           Compare two captured sets in <LOOK_OUT>/<setA> and <LOOK_OUT>/<setB>
//   LOOK_AB=1                        Run an in-process A/B timing check on the selected views

import { captureViews, compareLookSets, abMeasure } from "/lib/kit/look.js";
import { QUICK } from "/lib/kit/test.js";
import { toSun } from "/app/core/hour.js";

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

// The active world's views (its `views` and `quickViews`, worlds/<name>/):
// each { name, description, lat, lon (radians), alt (metres above the
// surface), pitch, heading (degrees), hour, crops }, `hour` a number, 'noon'
// (the sun highest over the site), 'noon+h' (h hours after that; 'noon-h'
// before) or 'low' (8 degrees up after noon, the camera turned to face it,
// for glints).
const worldViews = () => globalThis.planet.world.views;
const quickViewNames = () => globalThis.planet.world.quickViews;

const frameAt = (lat, lon) => {
    const up = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const e = [up[2], 0, -up[0]], el = Math.hypot(...e);
    const east = e.map((x) => x / el);
    const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    return { up, east, north };
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// The hour of 'noon', 'noon+h' (h hours after it, or before for 'noon-h')
// or 'low' over a site.
function siteHour(lat, lon, which) {
    const after = /^noon([+-]\d+(?:\.\d+)?)$/.exec(which);
    if (after) return (siteHour(lat, lon, 'noon') + Number(after[1]) + 24) % 24;
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
    const outDir = opts.outDir || arg('out') || env('LOOK_OUT') || `tests/out/look/planet/${globalThis.planet.world.name}`;
    const PLANET_VIEWS = worldViews();
    const setOverride = opts.setName || arg('set') || env('LOOK_SET');
    const setName = setOverride || 'current';
    const compareSpec = opts.compare || arg('compare') || env('LOOK_COMPARE');
    const rawViews = arg('views') || env('LOOK_VIEWS');
    const viewsFilter = opts.views || (rawViews ? rawViews.split(',').map((s) => s.trim()).filter(Boolean) : null);
    const isQuick = opts.quick ?? (QUICK || /^(1|true|yes)$/i.test(arg('quick') || env('LOOK_QUICK')));
    const rawAb = arg('ab') || env('LOOK_AB');
    const doAb = opts.ab ?? !!rawAb;

    const only = viewsFilter || (isQuick ? quickViewNames() : null);
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
        // The first view picked, else the world's second quick view (its
        // first close one; the first is the globe).
        const targetName = (only && only[0]) || quickViewNames()[1];
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

