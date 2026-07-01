// ui_registry.js — Declarative HUD panel registry. Each panel self-throttles
// and can opt into running only for specific state.mode values, so adding a
// new mode's HUD (fog toggle, tactic/window readout, belief overlay, ...)
// doesn't mean hand-editing a hardcoded per-panel block in loop.js every
// time — it's just another Panels.register call near the panel's own code.
export const Panels = {};
(function () {
    "use strict";

    var registry = [];

    // def: {
    //   id,                 // unique string (debugging only)
    //   update(state, dt),  // called when due
    //   throttleSec,        // seconds between updates; omit to run every frame
    //   modes,              // optional array of mode ids this panel applies to;
    //                       // omit to always run regardless of state.mode
    // }
    Panels.register = function (def) {
        if (!def || typeof def.update !== "function" || !def.id) {
            console.warn("Panels.register: invalid definition", def);
            return;
        }
        registry.push(def);
    };

    // Throttle accumulators live on `state` (state.__panelAccum), not on the
    // panel definitions — definitions are module-level singletons that
    // outlive any one match, while state is rebuilt every App.rebuild(). A
    // def-level accumulator would carry stale countdown progress across
    // rebuilds instead of restarting fresh with the new match, same as the
    // old per-state Accum fields (state.rosterAccum, etc.) this replaces.
    Panels.tick = function (state, dt) {
        if (!state.__panelAccum) state.__panelAccum = {};
        var accum = state.__panelAccum;
        for (var i = 0; i < registry.length; i++) {
            var p = registry[i];
            if (p.modes && state.mode !== undefined && p.modes.indexOf(state.mode) === -1) continue;
            if (p.throttleSec) {
                accum[p.id] = (accum[p.id] || 0) + dt;
                if (accum[p.id] < p.throttleSec) continue;
                accum[p.id] = 0;
            }
            p.update(state, dt);
        }
    };
})();
