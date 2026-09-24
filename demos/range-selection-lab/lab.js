// lab.js — Range & Selection Lab: boot, tabs and the status bar.
//
//   range-ops.js / range-view.js  Range + Selection over a contenteditable
//   observer.js                   MutationObserver on that same editor
//   parser.js                     DOMParser under three MIME types
//   shaper.js                     bro.text cluster maps (lib/kit/text.js)

import { boot } from '/lib/kit/app.js';
import { tabs, stats as statsView } from '/lib/kit/ui.js';
import { initRangeView, editorEl } from '/app/range-view.js';
import { initObserver, observerState } from '/app/observer.js';
import { initParser } from '/app/parser.js';
import { initShaper } from '/app/shaper.js';

let app = null, readouts = null, tabBar = null;

export function start() {
    if (app) return;
    app = boot({
        menu: {
            view: [
                { id: 'view.range', label: 'Range & Selection' },
                { id: 'view.observer', label: 'MutationObserver Stream' },
                { id: 'view.parser', label: 'DOMParser Studio' },
                { id: 'view.shaper', label: 'Text Shaper' },
            ],
            handlers: {
                'view.range': () => tabBar.select('range'),
                'view.observer': () => tabBar.select('observer'),
                'view.parser': () => tabBar.select('parser'),
                'view.shaper': () => tabBar.select('shaper'),
            },
        },
    });
    readouts = statsView('#stats', { selection: 'selection', caret: 'caret', mutations: 'mutations' });
    tabBar = tabs('#tabs');

    initRangeView(showRange);
    initObserver(editorEl(), showMutations);
    initParser();
    initShaper();
    app.status.ok('ready');
}

export function selectTab(name) { tabBar.select(name); }

function showRange(m) {
    if (!readouts) return;
    readouts.set('selection', !m.hasSelection ? 'none' : !m.inEditor ? 'outside the editor'
        : m.selection.isCollapsed ? 'caret' : `${m.range.text.length} chars`);
    readouts.set('caret', m.hasSelection ? `${describeShort(m)} @ ${m.range.startOffset}` : '—');
}

function describeShort(m) {
    return m.range.start.split(' ')[0];
}

function showMutations() {
    if (!readouts) return;
    readouts.set('mutations', observerState.stats.total + (observerState.paused ? ' (paused)' : ''));
}
