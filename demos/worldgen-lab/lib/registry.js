// ═══ probe registry + tab host + generation tick ════════════════════════════
//
// A PROBE is one model seam. It registers a small lifecycle and the registry owns
// the rest: a tab per probe, one persistent mount each (built lazily, then shown/
// hidden so state survives a tab switch), and a single generation clock that keeps
// to the pipeline's "one request at a time" rule.
//
//   registerProbe({
//     id, name, blurb,
//     build(mount) -> handle    // build the DOM once into `mount`; return a handle
//     regen(handle)             // (re)generate against state.region — may be async
//     tick(handle, dt)          // optional: per-frame work (a live 3D preview)
//     onWorld(handle, world)    // optional: a checkpoint (re)loaded, or null cleared
//   })
//
// A probe never generates itself on a timer. It marks itself dirty (region moved,
// tab shown, world loaded) and the registry's tick() fires exactly one regen when
// the world is free — so two probes, or a fast drag, can never race the cache.

import { $, state, on, emit } from "/app/lib/core.js";
import { el } from "/app/lib/helpers.js";

export const PROBES = [];
export function registerProbe(def) { PROBES.push(def); }

let tabsEl = null, hostEl = null;
let active = null;

function regionKey() {
    const r = state.region;
    return state.seed + ':' + r.i + ':' + r.j + ':' + r.extent;
}

function ensureBuilt(p) {
    if (p._handle) return;
    const mount = el('div', 'probe-mount');
    mount.style.display = 'none';
    hostEl.appendChild(mount);
    p._mount = mount;
    p._handle = p.build(mount) || {};
    p._genKey = null;                          // nothing generated yet
    p._dirty = false;
}

export function activate(id) {
    const p = PROBES.find((x) => x.id === id);
    if (!p || p === active) return;
    ensureBuilt(p);
    if (active && active._mount) active._mount.style.display = 'none';
    active = p;
    p._mount.style.display = '';
    for (const t of tabsEl.children) t.classList.toggle('active', t.dataset.id === id);
    $('#probe-blurb').textContent = p.blurb || '';
    // Regenerate if this probe has never seen the current region.
    if (p._genKey !== regionKey()) p._dirty = true;
}

export function buildTabs(tabs, host) {
    tabsEl = tabs; hostEl = host;
    tabs.innerHTML = '';
    for (const p of PROBES) {
        const t = el('div', 'tab', p.name);
        t.dataset.id = p.id;
        t.onclick = () => activate(p.id);
        tabs.appendChild(t);
    }
    // A region move or a world (re)load makes every probe stale; the active one
    // regenerates now, the rest when next shown.
    on('region', () => { for (const p of PROBES) p._genKey = null; if (active) active._dirty = true; });
    on('world', (w) => {
        for (const p of PROBES) {
            p._genKey = null;
            if (p._handle && p.onWorld) p.onWorld(p._handle, w);
        }
        if (active) active._dirty = true;
    });
    if (PROBES.length) activate(PROBES[0].id);
}

// Called every frame from app.js. Runs the active probe's animation, then fires a
// single regen when one is due and the world is free.
export function tick(dt) {
    if (!active || !active._handle) return;
    if (active.tick) { try { active.tick(active._handle, dt); } catch (e) { console.error('tick', active.id, e); } }
    if (active._dirty && state.world && !state.world.generating) {
        active._dirty = false;
        active._genKey = regionKey();
        try { active.regen(active._handle); } catch (e) { console.error('regen', active.id, e); }
    }
}

// Force the active probe to regenerate (the Generate button, and a manual poke).
export function regenActive() { if (active) active._dirty = true; }
export function activeProbe() { return active; }
