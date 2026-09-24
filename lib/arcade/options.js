// Arcade — a Settings screen of cycle-on-Enter rows backed by the save.
//
//   import { createOptions, sfxVolume } from "/lib/arcade/options.js";
//   const options = createOptions(api, [
//       sfxVolume(),
//       { key: "difficulty", action: "cycle-difficulty", values: [0, 1, 2],
//         label: (v) => ["Easy", "Normal", "Hard"][v], apply: (v) => { ... } },
//   ]);
//   init(api)                -> options.applyAll()
//   onEnterScreen("settings") -> options.render()
//   onMenuAction(action)     -> if (options.handle(action)) return null;
//
// HTML: <div class="menu-item" data-action="cycle-difficulty">Difficulty: <span id="opt-difficulty"></span></div>
// Each key needs a default in game.defaults.

/** Master SFX volume row: 0..100 % in steps of 10, applied to the sfx bus. */
export function sfxVolume() {
    return {
        key: "sfxVol",
        action: "cycle-sfx",
        values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        label: (v) => String(v),
        apply: (v, api) => api.audio.setSfxVol(v / 100),
    };
}

/** ON / OFF row. */
export function toggle(key, action, apply) {
    return { key, action, values: [true, false], label: (v) => (v ? "ON" : "OFF"), apply };
}

export function createOptions(api, defs) {
    const get = (d) => {
        const v = api.save.get(d.key);
        return v == null ? d.values[0] : v;
    };

    function render() {
        for (const d of defs) {
            const el = document.getElementById("opt-" + d.key);
            if (el) el.textContent = d.label ? d.label(get(d)) : String(get(d));
        }
    }

    return {
        get: (key) => get(defs.find((d) => d.key === key)),
        render,
        applyAll() {
            for (const d of defs) if (d.apply) d.apply(get(d), api);
        },
        /** Cycle the row bound to `action`; false if no row owns it. */
        handle(action) {
            const d = defs.find((x) => x.action === action);
            if (!d) return false;
            const i = d.values.indexOf(get(d));
            const v = d.values[(i + 1) % d.values.length];
            api.save.set(d.key, v);
            api.save.save();
            if (d.apply) d.apply(v, api);
            render();
            return true;
        },
    };
}
