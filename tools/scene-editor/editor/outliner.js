// Outliner panel: the scene tree with per-row visibility, delete, rename and
// collapse, the "+ Box" style add buttons, and a breadcrumb for the current
// group / component edit context. Re-renders on every registry change.

import { h, clear } from "/lib/kit/dom.js";

const KIND_TAG = { 'group': 'G', 'component-instance': 'C', 'edge-primitive': 'E' };
const isContainer = (o) => o.kind === 'group' || o.kind === 'component-instance';

/**
 * ed: { registry, cmd, status(text) }. els: { list, breadcrumb, add } where
 * `add` holds [data-type] buttons.
 */
export function createOutliner(ed, els) {
    const reg = ed.registry;
    const collapsed = new Set();      // group ids, kept across re-renders

    for (const b of Array.from(els.add.querySelectorAll('[data-type]'))) {
        b.addEventListener('click', () => ed.cmd.addPrimitive(b.dataset.type));
    }

    const enter = (obj) => {
        reg.enterContext(obj);
        ed.status('entered ' + obj.name);
    };

    // Inline rename: Enter / blur commit (one undo entry), Esc reverts.
    const rename = (obj, span) => {
        span.setAttribute('contenteditable', 'true');
        span.focus();
        const range = document.createRange && document.createRange();
        if (range && window.getSelection) {
            range.selectNodeContents(span);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            span.removeAttribute('contenteditable');
            span.removeEventListener('keydown', onKey);
            span.removeEventListener('blur', onBlur);
            const name = (span.textContent || '').trim();
            if (!save || !ed.cmd.rename(obj, name)) outliner.render();
        };
        const onBlur = () => finish(true);
        const onKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        };
        span.addEventListener('blur', onBlur);
        span.addEventListener('keydown', onKey);
    };

    const row = (obj, depth) => {
        const hasKids = obj.kind === 'group' && obj.children.length > 0;
        const name = h('span.ol-name', {
            title: isContainer(obj) ? 'Double-click to edit inside' : 'Double-click to rename',
            ondblclick: (e) => { e.stopPropagation(); if (isContainer(obj)) enter(obj); else rename(obj, name); },
        }, obj.name);
        const el = h('div.ol-row', {
            dataset: { id: String(obj.id) },
            style: { paddingLeft: (4 + depth * 14) + 'px' },
            onclick: () => reg.setActive(obj.id),
        },
            h('button.ol-icon.ol-twist', {
                disabled: !hasKids,
                onclick: (e) => {
                    e.stopPropagation();
                    if (collapsed.has(obj.id)) collapsed.delete(obj.id); else collapsed.add(obj.id);
                    outliner.render();
                },
            }, hasKids ? (collapsed.has(obj.id) ? '▶' : '▼') : ' '),
            h('button.ol-icon.ol-vis', {
                title: obj.visible ? 'Hide' : 'Show',
                onclick: (e) => { e.stopPropagation(); reg.setVisible(obj.id, !obj.visible); },
            }, obj.visible ? '●' : '○'),
            h('span.ol-kind', null, KIND_TAG[obj.kind] || ''),
            name,
            h('button.ol-icon.ol-del', {
                title: 'Delete',
                onclick: (e) => { e.stopPropagation(); ed.cmd.deleteObject(obj); },
            }, '×'));
        el.classList.toggle('active', obj === reg.active);
        el.classList.toggle('hidden', !obj.visible);
        el.classList.toggle('context', obj === reg.editContext);
        els.list.appendChild(el);
        if (obj.kind === 'group' && !collapsed.has(obj.id)) {
            for (const c of obj.children) row(c, depth + 1);
        }
    };

    const outliner = {
        render() {
            clear(els.list);
            if (reg.editContext === reg.root) {
                els.breadcrumb.hidden = true;
            } else {
                const chain = [];
                for (let n = reg.editContext; n && n !== reg.root; n = n.parent) chain.unshift(n.name);
                els.breadcrumb.hidden = false;
                els.breadcrumb.textContent = 'editing: ' + chain.join(' › ') + '  [Esc to exit]';
            }
            for (const c of reg.root.children) row(c, 0);
        },
    };
    return outliner;
}
