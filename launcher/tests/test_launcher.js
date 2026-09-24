// Launcher: the grid matches apps.json, apps.json matches the disk, and the
// filter + category chips narrow the grid. Never clicks a tile (that spawns
// a bro process). Run: scripts/validate.sh launcher
import { check, eq, test, done, frames, q, text, clickOn, typeInto, press, shot } from "/lib/kit/test.js";
import { CATEGORIES, manifest, appExists } from "/app/catalog.js";
import { state } from "/app/launcher.js";

const fs = require('fs');

frames(10);

const entries = manifest();
const tiles = () => Array.from(document.querySelectorAll('#grid .tile'));
const visible = () => tiles().filter((t) => !t.hidden).map((t) => t.dataset.dir);

test('grid: one card per apps.json entry, in manifest order per category', () => {
    check(entries.length > 50, 'manifest loaded (' + entries.length + ')');
    eq(tiles().length, entries.length, 'tile count');
    const want = [];
    for (const [cat] of CATEGORIES) {
        for (const e of entries) if (e.dir.split('/')[0] === cat) want.push(e.dir);
    }
    eq(tiles().map((t) => t.dataset.dir).join(','), want.join(','), 'tile order');
    eq(visible().length, entries.length, 'all shown at boot');
    const r = q('#grid .tile').getBoundingClientRect();
    check(r.width > 150 && r.height > 150, 'first tile has a card-sized box');
});

test('apps.json: every dir exists, no duplicates, known category', () => {
    const cats = new Set(CATEGORIES.map(([k]) => k));
    const seen = new Set();
    for (const e of entries) {
        check(appExists(e.dir), e.dir + ' has an index.html');
        check(!seen.has(e.dir), e.dir + ' listed once');
        check(cats.has(e.dir.split('/')[0]), e.dir + ' is in a known category');
        if (e.server) check(fs.existsSync('../' + e.dir + '/' + e.server.script), e.dir + ' server script exists');
        seen.add(e.dir);
    }
});

test('apps.json: every app on disk is listed', () => {
    const listed = new Set(entries.map((e) => e.dir));
    for (const [cat] of CATEGORIES) {
        for (const name of fs.readdirSync('../' + cat)) {
            const dir = cat + '/' + name;
            if (appExists(dir)) check(listed.has(dir), dir + ' is missing from apps.json');
        }
    }
});

test('thumbnails: each belongs to a listed app', () => {
    const leaves = new Set(entries.map((e) => e.dir.split('/').pop()));
    for (const f of fs.readdirSync('thumbnails')) {
        if (!/\.(png|bmp)$/.test(f)) continue;
        check(leaves.has(f.replace(/\.(png|bmp)$/, '')), 'thumbnails/' + f + ' has no app');
    }
    const withThumb = state.apps.filter((a) => a.thumb).length;
    check(withThumb > 10, 'thumbnails resolved (' + withThumb + ')');
    eq(document.querySelectorAll('#grid .thumb.none').length, entries.length - withThumb, 'placeholders for the rest');
});

test('filter: typing narrows the grid, Escape clears it', () => {
    typeInto('#filter', 'lab');
    frames(2);
    const shown = visible();
    check(shown.length > 5 && shown.length < entries.length, 'filtered to ' + shown.length);
    check(shown.every((d) => d.includes('lab') || /lab/i.test(q('.tile[data-dir="' + d + '"] .title').textContent)), 'only matches shown');
    check(q('#grid .group[data-cat=games]').hidden === false || !shown.some((d) => d.startsWith('games/')), 'group visibility follows');
    check(/\d+ \/ \d+ apps/.test(text('#status')), 'status counts matches: ' + text('#status'));
    typeInto('#filter', 'zzzz-no-such-app');
    frames(2);
    eq(visible().length, 0, 'no matches');
    check(!q('#empty').hidden, 'empty note shown');
    press('Escape');
    frames(2);
    eq(q('#filter').value, '', 'filter cleared');
    eq(visible().length, entries.length, 'all shown again');
});

test('categories: a chip shows only that category', () => {
    clickOn('#cats [data-value=tools]');
    frames(2);
    const shown = visible();
    eq(shown.length, entries.filter((e) => e.dir.startsWith('tools/')).length, 'tools count');
    check(shown.every((d) => d.startsWith('tools/')), 'only tools');
    check(q('#grid .group[data-cat=games]').hidden, 'games section hidden');
    shot('tools');
    clickOn('#cats [data-value=all]');
    frames(2);
    eq(visible().length, entries.length, 'all again');
});

shot('grid');
done();
