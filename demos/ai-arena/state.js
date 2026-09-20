// state.js — Match state shim kept for backwards compatibility and headless eval.
// Canonical live match state now lives on App.state in /app/main.js, which
// other modules (controls.js, scene_setup.js, agents/registry.js) import
// directly using Bronze's native circular ES module loading.
import { App } from "/app/main.js";

export var State = {
    get current() {
        return (App && App.state) ? App.state : this._current;
    },
    set current(v) {
        this._current = v;
        if (App) App.state = v;
    },
    _current: null
};
