// launcher/launcher.js — the app grid: one section per category, a filter,
// category chips, running-app pills (click to target the Ctrl+V thumbnail
// paste, x to stop) and the paste handler itself.

import { boot, $, h, clear, segmented } from "/lib/kit/index.js";
import { CATEGORIES, APPS_ROOT, loadApps, matches } from "./catalog.js";
import { runner, EXE_DIR } from "./runner.js";

const fs = require('fs');
const path = require('path');

export const state = { apps: [], query: '', category: 'all' };
const tiles = new Map();     // dir -> tile element

export function start() {
    const app = boot({ menu: false });
    const status = app.status;
    state.apps = loadApps();

    const run = runner({
        onChange: () => { paintRunning(run); },
        onMessage: (t, kind) => status.set(t, kind),
    });

    buildGrid(run);
    const counts = { all: state.apps.length };
    for (const a of state.apps) counts[a.category] = (counts[a.category] || 0) + 1;
    const cats = [['all', 'All']].concat(CATEGORIES.filter(([k]) => counts[k]));
    segmented('#cats', cats.map(([k, label]) => [k, label + '  ' + counts[k]]), {
        value: 'all', onChange: (v) => { state.category = v; applyFilter(status); },
    });
    $('#count').textContent = state.apps.length + ' apps';
    $('#exe').textContent = EXE_DIR;

    const filter = $('#filter');
    filter.addEventListener('input', () => { state.query = filter.value.trim(); applyFilter(status); });
    filter.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && filter.value) {
            filter.value = ''; state.query = ''; applyFilter(status);
        } else if (e.key === 'Enter') {
            const first = visibleApps()[0];
            if (first) launch(run, first);
        }
    });

    document.addEventListener('paste', (e) => {
        pasteThumbnail(run, e, status).catch((err) => {
            console.error('paste failed:', err);
            status.error('Paste failed: ' + err.message);
        });
    });
    window.addEventListener('beforeunload', () => run.stopServers());

    applyFilter(status);
    return { run, status };
}

// ---- grid ---------------------------------------------------------------------

function initials(title) {
    const words = title.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

function thumbEl(app) {
    if (app.thumb) return h('div.thumb', { style: { backgroundImage: 'url(' + app.thumb + ')' } });
    return h('div.thumb.none', null, h('span.initials', null, initials(app.title)));
}

function tileEl(run, app) {
    return h('div.tile.cat-' + app.category, {
        dataset: { dir: app.dir }, title: app.appPath, onclick: () => launch(run, app),
    },
        thumbEl(app),
        h('div.meta', null,
            h('div.title', null, h('span.dot'), h('span.name', null, app.title)),
            h('div.sub', null, app.dir + '  ·  ' + app.width + '×' + app.height),
            app.server ? h('span.badge', null, 'server') : null));
}

function buildGrid(run) {
    const grid = clear($('#grid'));
    tiles.clear();
    for (const [cat, label] of CATEGORIES) {
        const apps = state.apps.filter((a) => a.category === cat);
        if (!apps.length) continue;
        const list = h('div.tiles');
        for (const a of apps) {
            const t = tileEl(run, a);
            tiles.set(a.dir, t);
            list.appendChild(t);
        }
        grid.appendChild(h('section.group', { dataset: { cat } },
            h('div.k-caption', null, label, h('span.dim.n', null, String(apps.length))),
            list));
    }
    grid.appendChild(h('div.empty#empty', { hidden: true }));
}

function visibleApps() {
    return state.apps.filter((a) => (state.category === 'all' || a.category === state.category)
                                    && matches(a, state.query));
}

function applyFilter(status) {
    const visible = visibleApps();
    const shown = new Set(visible.map((a) => a.dir));
    const perCat = {};
    for (const a of visible) perCat[a.category] = (perCat[a.category] || 0) + 1;
    for (const [dir, t] of tiles) t.hidden = !shown.has(dir);
    for (const g of document.querySelectorAll('#grid .group')) {
        const n = perCat[g.dataset.cat] || 0;
        g.hidden = n === 0;
        g.querySelector('.n').textContent = String(n);
    }
    const empty = $('#empty');
    empty.hidden = shown.size > 0;
    empty.textContent = state.query ? 'No apps match "' + state.query + '".' : 'No apps.';
    const total = state.apps.length;
    status.set(shown.size === total ? total + ' apps. Click one to launch it.'
                                    : shown.size + ' / ' + total + ' apps. Enter launches the first.');
}

// ---- running ------------------------------------------------------------------

function launch(run, app) {
    const t = tiles.get(app.dir);
    if (!run.launch(app) || !t) return;
    t.classList.add('launching');
    setTimeout(() => t.classList.remove('launching'), 800);
}

function paintRunning(run) {
    const strip = clear($('#running'));
    for (const [dir, t] of tiles) t.classList.toggle('running', run.isRunning(dir));
    for (const { app } of run.entries()) {
        strip.appendChild(h('div.pill' + (app.dir === run.target ? '.selected' : ''), {
            title: 'Click to target the Ctrl+V thumbnail paste',
            onclick: () => { run.target = app.dir; },
        },
            h('span.dot'), app.title,
            h('button.stop', { title: 'Stop', onclick: (ev) => { ev.stopPropagation(); run.stop(app.dir); } }, '×')));
    }
}

// ---- paste-to-update-thumbnail ------------------------------------------------
// Ctrl+V with a screenshot on the clipboard overwrites the targeted app's
// thumbnail (PNG preferred, BMP accepted).

async function pasteThumbnail(run, e, status) {
    const dir = run.target;
    if (!dir) { status.warn('Paste ignored: no app targeted. Launch one or click its running pill.'); return; }
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const pick = (type) => items.find((it) => it.kind === 'file' && it.type === type);
    const item = pick('image/png') || pick('image/bmp');
    if (!item) { status.warn('Paste ignored: clipboard has no image.'); return; }
    e.preventDefault();

    const file = item.getAsFile();
    const leaf = dir.split('/').pop();
    const ext = file.type === 'image/png' ? 'png' : 'bmp';
    const buf = new Uint8Array(await file.arrayBuffer());
    fs.writeFileSync(path.join(APPS_ROOT, 'launcher', 'thumbnails', leaf + '.' + ext), buf);

    // A timestamped URL busts the image cache for this one tile.
    const t = tiles.get(dir);
    if (t) {
        const thumb = t.querySelector('.thumb');
        thumb.classList.remove('none');
        clear(thumb).style.backgroundImage = 'url(thumbnails/' + leaf + '.' + ext + '?v=' + Date.now() + ')';
    }
    const app = state.apps.find((a) => a.dir === dir);
    status.ok('Updated thumbnail for ' + (app ? app.title : dir) + ' (' + buf.length + ' bytes).');
}
