// state.js — Live match state, split out of main.js so agents/registry.js,
// controls.js, and scene_setup.js can read/write it without importing
// main.js itself. Those three used to `import { App } from "/app/main.js"`
// just to reach `App.state`, and main.js imports all three back — a
// circular ES-module graph that real engines tolerate but trips an upstream
// QuickJS-ng bug in circular-module evaluation (aborts main.js mid-import,
// leaving the app blank). main.js is now the only writer; everyone else
// only reads State.current.
export const State = {};
State.current = null;
