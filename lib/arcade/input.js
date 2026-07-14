// Arcade kernel — named actions with bro.settings rebinding.
//
// Standard vocabulary keeps System → Input bindings consistent across games.
// Games may append extra actions via boot({ actions: [...] }).

/** @typedef {{ name: string, label: string, defaults: string[] }} ActionDef */

/** Shared action names every arcade game should prefer. */
export const STANDARD_ACTIONS = [
    { name: "up",        label: "Up",       defaults: ["w", "ArrowUp"] },
    { name: "down",      label: "Down",     defaults: ["s", "ArrowDown"] },
    { name: "left",      label: "Left",     defaults: ["a", "ArrowLeft"] },
    { name: "right",     label: "Right",    defaults: ["d", "ArrowRight"] },
    { name: "primary",   label: "Fire",     defaults: [" ", "Mouse0"] },
    { name: "secondary", label: "Alt Fire", defaults: ["Shift", "Mouse2"] },
    { name: "pause",     label: "Pause",    defaults: ["Escape", "p"] },
    { name: "confirm",   label: "Confirm",  defaults: ["Enter"] },
];

/**
 * @param {ActionDef[]} [actions]
 * @param {object} [opts]
 * @param {string} [opts.storageKey]
 */
export function createInput(actions, opts = {}) {
    const list = actions && actions.length ? actions.slice() : STANDARD_ACTIONS.slice();
    const storageKey = opts.storageKey || "arcade_input";

    const state = {
        actions: list,
        hasBro: false,
        controls: {},
        held: {},
        edge: {},
        raw: {},
        listeners: [],
        attached: false,
    };

    state.hasBro = (typeof bro !== "undefined" && bro.settings &&
        typeof bro.settings.defineAction === "function");

    if (state.hasBro) {
        for (const a of state.actions) {
            bro.settings.defineAction(a.name, a.defaults.slice());
        }
    } else {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) state.controls = JSON.parse(raw);
        } catch (e) { /* ignore */ }
        for (const a of state.actions) {
            if (!state.controls[a.name]) {
                state.controls[a.name] = a.defaults.slice();
            }
        }
    }

    function getKeys(actionName) {
        if (state.hasBro) {
            try { return bro.settings.getActionKeys(actionName) || []; }
            catch (e) { /* ignore */ }
        }
        const k = state.controls[actionName];
        return k ? k.slice() : [];
    }

    function actionForKey(key) {
        if (state.hasBro) {
            try { return bro.settings.getKeyAction(key) || null; }
            catch (e) { return null; }
        }
        for (const name in state.controls) {
            if ((state.controls[name] || []).indexOf(key) >= 0) return name;
        }
        return null;
    }

    function fireAction(key, phase) {
        const a = actionForKey(key);
        if (a) {
            if (phase === "down") {
                state.held[a] = true;
                state.edge[a] = true;
            } else if (phase === "up") {
                state.held[a] = false;
            }
        }
        for (const cb of state.listeners) cb(a, phase, key);
    }

    function onKeyDown(e) {
        const key = e.key;
        if (state.raw[key]) return;
        state.raw[key] = true;
        fireAction(key, "down");
    }

    function onKeyUp(e) {
        const key = e.key;
        state.raw[key] = false;
        fireAction(key, "up");
    }

    function onMouseDown(e) {
        const key = "Mouse" + e.button;
        state.raw[key] = true;
        fireAction(key, "down");
    }

    function onMouseUp(e) {
        const key = "Mouse" + e.button;
        state.raw[key] = false;
        fireAction(key, "up");
    }

    function onWheel(e) {
        const key = e.deltaY < 0 ? "WheelUp" : "WheelDown";
        fireAction(key, "down");
        fireAction(key, "up");
    }

    function attach(target) {
        if (state.attached) return;
        state.attached = true;
        target = target || window;
        target.addEventListener("keydown", onKeyDown);
        target.addEventListener("keyup", onKeyUp);
        target.addEventListener("mousedown", onMouseDown);
        target.addEventListener("mouseup", onMouseUp);
        target.addEventListener("wheel", onWheel, { passive: true });
    }

    function clear() {
        state.held = {};
        state.edge = {};
        state.raw = {};
    }

    function down(name) {
        return !!state.held[name];
    }

    function pressed(name) {
        if (!state.edge[name]) return false;
        state.edge[name] = false;
        return true;
    }

    /** Peek rising edge without consuming (for shell routing). */
    function wasPressed(name) {
        return !!state.edge[name];
    }

    function consume(name) {
        state.edge[name] = false;
    }

    function onAction(cb) {
        state.listeners.push(cb);
    }

    return {
        actions: () => state.actions.slice(),
        attach,
        clear,
        down,
        pressed,
        wasPressed,
        consume,
        getKeys,
        actionForKey,
        onAction,
    };
}
