// lib/kit/app.js — app boot for tools, demos, labs and ai apps.
//
//   import { boot } from "/lib/kit/app.js";
//   const app = boot({ menu: { file: [...], handlers: {...} } });
//   app.status.ok('ready');
//
// boot():
//   - installs the windowed menu bar (lib/system-menu.js); menu: false skips it
//   - wraps the page's status element (default #status) in a statusLine
//   - shows uncaught errors / unhandled rejections in that status line
//     (they still reach the engine log, so headless runs still fail on them)
// Returns { status, menu } — the statusLine handle and the menu opts used.
//
// Games boot through lib/arcade/shell.js instead.

import { installSystemMenu } from "../system-menu.js";
import { statusLine } from "./ui.js";

export function boot(opts) {
    const o = opts || {};
    if (o.menu !== false) installSystemMenu(o.menu || {});

    const statusEl = document.querySelector(o.status || '#status');
    const status = statusEl ? statusLine(statusEl) : statusLine(document.createElement('span'));

    if (o.catchErrors !== false && typeof window !== 'undefined') {
        window.addEventListener('error', (e) => {
            status.error('error: ' + ((e && (e.message || (e.error && e.error.message))) || e));
        });
        window.addEventListener('unhandledrejection', (e) => {
            const r = e && e.reason;
            status.error('error: ' + ((r && r.message) || r));
        });
    }
    return { status, menu: o.menu };
}
