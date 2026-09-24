// table.js — the process list: keyed grid rows updated in place, a detail
// block under the selected row, two-click kill confirms.
//
// Rows are CSS-grid rows (style.css .row), not a <table>: the command column
// takes the width that is left and clips with an ellipsis, so a long command
// line can never push the kill column off screen.

import { h, fmtBytes } from "/lib/kit/dom.js";
import { world, killable, baseName } from "./procs.js";

const ARM_MS = 5000;              // a first "kill" click arms for this long

export function fmtAge(ms) {
    if (!ms) return '?';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60) + 's';
    if (s < 86400) return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd' + Math.floor((s % 86400) / 3600) + 'h';
}

const fmtCpu = (cores) => world.cores ? (cores / world.cores * 100).toFixed(1) + '%' : '–';

/**
 * processTable(list, { onAction(action, proc), onKill(pid), onChange() })
 * -> { render(procs), selected, deselect(pid) }.
 * Actions: kill, killtree, folder, copy, reapadd.
 */
export function processTable(list, opts) {
    const rows = new Map();       // pid -> { el, cells, kill, detail }
    const armed = new Map();      // pid -> arm time
    let selected = null;

    function makeRow(pid) {
        const cells = { name: h('span.c-name'), pid: h('span.c-pid'), cpu: h('span.c-cpu'), mem: h('span.c-mem'),
                        age: h('span.c-age'), cmd: h('span.c-cmd') };
        const kill = h('button.kill.small', { dataset: { pid } }, 'kill');
        const el = h('div.row', { dataset: { pid } }, Object.values(cells), h('span.c-kill', null, kill));
        return { el, cells, kill, detail: null, nameKey: '', cmdText: '' };
    }

    function updateRow(r, p) {
        const nameKey = (p.isSelf ? 's' : p.orphan ? 'o' : '') + p.name;
        if (r.nameKey !== nameKey) {
            r.cells.name.textContent = '';
            if (p.isSelf) r.cells.name.appendChild(h('span.dot.self', { title: 'this app' }, '● '));
            else if (p.orphan) r.cells.name.appendChild(h('span.dot.orphan', { title: 'parent is gone' }, '● '));
            r.cells.name.appendChild(document.createTextNode(p.name || ''));
            r.nameKey = nameKey;
        }
        r.cells.pid.textContent = p.pid;
        r.cells.cpu.textContent = fmtCpu(p.cores);
        r.cells.cpu.className = 'c-cpu' + (p.cores > 3 ? ' pegged' : p.cores > 0.5 ? ' busy' : '');
        r.cells.mem.textContent = fmtBytes(p.mem || 0);
        r.cells.age.textContent = fmtAge(p.ageMs);
        // Plain text: tags as [brackets] (mixed inline runs in a nowrap/ellipsis
        // cell mislay in htmlayout).
        const cmd = (p.sum.tags || []).map((t) => '[' + t + '] ').join('') + p.sum.title;
        if (r.cmdText !== cmd) { r.cells.cmd.textContent = cmd; r.cells.cmd.title = p.cmd || p.path || ''; r.cmdText = cmd; }
        const isArmed = armed.has(p.pid);
        r.kill.disabled = !killable(p);
        r.kill.textContent = isArmed ? 'sure?' : 'kill';
        r.kill.classList.toggle('armed', isArmed);
        r.el.classList.toggle('selected', selected === p.pid);
    }

    function makeDetail(p) {
        const act = (action, label) => h('button.small', { dataset: { action, pid: p.pid } }, label);
        const parent = h('span.d-v'), stats = h('span.d-v');
        const el = h('div.detail', null,
            h('div.d-grid', null,
                h('span.d-k', null, 'command'), h('span.d-v', null, p.cmd || '—'),
                h('span.d-k', null, 'path'), h('span.d-v', null, p.path || '—'),
                h('span.d-k', null, 'parent'), parent,
                h('span.d-k', null, 'stats'), stats),
            h('div.k-row', null,
                killable(p) ? [act('kill', 'kill'), act('killtree', 'kill tree')] : null,
                p.path ? act('folder', 'open folder') : null,
                act('copy', 'copy command'),
                act('reapadd', "auto-kill '" + baseName(p.name) + "'")));
        return { el, parent, stats };
    }

    function updateDetail(d, p) {
        d.parent.textContent = p.parentName ? p.parentName + ' #' + p.ppid : '#' + p.ppid + ' (gone)';
        d.stats.textContent = p.cores.toFixed(2) + ' cores · ' + fmtBytes(p.mem || 0) + ' · ' +
            (p.th || '?') + ' threads · started ' + (p.start ? new Date(p.start).toLocaleTimeString() : '?');
    }

    function render(procs) {
        const now = Date.now();
        for (const [pid, t] of armed) if (now - t > ARM_MS) armed.delete(pid);
        const present = new Set();
        for (const p of procs) {
            present.add(p.pid);
            let r = rows.get(p.pid);
            if (!r) { r = makeRow(p.pid); rows.set(p.pid, r); }
            updateRow(r, p);
            list.appendChild(r.el);                       // (re)ordering = appending in sort order
            if (selected === p.pid) {
                if (!r.detail) r.detail = makeDetail(p);
                updateDetail(r.detail, p);
                list.appendChild(r.detail.el);
            } else if (r.detail) {
                r.detail.el.remove();
                r.detail = null;
            }
        }
        for (const [pid, r] of rows) {
            if (present.has(pid)) continue;
            r.el.remove();
            if (r.detail) r.detail.el.remove();
            rows.delete(pid);
        }
    }

    list.addEventListener('click', (e) => {
        const act = e.target.closest('[data-action]');
        if (act) {
            const p = world.procs.get(Number(act.dataset.pid));
            if (p) opts.onAction(act.dataset.action, p);
            return;
        }
        const killBtn = e.target.closest('button.kill');
        if (killBtn) {
            if (killBtn.disabled) return;
            const pid = Number(killBtn.dataset.pid);
            if (armed.has(pid)) {
                armed.delete(pid);
                killBtn.textContent = '…';
                opts.onKill(pid);
            } else {
                armed.set(pid, Date.now());
                opts.onChange();
            }
            return;
        }
        const row = e.target.closest('.row[data-pid]');
        if (row) {
            const pid = Number(row.dataset.pid);
            selected = selected === pid ? null : pid;
            opts.onChange();
        }
    });

    return {
        render,
        get selected() { return selected; },
        deselect(pid) { if (selected === pid) selected = null; },
    };
}
