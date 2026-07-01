// system-menu.js — shared menu bar for windowed tools/demos (not games).
//
// Wires up bro.menu with File > Quit, optional app-specific File/View
// items, and a Debug menu exposing the engine's built-in debugging tools
// (DOM inspector, perf HUD, preferences). Games stay fullscreen and leave
// bro.menu hidden (the default) — this is for windowed apps.
//
// Usage:
//   import { installSystemMenu } from "/lib/system-menu.js";
//   installSystemMenu();
//
//   // with custom File/View items + handlers:
//   installSystemMenu({
//       file: [{ id: 'file.open', label: 'Open...', accel: 'Ctrl+O' }],
//       view: [{ id: 'view.grid', label: 'Show Grid', checked: true }],
//       handlers: {
//           'file.open': () => { /* ... */ },
//           'view.grid': () => { /* ... */ },
//       },
//   });

export function installSystemMenu(opts) {
    opts = opts || {};
    if (typeof bro === 'undefined' || !bro.menu) return;

    const file = opts.file || [];
    const view = opts.view || [];
    const handlers = opts.handlers || {};

    const tree = [
        { id: 'file', label: 'File', items: [
            ...file,
            ...(file.length ? [{ separator: true }] : []),
            { id: '__system.quit', label: 'Quit', accel: 'Ctrl+Q' },
        ]},
    ];

    if (view.length) {
        tree.push({ id: 'view', label: 'View', items: view });
    }

    tree.push({ id: 'debug', label: 'Debug', items: [
        { id: '__system.inspector', label: 'Inspector' },
        { id: '__system.togglePerf', label: 'Perf HUD' },
        { separator: true },
        { id: '__system.preferences', label: 'Preferences...' },
    ]});

    bro.menu.set(tree);
    for (const id in handlers) bro.menu.on(id, handlers[id]);
    bro.menu.show();
}
