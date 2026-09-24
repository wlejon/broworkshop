// launcher/catalog.js — the app list: apps.json plus each app's bro.json.
// No DOM. Relative paths resolve against the launcher dir (brokit's fs base
// path), so '../games/snake/bro.json' is <workshop>/games/snake/bro.json.

const fs = require('fs');
const path = require('path');

// Category = the dir's first segment, in launcher order.
export const CATEGORIES = [
    ['games', 'Games'],
    ['tools', 'Tools'],
    ['demos', 'Demos'],
    ['ai', 'AI'],
    ['templates', 'Templates'],
];

// BRO_APP_DIR is set by bro before the engine starts; the launcher lives at
// <workshop>/launcher, so apps live at <workshop>/<category>/<app>.
export const LAUNCHER_DIR = process.env.BRO_APP_DIR || process.cwd();
export const APPS_ROOT = path.dirname(LAUNCHER_DIR);

export function readJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return null; }
}

/** The raw apps.json entries ({ dir, server?, title?, width?, height? }). */
export function manifest() {
    const m = readJSON('apps.json');
    return m && Array.isArray(m.apps) ? m.apps : [];
}

/** Does `dir` (e.g. 'games/snake') hold an app? */
export function appExists(dir) {
    return fs.existsSync('../' + dir + '/index.html');
}

/**
 * Resolved entries: { dir, category, leaf, appPath, title, width, height,
 * server, thumb } where thumb is 'thumbnails/<leaf>.png' or null. Thumbnails
 * are flat, keyed by the app's leaf name.
 */
export function loadApps() {
    return manifest().map((entry) => {
        const dir = entry.dir;
        const cfg = readJSON('../' + dir + '/bro.json') || {};
        const leaf = dir.split('/').pop();
        const thumb = 'thumbnails/' + leaf + '.png';
        return {
            dir,
            category: dir.split('/')[0],
            leaf,
            appPath: path.join(APPS_ROOT, dir),
            title: entry.title || cfg.title || leaf,
            width: entry.width || cfg.width || 1280,
            height: entry.height || cfg.height || 720,
            server: entry.server || null,
            thumb: fs.existsSync(thumb) ? thumb : null,
        };
    });
}

/** Case-insensitive match on title, dir or category. */
export function matches(app, query) {
    if (!query) return true;
    const s = query.toLowerCase();
    return app.title.toLowerCase().includes(s) || app.dir.toLowerCase().includes(s);
}
