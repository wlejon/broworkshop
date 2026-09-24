// test_tools.js — Range & Selection Lab: the MutationObserver stream, the
// DOMParser studio and the text shaper tab.
//
// Run: scripts/validate.sh demos/range-selection-lab

import { check, eq, test, done, frames, q, text, clickOn, setValue, shot } from '/lib/kit/test.js';
import { observerState, takeRecords, visibleRecords, KEEP } from '/app/observer.js';
import { parserState, parse, SAMPLES } from '/app/parser.js';
import { shaperState, clusterKind, PRESETS } from '/app/shaper.js';

frames(4);

const editor = q('#editor');
const fs = require('fs');

/** Let MutationObserver callbacks (microtasks) run, then drain anything queued. */
function settle() {
    frames(1);
    takeRecords();
    frames(1);
}

// =============================================================================
// MutationObserver
// =============================================================================

test('observer: records all three mutation types from the editor', () => {
    clickOn('#tabs [data-tab="observer"]');
    clickOn('#obsClear');
    eq(observerState.stats.total, 0, 'cleared');
    check(/Log cleared/.test(text('#obsLog')), 'the log says it was cleared');

    q('#p1').setAttribute('data-x', '1');               // attributes
    q('#p1').setAttribute('data-x', '2');
    q('#p3').firstChild.data = 'Changed text. ';        // characterData
    q('#p3').appendChild(document.createElement('span')); // childList
    settle();

    const s = observerState.stats;
    check(s.attributes === 2, 'two attribute records, got ' + s.attributes);
    check(s.characterData === 1, 'one characterData record, got ' + s.characterData);
    check(s.childList === 1 && s.nodesAdded === 1, `one childList record adding one node, got ${s.childList}/${s.nodesAdded}`);
    eq(s.total, 4, 'total');
    eq(text('#obsTotal'), '4', 'total readout');

    const newest = observerState.records[0];
    eq(newest.type, 'childList', 'newest first');
    const attr = observerState.records.find((r) => r.type === 'attributes' && r.details.newValue === '2');
    check(attr && attr.details.oldValue === '1', 'attributeOldValue carried: ' + JSON.stringify(attr && attr.details));
    const cd = observerState.records.find((r) => r.type === 'characterData');
    check(cd.details.oldText.startsWith('Check out') && cd.details.newText === 'Changed text. ',
        'characterDataOldValue carried: ' + JSON.stringify(cd.details));
    eq(document.querySelectorAll('#obsLog .rec').length, 4, 'four rows in the log');
});

test('observer: typing into the editor is recorded', () => {
    clickOn('#tabs [data-tab="range"]');
    const before = observerState.stats.total;
    const b = q('#p1').getBoundingClientRect();
    click(b.left + 4, b.top + 14);
    frames(1);
    textInput('Q');
    settle();
    check(observerState.stats.total > before, `typing produced records (${before} → ${observerState.stats.total})`);
    check(/mutations \d+/.test(text('#stats')), 'the status bar counts them: ' + text('#stats'));
});

test('observer: the filter shows one type', () => {
    clickOn('#tabs [data-tab="observer"]');
    setValue('#obsFilter', 'attributes');
    const rows = [...document.querySelectorAll('#obsLog .rec')];
    check(rows.length > 0 && rows.every((r) => r.dataset.type === 'attributes'), 'only attribute rows: ' + rows.map((r) => r.dataset.type));
    eq(rows.length, visibleRecords().length, 'row count matches the filtered records');
    setValue('#obsFilter', 'all');
});

test('observer: pause drops records, resume takes them again', () => {
    clickOn('#obsPause');
    check(observerState.paused, 'paused');
    eq(text('#observerChip'), 'observer: paused', 'header chip');
    eq(text('#obsPause'), 'resume', 'button label');
    const before = observerState.stats.total;
    q('#p1').setAttribute('data-y', 'paused');
    settle();
    eq(observerState.stats.total, before, 'nothing recorded while paused');
    clickOn('#obsPause');
    check(!observerState.paused && text('#observerChip') === 'observer: active', 'resumed');
    q('#p1').setAttribute('data-y', 'live');
    settle();
    eq(observerState.stats.total, before + 1, 'recording again');
});

test('observer: the log keeps at most KEEP records', () => {
    for (let i = 0; i < KEEP + 20; i++) q('#p1').setAttribute('data-n', String(i));
    settle();
    eq(observerState.records.length, KEEP, 'trimmed to ' + KEEP);
    check(document.querySelectorAll('#obsLog .rec').length <= 80, 'at most 80 rows rendered');
});

test('observer: export writes the log as JSON through <a download>', () => {
    const prev = lastDownload();
    clickOn('#obsExport');
    frames(1);
    const path = lastDownload();
    check(path && path !== prev && /mutation-log-\d+\.json$/.test(path), 'a download landed: ' + path);
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    eq(data.stats.total, observerState.stats.total, 'exported stats match');
    eq(data.records.length, observerState.records.length, 'every kept record exported');
    eq(JSON.stringify(data), JSON.stringify(JSON.parse(observerState.lastExport)), 'the file is exactly what was exported');
});

// =============================================================================
// DOMParser
// =============================================================================

test('parser: the HTML preset parses into a tree', () => {
    clickOn('#tabs [data-tab="parser"]');
    setValue('#parserPreset', 'html');
    const res = parserState.last;
    check(res.ok, 'parsed');
    eq(res.tree.tag, 'body', 'text/html roots at <body>');
    eq(res.metrics.elements, 9, 'body + div + h3 + span + p + ul + 3 li');
    eq(res.metrics.attributes, 7, 'class, id, class, class, 3 × data-status');
    check(/9 elements, 7 attrs, depth \d/.test(text('#parserStats')), 'stats chip: ' + text('#parserStats'));
    eq(document.querySelectorAll('#parserTree .node').length > 9, true, 'tree drawn');
});

test('parser: presets set the MIME type', () => {
    setValue('#parserPreset', 'svg');
    eq(q('#parserMime').value, 'image/svg+xml', 'svg preset → image/svg+xml');
    setValue('#parserPreset', 'xml');
    eq(q('#parserMime').value, 'application/xml', 'xml preset → application/xml');
    eq(q('#parserInput').value, SAMPLES.xml.text, 'and loaded its source');
});

test('parser: XML types build an XML document', () => {
    for (const key of ['svg', 'xml']) {
        setValue('#parserPreset', key);
        const res = parserState.last;
        const root = key === 'svg' ? 'svg' : 'application';
        check(res.ok, `${SAMPLES[key].mime} parses`);
        eq(res.tree.tag, root, `${SAMPLES[key].mime} roots at <${root}>`);
        eq(res.doc.body == null, true, 'an XML document has no <body>');
    }
    // Names keep their case in an XML document.
    setValue('#parserPreset', 'svg');
    const lg = parserState.last.doc.getElementsByTagName('linearGradient')[0] ||
               parserState.last.doc.documentElement.firstElementChild.firstElementChild;
    eq(lg && lg.nodeName, 'linearGradient', 'SVG camelCase name kept');
});

test('parser: malformed XML reports a parse error', () => {
    setValue('#parserPreset', 'error');
    const res = parserState.last;
    check(!res.ok, 'malformed XML → <parsererror>');
    check(/error/i.test(text('#parserStats')), 'stats chip says parse error: ' + text('#parserStats'));
    check(/XML Parsing Error/.test(res.error), 'the parsererror text is shown: ' + res.error);
});

test('parser: an unsupported type is reported, not thrown', () => {
    const res = parse('<a/>', 'text/bogus');
    check(!res.ok && /not a supported/.test(res.error), 'error result: ' + JSON.stringify(res.error));
});

test('parser: markup under inspection never becomes page markup', () => {
    q('#parserInput').value = '<p title="&quot;&gt;&lt;i id=injected&gt;x&lt;/i&gt;">t<img id="evil"></p>';
    q('#parserMime').value = 'text/html';
    clickOn('#btnParse');
    check(!document.getElementById('injected') && !document.getElementById('evil'), 'no element from the source entered the page');
    check(/injected/.test(text('#parserTree')), 'the attribute text is shown as text');
    check(/<img/.test(text('#parserTree')), 'the <img> is shown as a tree node');
});

// =============================================================================
// Text shaper
// =============================================================================

test('shaper: the default text shows its ligatures', () => {
    clickOn('#tabs [data-tab="shaper"]');
    const m = shaperState.map;
    eq(m.text, 'office fluffy difficult', 'default text');
    eq(shaperState.opts.family, 'Calibri', 'Calibri by default');
    check(shaperState.ligatures >= 2, 'Calibri ligates ffi / ffl / ff: ' + shaperState.ligatures);
    const rows = document.querySelectorAll('#clusterTable tr');
    eq(rows.length, m.clusters.length + 1, 'one table row per cluster + header');
    const lig = m.clusters.find((c) => c.ligature);
    check(lig && lig.text.length > 1 && /^f/.test(lig.text), 'a ligature cluster carries its source text: ' + (lig && lig.text));
    check(!text('#clusterTable').includes('(span)'), 'no placeholder text in the table');
    check(Math.abs(m.clusters.reduce((a, c) => a + c.advance, 0) - m.width) < 1e-3, 'advances re-sum to the width');
    eq(text('#shaperStats').includes('ligatures ' + shaperState.ligatures), true, 'readout');
});

test('shaper: an Arabic preset is laid out right to left', () => {
    setValue('#shaperPreset', 'arabic');
    const m = shaperState.map;
    eq(m.text, PRESETS.arabic, 'text from the preset');
    check(m.reordered, 'visual order differs from logical');
    check(m.clusters.every((c) => c.rtl), 'every cluster rtl');
    check(m.clusters[0].byteStart > m.clusters[m.clusters.length - 1].byteStart, 'the leftmost box is the logically LAST cluster');
    check(m.monotonic, 'boxes are placed at each cluster\'s own pen x');
    check([...document.querySelectorAll('#clusterTable td.rtl')].length > 0, 'the table marks rtl clusters');
});

test('shaper: an astral emoji is one cluster and not a ligature', () => {
    setValue('#shaperPreset', 'astral');
    const m = shaperState.map;
    const emoji = m.clusters.find((c) => c.text === '😀');
    check(emoji && emoji.byteLen === 4 && emoji.u16End - emoji.u16Start === 2, 'the emoji is 4 bytes / 2 UTF-16 units: ' + JSON.stringify(emoji));
    check(clusterKind(emoji) !== 'ligature', 'one code point in one glyph is not a ligature');
});

test('shaper: size and family re-shape', () => {
    setValue('#shaperPreset', 'office');
    setValue('#shaperSize', 30);
    eq(shaperState.opts.size, 30, 'size');
    eq(text('#shaperSizeV'), '30px', 'size readout');
    const w30 = shaperState.map.width;
    setValue('#shaperSize', 60);
    check(Math.abs(shaperState.map.width - 2 * w30) < w30 * 0.03, 'width doubles with the size');
    setValue('#shaperFamily', 'Arial');
    eq(shaperState.opts.family, 'Arial', 'family');
    eq(shaperState.ligatures, 0, 'Arial forms no f-ligatures');
});

test('shaper: kerning pairs kern tighter', () => {
    setValue('#shaperFamily', 'Calibri');
    const av = shaperState.kerning.find((k) => k.pair === 'AV');
    check(av.delta < -0.5, 'AV is narrower than A + V: ' + av.delta);
    check(shaperState.kerning.filter((k) => k.delta < -0.05).length >= 4, 'most probe pairs kern');
    check(document.querySelectorAll('#kernTable td.tight').length >= 4, 'and are marked tight');
});

test('shaper: Enter in the text field shapes it', () => {
    const input = q('#shaperText');
    clickOn(input);
    input.value = '';
    textInput('fi');
    press0Enter();
    eq(shaperState.map.text, 'fi', 'shaped the typed text');
    shot('shaper');
});

function press0Enter() {
    keyDown(13, 0, 0);
    keyUp(13, 0, 0);
    flush();
}

done('range-selection-lab tools');
