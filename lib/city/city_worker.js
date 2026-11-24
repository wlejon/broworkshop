// Grows a city off the main thread: generates it (or finds it in the cache),
// leaving it in the cache for the page to read back (cache.js growInWorker).
// The page waits on the reply, so a cold start or a lib/city edit costs it
// the wait, not a frozen window. An app's worker script imports its site and
// calls serveGrow(site):
//
//   import { SITE } from "./site.js";
//   import { serveGrow } from "/lib/city/city_worker.js";
//   serveGrow(SITE);
//
// message in:  { sources, dir, mounts }   (dir: the cache dir; mounts: each source mount's real path)
// message out: { ok, hit, ms } or { ok: false, error }

import { loadOrGenerateCity, cachedCity } from "./cache.js";

// (A worker has performance, not the page's perf; generation times its stages with it.)
globalThis.perf ??= performance;

export function serveGrow(site) {
    self.onmessage = (ev) => {
        const { sources, dir, mounts } = ev.data;
        try {
            const t0 = perf.now();
            if (cachedCity(site, { sources, dir, mounts })) { self.postMessage({ ok: true, hit: true, ms: perf.now() - t0 }); return; }
            const { hit } = loadOrGenerateCity(site, { sources, dir, mounts });
            self.postMessage({ ok: true, hit, ms: perf.now() - t0 });
        } catch (e) {
            self.postMessage({ ok: false, error: `${e.message}\n${e.stack ?? ''}` });
        }
    };
}
