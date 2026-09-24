// app.js — procwatch's page: wires the feeds, the model, the table, the
// gauges and the reaper to the controls. main.js calls start().

import { boot, ids } from "/lib/kit/index.js";
import { prefStore } from "/lib/kit/prefs.js";
import { world, visible, applySnap, applyNew, applyDel, applyEnrich } from "./procs.js";
import { isWindows, startProcessFeeds, startCpuFeed, startGpuFeed, osMemory, kill, reveal } from "./feeds.js";
import { REAP_DEFAULTS, REAP_DEFAULT_NAMES, reap, reapLog, addName } from "./reaper.js";
import { processTable } from "./table.js";
import { gauges } from "./gauges.js";

/** Persisted reaper settings. reapNames null = the default list (so it can grow in updates). */
export const prefs = prefStore('procwatch.v2', Object.assign({}, REAP_DEFAULTS, { reapNames: null }));
export const reapNames = () => prefs.data.reapNames || REAP_DEFAULT_NAMES;

const filter = { unix: true, ddrive: true, other: false, orphans: false, query: '', sort: 'cpu' };

let el, status, table, gauge;

/** The rows the table currently shows (for tests). */
export const shown = () => visible(filter);

function render() {
    const rows = visible(filter);
    table.render(rows);
    el.empty.hidden = rows.length > 0;
    if (!isWindows) {
        el.empty.textContent = 'Process monitoring needs Windows (PowerShell / WMI); inactive on ' + process.platform + '.';
        status.warn('process monitoring needs Windows');
        return;
    }
    status.set(world.procs.size + ' processes · showing ' + rows.length + ' · ' +
               (world.live ? 'stream live' : 'stream reconnecting…') +
               (reapLog.length ? ' · reaped ' + reapLog.length : ''), world.live ? '' : 'busy');
}

function renderReapLog() {
    const last = reapLog[reapLog.length - 1];
    el.reapLog.textContent = last ? 'reaped ' + reapLog.length + ' · last: ' + last.name + ' #' + last.pid : '';
}

function onAction(action, p) {
    if (action === 'kill') kill(p.pid, false, render);
    else if (action === 'killtree') kill(p.pid, true, render);
    else if (action === 'folder' && p.path) reveal(p.path);
    else if (action === 'copy') navigator.clipboard.writeText(p.cmd || p.path || p.name);
    else if (action === 'reapadd') {
        const names = addName(reapNames(), p.name);
        prefs.set({ reapNames: names });
        el.reapNames.value = names;
    }
}

/** A .k-chip checkbox: the chip carries .on while checked. */
function chip(box, checked, onChange) {
    const paint = () => box.closest('.k-chip').classList.toggle('on', box.checked);
    box.checked = !!checked;
    paint();
    box.addEventListener('change', () => { paint(); onChange(box.checked); });
}

function bindFilters() {
    const chips = { unix: el.fUnix, ddrive: el.fDdrive, other: el.fOther, orphans: el.fOrphans };
    for (const [k, box] of Object.entries(chips)) chip(box, filter[k], (on) => { filter[k] = on; render(); });
    el.q.addEventListener('input', () => { filter.query = el.q.value; render(); });
    for (const th of document.querySelectorAll('#thead [data-sort]')) {
        th.addEventListener('click', () => {
            filter.sort = th.dataset.sort;
            for (const o of document.querySelectorAll('#thead [data-sort]')) o.classList.toggle('sorted', o === th);
            render();
        });
    }
    // "kill shown": the first click arms (and says how many), a second within 5 s kills.
    let armedAt = 0;
    el.killShown.addEventListener('click', () => {
        const targets = visible(filter).filter((p) => !p.isSelf && !world.childPids.has(p.pid) && p.pid > 4);
        if (Date.now() - armedAt < 5000) {
            armedAt = 0;
            el.killShown.textContent = 'kill shown';
            el.killShown.classList.remove('armed');
            for (const p of targets) kill(p.pid, true);
        } else {
            armedAt = Date.now();
            el.killShown.textContent = 'sure? (' + targets.length + ')';
            el.killShown.classList.add('armed');
        }
    });
}

function bindReaper() {
    const d = prefs.data;
    chip(el.reapOn, d.reapOn, (on) => prefs.set({ reapOn: on }));
    chip(el.reapOrphans, d.reapOrphansOnly, (on) => prefs.set({ reapOrphansOnly: on }));
    el.reapSecs.value = d.reapSecs;
    el.reapNames.value = reapNames();
    el.reapSecs.addEventListener('change', () => prefs.set({ reapSecs: Math.max(5, Number(el.reapSecs.value) || 30) }));
    el.reapNames.addEventListener('change', () => {
        const v = el.reapNames.value.trim();
        prefs.set({ reapNames: v && v !== REAP_DEFAULT_NAMES ? v : null });
    });
}

export function start() {
    const app = boot({ menu: { view: [{ id: 'view.others', label: 'Show Everything Else' }],
                               handlers: { 'view.others': () => { el.fOther.click(); } } } });
    status = app.status;
    el = ids('tbody', 'empty', 'q', 'f-unix', 'f-ddrive', 'f-other', 'f-orphans', 'kill-shown',
             'reap-on', 'reap-orphans', 'reap-secs', 'reap-names', 'reap-log',
             'cpu-val', 'cpu-spark', 'cpu-cores', 'ram-val', 'ram-bar', 'ram-sub', 'gpus');
    gauge = gauges(el);
    table = processTable(el.tbody, {
        onAction, onChange: render,
        onKill: (pid) => kill(pid, false, render),
    });
    bindFilters();
    bindReaper();

    startProcessFeeds({
        snap(m) {
            applySnap(m);
            reap(Object.assign({}, prefs.data, { reapNames: reapNames() }), () => { renderReapLog(); render(); });
            gauge.ram(world.memTotal, world.memAvail);
            render();
        },
        created(p) { applyNew(p); render(); },
        deleted(pid) { if (applyDel(pid)) { table.deselect(pid); render(); } },
        enriched(m) { applyEnrich(m); render(); },
        down: render,
    });
    startCpuFeed((total, cores) => gauge.cpu(total, cores));
    startGpuFeed((cards) => gauge.gpus(cards));
    if (!isWindows) {
        const m = osMemory();
        if (m) gauge.ram(m.total, m.free);
    }
    render();
}
