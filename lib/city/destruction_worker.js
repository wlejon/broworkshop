// lib/city/destruction_worker.js — the city's destruction stepped off the page
// (destruction_sim.js in a Worker): the page asks for the steps to a tick, the
// worker takes them and answers with the snapshot after, and the page draws
// the last it has without waiting. An app's worker script imports its site and
// calls serveDestruction(site):
//
//   import { SITE } from "./site.js";
//   import { serveDestruction } from "/lib/city/destruction_worker.js";
//   serveDestruction(SITE);
//
// message in:  { init: { sources, dir, mounts, maxBodies } }   (the city from the
//              cache the page grew: cache.js growInWorker's message), then
//              { toTick, fires, watch, maxSteps?, hash? }
// message out: { ready, ms } or { error }, then a snapshot per step request

import { loadOrGenerateCity } from "./cache.js";
import { createCitySim, snapshotTransfer, warmUp } from "./destruction_sim.js";

// (A worker has performance, not the page's perf.)
globalThis.perf ??= performance;

export function serveDestruction(site) {
    let host = null;
    self.onmessage = (ev) => {
        const m = ev.data;
        try {
            if (m.init) {
                const t0 = performance.now();
                const { sources, dir, mounts, maxBodies } = m.init;
                const { city } = loadOrGenerateCity(site, { sources, dir, mounts });
                host = createCitySim(city, { maxBodies });
                self.postMessage({ ready: true, ms: performance.now() - t0 });
                // (Then compiled by a collapse thrown away: requests wait behind it.)
                const t1 = performance.now();
                warmUp(city);
                console.log(`destruction worker: warm in ${(performance.now() - t1).toFixed(0)} ms`);
                return;
            }
            const t0 = performance.now();
            const snap = host.advance(m.toTick, m.fires, m.watch, { maxSteps: m.maxSteps ?? 8, hash: m.hash });
            snap.ms = performance.now() - t0;
            self.postMessage(snap, snapshotTransfer(snap));
        } catch (e) {
            self.postMessage({ error: `${e.message}\n${e.stack ?? ''}` });
        }
    };
}
