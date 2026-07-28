// procwatch — leftover-process monitor + system gauges + auto-reaper.
//
// Data feeds:
//   1. One PERSISTENT PowerShell child (stream.ps1): native-API process ticks
//      every 1.5 s + WMI create/delete events pushed as they happen, NDJSON.
//      Per-process CPU is computed here from processor-time deltas.
//   2. A short-lived enrich.ps1 pass (start + every 60 s): command lines and
//      paths from WMI, which can take 8+ s per query — never in the tick path.
//   3. A persistent `typeperf` stream (1 s) → CPU total + per-core bars.
//   4. An `nvidia-smi` poll (2.5 s) → GPU cards; absent without the driver.
//
// The table is the interaction surface: click a row for details + actions
// (kill, kill tree, open folder, copy command line, add to auto-kill list).

import { installSystemMenu } from "/lib/system-menu.js";
import { summarize } from "/app/cmdline.js";

const cp = require('child_process');

installSystemMenu();

// ---------------------------------------------------------------------------
// Config (persisted)
// ---------------------------------------------------------------------------

const REAP_DEFAULT_NAMES =
    'find,grep,egrep,fgrep,rg,sed,awk,gawk,sort,uniq,xargs,cat,tail,head,tr,wc,cut,sleep,less,yes';

const cfg = Object.assign({
    reapOn: false,            // opt-in: the list is broad by nature
    reapOrphansOnly: true,    // parent alive → probably still someone's tool
    reapSecs: 30,
    reapNames: REAP_DEFAULT_NAMES,
    reapNamesCustom: false,
}, loadCfg());
if (!cfg.reapNamesCustom) cfg.reapNames = REAP_DEFAULT_NAMES;

function loadCfg() {
    try { return JSON.parse(localStorage.getItem('procwatch.cfg')) || {}; }
    catch { return {}; }
}
function saveCfg() {
    try { localStorage.setItem('procwatch.cfg', JSON.stringify(cfg)); } catch {}
}

// ---------------------------------------------------------------------------
// Element refs
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);
const tbodyEl = $('tbody'), emptyEl = $('empty'), statusEl = $('status');
const qEl = $('q');
const chips = { unix: $('f-unix'), ddrive: $('f-ddrive'), other: $('f-other'), orphans: $('f-orphans') };
const reapOnEl = $('reap-on'), reapOrphansEl = $('reap-orphans'),
      reapSecsEl = $('reap-secs'), reapNamesEl = $('reap-names'), reapLogEl = $('reap-log');

reapOnEl.checked = cfg.reapOn;
reapOrphansEl.checked = cfg.reapOrphansOnly;
reapSecsEl.value = cfg.reapSecs;
reapNamesEl.value = cfg.reapNames;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const UNIX_NAME_RE = /^(bash|sh|dash|zsh|fish|find|grep|egrep|fgrep|rg|fd|sed|awk|gawk|xargs|tail|head|cat|less|tee|sort|uniq|cut|tr|wc|sleep|yes|make|node|python[\d.]*|perl|ruby|curl|wget|git|ssh|scp|diff|patch)(\.exe)?$/i;
const UNIX_PATH_RE = /[\\/](usr[\\/]bin|msys64|cygwin\d*)[\\/]/i;

// Never killable from this app — by click, "kill shown", or the reaper.
const PROTECTED_NAMES = new Set([
    'system', 'system idle process', 'secure system', 'registry', 'memory compression',
    'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
    'lsass.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe', 'fontdrvhost.exe',
]);

const baseName = n => (n || '').toLowerCase().replace(/\.exe$/, '');

function isProtected(p) {
    return p.pid <= 4 || PROTECTED_NAMES.has((p.name || '').toLowerCase()) ||
           p.pid === selfPid || p.pid === streamPid || p.pid === eventsPid;
}

// ---------------------------------------------------------------------------
// The process stream: one persistent PowerShell child running stream.ps1
// (native-API ticks every 1.5 s + WMI create/delete events), plus a slow
// enrich.ps1 pass for command lines (WMI can take 8+ s per query, so it never
// sits in the tick path).
// ---------------------------------------------------------------------------

let selfPid = 0;              // our engine process (parent of the tick child)
let streamPid = 0;            // tick child
let eventsPid = 0;            // event-pump child
let streamLive = false;
let procs = new Map();        // pid → enriched proc
let extra = new Map();        // pid → { cmd, path, start, ppid } from enrich/events
let totalMemBytes = 0, availMemBytes = 0, logicalCores = 0;
let prevCpu = new Map();      // "pid:name" → { cpu, t }
let lastSnapT = 0;
let enrichedOnce = false;

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

function startStream() {
    const child = cp.spawn('powershell.exe',
        [...PS_ARGS, bro.appDir + '/stream.ps1'],
        { stdio: 'pipe', encoding: 'utf8' });
    streamPid = child.pid;
    let tail = '';
    child.stdout.on('data', chunk => {
        tail += chunk;
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const line of lines) {
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.e === 'snap') handleSnap(msg);
            else if (msg.e === 'new') handleNew(msg.p);
            else if (msg.e === 'del') handleDel(msg.id);
        }
    });
    child.on('close', () => {
        streamLive = false;
        render();
        setTimeout(startStream, 2000);
    });
}

function startEvents() {
    const child = cp.spawn('powershell.exe',
        [...PS_ARGS, bro.appDir + '/events.ps1'],
        { stdio: 'pipe', encoding: 'utf8' });
    eventsPid = child.pid;
    let tail = '';
    child.stdout.on('data', chunk => {
        tail += chunk;
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const line of lines) {
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.e === 'new') handleNew(msg.p);
            else if (msg.e === 'del') handleDel(msg.id);
        }
    });
    child.on('close', () => setTimeout(startEvents, 2000));
}

function runEnrich() {
    const child = cp.spawn('powershell.exe',
        [...PS_ARGS, bro.appDir + '/enrich.ps1'],
        { stdio: 'pipe', encoding: 'utf8' });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.on('close', () => {
        try {
            const msg = JSON.parse(out.trim());
            for (const e of msg.procs || []) {
                if (!e.pid) continue;
                const prev = extra.get(e.pid) || {};
                extra.set(e.pid, {
                    cmd: e.cmd || prev.cmd, path: e.path || prev.path,
                    start: e.start || prev.start, ppid: e.ppid ?? prev.ppid,
                });
            }
            enrichedOnce = true;
            if (lastSnapT) { mergeExtra(); render(); }
        } catch {}
        setTimeout(runEnrich, 60000);
    });
}

function mergeExtra() {
    for (const p of procs.values()) {
        const ex = extra.get(p.pid);
        if (!ex) continue;
        if (!p.cmd && ex.cmd) { p.cmd = ex.cmd; p.sum = summarize(p.name, p.cmd, p.path); }
        if (!p.path && ex.path) p.path = ex.path;
        if (!p.start && ex.start) p.start = ex.start;
        if (!p.ppid && ex.ppid) p.ppid = ex.ppid;
    }
}

function enrichProc(p, now) {
    const parent = procs.get(p.ppid);
    p.orphan = p.pid > 4 && p.ppid > 0 &&
        (!parent || (p.start && parent.start && parent.start > p.start));
    p.parentName = parent ? parent.name : null;
    p.isUnix = UNIX_NAME_RE.test(p.name || '') || UNIX_PATH_RE.test(p.path || '');
    p.isD = /^d:/i.test(p.path || '') || /^"?d:\\/i.test(p.cmd || '');
    p.ageMs = p.start ? Math.max(0, now - p.start) : 0;
    p.isSelf = p.pid === selfPid;
    if (!p.sum) p.sum = summarize(p.name, p.cmd, p.path);
    if (p.cores === undefined) p.cores = 0;
    return p;
}

function handleSnap(data) {
    streamLive = true;
    totalMemBytes = data.mt;
    availMemBytes = data.mf;
    logicalCores = data.n;
    lastSnapT = data.t;

    const next = new Map();
    for (const p of data.procs) {
        if (p.pid === 0 || p.pid === streamPid || p.pid === eventsPid) continue;
        next.set(p.pid, p);
    }
    const streamProc = data.procs.find(p => p.pid === streamPid);
    if (streamProc) selfPid = streamProc.ppid;

    const nextCpu = new Map();
    for (const p of next.values()) {
        const key = p.pid + ':' + p.name;
        const prev = prevCpu.get(key);
        // cpu is cumulative 100 ns units; Δ/(Δt·10000) = fraction of one core.
        p.cores = prev && data.t > prev.t
            ? Math.max(0, (p.cpu - prev.cpu) / ((data.t - prev.t) * 10000)) : 0;
        nextCpu.set(key, { cpu: p.cpu, t: data.t });
    }
    prevCpu = nextCpu;

    // Drop enrich data for pids that no longer exist (guards against reuse).
    for (const pid of extra.keys()) if (!next.has(pid)) extra.delete(pid);

    procs = next;
    mergeExtra();
    for (const p of procs.values()) enrichProc(p, data.t);
    reap();
    render();
    drawGauges();
}

function handleNew(p) {
    if (!p || !p.pid || p.pid === streamPid || p.pid === eventsPid) return;
    extra.set(p.pid, { cmd: p.cmd, path: p.path, start: p.start, ppid: p.ppid });
    const now = lastSnapT || Date.now();
    if (procs.has(p.pid)) {
        const cur = procs.get(p.pid);
        if (!cur.cmd && p.cmd) { cur.cmd = p.cmd; cur.sum = summarize(cur.name, cur.cmd, cur.path); }
        if (!cur.path && p.path) cur.path = p.path;
        if (!cur.start && p.start) cur.start = p.start;
    } else {
        if (!p.start) p.start = now;
        procs.set(p.pid, p);
        enrichProc(p, now);
    }
    render();
}

function handleDel(pid) {
    extra.delete(pid);
    if (!procs.delete(pid)) return;
    if (selectedPid === pid) selectedPid = null;
    render();
}

// ---------------------------------------------------------------------------
// Auto-reaper
// ---------------------------------------------------------------------------

const reapLog = [];
const reapInFlight = new Set();

function reap() {
    if (!cfg.reapOn) return;
    const names = new Set(cfg.reapNames.split(',').map(s => baseName(s.trim())).filter(Boolean));
    const maxAge = Math.max(5, cfg.reapSecs) * 1000;
    for (const p of procs.values()) {
        if (!names.has(baseName(p.name))) continue;
        if (!p.start || p.ageMs < maxAge) continue;
        if (cfg.reapOrphansOnly && !p.orphan) continue;
        if (isProtected(p) || reapInFlight.has(p.pid)) continue;
        reapInFlight.add(p.pid);
        kill(p.pid, true, () => {
            reapInFlight.delete(p.pid);
            reapLog.push({ name: p.name, pid: p.pid });
            renderReapLog();
        });
    }
}

function renderReapLog() {
    if (!reapLog.length) { reapLogEl.textContent = ''; return; }
    const last = reapLog[reapLog.length - 1];
    reapLogEl.textContent = `reaped ${reapLog.length}  \u00b7  last: ${last.name} #${last.pid}`;
}

function kill(pid, tree, done) {
    const args = ['/PID', String(pid)];
    if (tree) args.push('/T');
    args.push('/F');
    cp.execFile('taskkill', args, () => { if (done) done(); });
}

// ---------------------------------------------------------------------------
// Table: keyed rows, click-to-expand details
// ---------------------------------------------------------------------------

const rowMap = new Map();     // pid → { tr, tds, killBtn, detailTr, refs, lastSumHtml }
let selectedPid = null;
let sortKey = 'cpu';
const armed = new Map();      // pid → arm timestamp (two-click confirm)

const SORTERS = {
    cpu: (a, b) => (Math.round(b.cores * 20) - Math.round(a.cores * 20)) || (a.pid - b.pid),
    mem: (a, b) => (b.mem - a.mem) || (a.pid - b.pid),
    age: (a, b) => (a.ageMs - b.ageMs) || (a.pid - b.pid),
    name: (a, b) => (a.name || '').localeCompare(b.name || '') || (a.pid - b.pid),
};

function visible() {
    const q = qEl.value.trim().toLowerCase();
    return [...procs.values()].filter(p => {
        const bucket = (chips.unix.checked && p.isUnix) ||
                       (chips.ddrive.checked && p.isD) ||
                       (chips.other.checked && !p.isUnix && !p.isD);
        if (!bucket) return false;
        if (chips.orphans.checked && !p.orphan) return false;
        if (q) {
            const hay = ((p.name || '') + ' ' + (p.sum ? p.sum.title : '') + ' ' +
                         (p.cmd || '') + ' ' + (p.path || '')).toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }).sort(SORTERS[sortKey] || SORTERS.cpu);
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtAge(ms) {
    if (!ms) return '?';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60) + 's';
    if (s < 86400) return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd' + Math.floor((s % 86400) / 3600) + 'h';
}
const fmtMem = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB' : ((b / (1 << 20)) | 0) + ' MB';
const fmtCpu = cores => logicalCores ? (cores / logicalCores * 100).toFixed(1) + '%' : '\u2013';

function makeRow(pid) {
    const tr = document.createElement('tr');
    tr.dataset.pid = pid;
    tr.innerHTML =
        '<td class="c-name"></td><td class="c-pid"></td><td class="c-cpu"></td>' +
        '<td class="c-mem"></td><td class="c-age"></td><td class="c-cmd"></td>' +
        `<td class="c-kill"><button class="kill" data-pid="${pid}">kill</button></td>`;
    const tds = tr.children;
    return {
        tr,
        name: tds[0], pid: tds[1], cpu: tds[2], mem: tds[3], age: tds[4], cmd: tds[5],
        killBtn: tds[6].firstChild,
        detailTr: null, refs: null, lastSumHtml: '',
    };
}

function updateRow(r, p) {
    const dot = p.isSelf ? '<span class="dot self" title="this app">\u25cf </span>'
             : p.orphan ? '<span class="dot orphan" title="parent is gone">\u25cf </span>' : '';
    const nameHtml = dot + esc(p.name);
    if (r.lastNameHtml !== nameHtml) { r.name.innerHTML = nameHtml; r.lastNameHtml = nameHtml; }
    r.pid.textContent = p.pid;
    r.cpu.textContent = fmtCpu(p.cores);
    r.cpu.className = 'c-cpu' + (p.cores > 3 ? ' pegged' : p.cores > 0.5 ? ' busy' : '');
    r.mem.textContent = fmtMem(p.mem);
    r.age.textContent = fmtAge(p.ageMs);
    // Plain text only: htmlayout mislays mixed inline runs in nowrap/ellipsis
    // cells (spans shift the following run's origin), so tags are [brackets].
    const sumText = (p.sum.tags || []).map(t => '[' + t + '] ').join('') + p.sum.title;
    if (r.lastSumHtml !== sumText) {
        r.cmd.textContent = sumText;
        r.cmd.title = p.cmd || p.path || '';
        r.lastSumHtml = sumText;
    }
    const killable = !isProtected(p) && !p.isSelf;
    r.killBtn.disabled = !killable;
    const isArmed = armed.has(p.pid);
    r.killBtn.textContent = isArmed ? 'sure?' : 'kill';
    r.killBtn.classList.toggle('armed', isArmed);
    r.tr.classList.toggle('selected', selectedPid === p.pid);
}

function makeDetail(p) {
    const tr = document.createElement('tr');
    tr.className = 'detail';
    const killable = !isProtected(p) && !p.isSelf;
    tr.innerHTML = `<td colspan="7"><div class="d-wrap">
        <div class="d-grid">
            <span class="d-k">command</span><span class="d-v d-cmd">${esc(p.cmd || '\u2014')}</span>
            <span class="d-k">path</span><span class="d-v">${esc(p.path || '\u2014')}</span>
            <span class="d-k">parent</span><span class="d-v d-parent"></span>
            <span class="d-k">stats</span><span class="d-v d-stats"></span>
        </div>
        <div class="d-actions">
            ${killable ? `<button class="act" data-action="kill" data-pid="${p.pid}">kill</button>
            <button class="act" data-action="killtree" data-pid="${p.pid}">kill tree</button>` : ''}
            ${p.path ? `<button class="act" data-action="folder" data-pid="${p.pid}">open folder</button>` : ''}
            <button class="act" data-action="copy" data-pid="${p.pid}">copy command</button>
            <button class="act" data-action="reapadd" data-pid="${p.pid}">auto-kill '${esc(baseName(p.name))}'</button>
        </div>
    </div></td>`;
    return {
        tr,
        parent: tr.querySelector('.d-parent'),
        stats: tr.querySelector('.d-stats'),
    };
}

function updateDetail(r, p) {
    r.refs.parent.textContent = p.parentName
        ? `${p.parentName} #${p.ppid}` : `#${p.ppid} (gone)`;
    r.refs.stats.textContent =
        `${p.cores.toFixed(2)} cores \u00b7 ${fmtMem(p.mem)} \u00b7 ${p.th || '?'} threads \u00b7 started ` +
        (p.start ? new Date(p.start).toLocaleTimeString() : '?');
}

function render() {
    const rows = visible();
    const nowMs = Date.now();
    for (const [pid, t] of armed) if (nowMs - t > 5000) armed.delete(pid);

    const present = new Set();
    for (const p of rows) {
        present.add(p.pid);
        let r = rowMap.get(p.pid);
        if (!r) { r = makeRow(p.pid); rowMap.set(p.pid, r); }
        updateRow(r, p);
        tbodyEl.appendChild(r.tr);
        if (selectedPid === p.pid) {
            if (!r.refs) { r.refs = makeDetail(p); r.detailTr = r.refs.tr; }
            updateDetail(r, p);
            tbodyEl.appendChild(r.detailTr);
        } else if (r.detailTr) {
            r.detailTr.remove(); r.detailTr = null; r.refs = null;
        }
    }
    for (const [pid, r] of rowMap) {
        if (!present.has(pid)) {
            r.tr.remove();
            if (r.detailTr) r.detailTr.remove();
            rowMap.delete(pid);
        }
    }

    emptyEl.classList.toggle('hidden', rows.length > 0);
    statusEl.textContent =
        `${procs.size} processes \u00b7 showing ${rows.length} \u00b7 ` +
        (streamLive ? 'stream live' : 'stream reconnecting\u2026') +
        (reapLog.length ? ` \u00b7 reaped ${reapLog.length}` : '');
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function handleAction(action, pid) {
    const p = procs.get(pid);
    if (!p) return;
    if (action === 'kill') kill(pid, false);
    else if (action === 'killtree') kill(pid, true);
    else if (action === 'folder' && p.path) cp.spawn('explorer.exe', ['/select,' + p.path]);
    else if (action === 'copy') navigator.clipboard.writeText(p.cmd || p.path || p.name);
    else if (action === 'reapadd') {
        const b = baseName(p.name);
        const names = cfg.reapNames.split(',').map(s => baseName(s.trim()));
        if (!names.includes(b)) {
            cfg.reapNames += ',' + b;
            cfg.reapNamesCustom = true;
            reapNamesEl.value = cfg.reapNames;
            saveCfg();
        }
    }
}

tbodyEl.addEventListener('click', e => {
    const act = e.target.closest('[data-action]');
    if (act) { handleAction(act.dataset.action, Number(act.dataset.pid)); return; }
    const killBtn = e.target.closest('button.kill');
    if (killBtn) {
        if (killBtn.disabled) return;
        const pid = Number(killBtn.dataset.pid);
        if (armed.get(pid)) {
            armed.delete(pid);
            kill(pid, false, () => render());
            killBtn.textContent = '\u2026';
        } else {
            armed.set(pid, Date.now());
            render();
        }
        return;
    }
    const tr = e.target.closest('tr[data-pid]');
    if (tr) {
        const pid = Number(tr.dataset.pid);
        selectedPid = selectedPid === pid ? null : pid;
        render();
    }
});

for (const th of document.querySelectorAll('#tbl th[data-sort]')) {
    th.addEventListener('click', () => {
        sortKey = th.dataset.sort;
        for (const o of document.querySelectorAll('#tbl th[data-sort]'))
            o.classList.toggle('sorted', o === th);
        render();
    });
}

const killShownBtn = $('kill-shown');
let killShownArmedAt = 0;
killShownBtn.addEventListener('click', () => {
    const targets = visible().filter(p => !isProtected(p) && !p.isSelf);
    if (Date.now() - killShownArmedAt < 5000) {
        killShownArmedAt = 0;
        killShownBtn.textContent = 'kill shown';
        killShownBtn.classList.remove('armed');
        for (const p of targets) kill(p.pid, true);
    } else {
        killShownArmedAt = Date.now();
        killShownBtn.textContent = `sure? (${targets.length})`;
        killShownBtn.classList.add('armed');
    }
});

for (const el of Object.values(chips)) el.addEventListener('change', render);
qEl.addEventListener('input', render);

reapOnEl.addEventListener('change', () => { cfg.reapOn = reapOnEl.checked; saveCfg(); });
reapOrphansEl.addEventListener('change', () => { cfg.reapOrphansOnly = reapOrphansEl.checked; saveCfg(); });
reapSecsEl.addEventListener('change', () => { cfg.reapSecs = Number(reapSecsEl.value) || 30; saveCfg(); });
reapNamesEl.addEventListener('change', () => {
    cfg.reapNames = reapNamesEl.value;
    cfg.reapNamesCustom = cfg.reapNames !== REAP_DEFAULT_NAMES;
    saveCfg();
});

// ---------------------------------------------------------------------------
// CPU gauges (persistent typeperf stream, 1 s cadence)
// ---------------------------------------------------------------------------

const cpuHist = [];
let coreVals = [];

function startPerfStream() {
    const child = cp.spawn('typeperf', [
        '\\Processor Information(*)\\% Processor Time',
        '-si', '1',
    ], { stdio: 'pipe', encoding: 'utf8' });

    let tail = '';
    let cols = null;
    child.stdout.on('data', chunk => {
        tail += chunk;
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('"')) continue;
            const cells = line.slice(1, -1).split('","');
            if (line.includes('PDH-CSV')) {
                cols = cells.map(h => {
                    const m = /Processor Information\(([^)]+)\)/.exec(h);
                    if (!m) return null;
                    if (m[1].endsWith('_Total')) return { total: true };
                    const core = Number(m[1].split(',').pop());
                    return Number.isFinite(core) ? { core } : null;
                });
                continue;
            }
            if (!cols) continue;
            const cores = [];
            let totalVal = null;
            for (let i = 1; i < cells.length && i < cols.length; i++) {
                const c = cols[i], v = parseFloat(cells[i]);
                if (!c || !Number.isFinite(v)) continue;
                if (c.total) totalVal = v;        // "0,_Total" and "_Total" may both exist
                else cores[c.core] = v;
            }
            if (totalVal !== null) { cpuHist.push(totalVal); if (cpuHist.length > 120) cpuHist.shift(); }
            if (cores.length) coreVals = cores;
            drawGauges();
        }
    });
    child.on('close', () => setTimeout(startPerfStream, 3000));
}

function drawGauges() {
    const cur = cpuHist[cpuHist.length - 1];
    if (cur !== undefined) $('cpu-val').textContent = cur.toFixed(0) + '%';

    const spark = $('cpu-spark'), sctx = spark.getContext('2d');
    sctx.clearRect(0, 0, spark.width, spark.height);
    sctx.strokeStyle = '#5cc8ff';
    sctx.fillStyle = 'rgba(92,200,255,0.12)';
    sctx.lineWidth = 1.5;
    sctx.beginPath();
    const n = cpuHist.length, w = spark.width, h = spark.height;
    for (let i = 0; i < n; i++) {
        const x = w - (n - 1 - i) * (w / 119);
        const y = h - (Math.min(100, cpuHist[i]) / 100) * (h - 2) - 1;
        i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();
    sctx.lineTo(w, h); sctx.lineTo(w - (n - 1) * (w / 119), h);
    sctx.closePath(); sctx.fill();

    const cv = $('cpu-cores'), cctx = cv.getContext('2d');
    cctx.clearRect(0, 0, cv.width, cv.height);
    const nc = coreVals.length || 1, bw = cv.width / nc;
    for (let i = 0; i < coreVals.length; i++) {
        const v = Math.min(100, coreVals[i] || 0) / 100;
        cctx.fillStyle = v > 0.85 ? '#ff6b5c' : v > 0.5 ? '#ffc857' : '#3a9ad9';
        cctx.fillRect(i * bw + 0.5, cv.height * (1 - v), bw - 1, cv.height * v);
    }

    if (totalMemBytes && availMemBytes) {
        const used = totalMemBytes - availMemBytes;
        const frac = used / totalMemBytes;
        $('ram-val').textContent = (frac * 100).toFixed(0) + '%';
        $('ram-sub').textContent =
            (used / 2 ** 30).toFixed(1) + ' / ' + (totalMemBytes / 2 ** 30).toFixed(0) + ' GB';
        const fill = $('ram-fill');
        fill.style.width = (frac * 100).toFixed(1) + '%';
        fill.className = 'fill' + (frac > 0.9 ? ' hot' : frac > 0.75 ? ' warn' : '');
    }
}

// ---------------------------------------------------------------------------
// GPU gauges (nvidia-smi poll)
// ---------------------------------------------------------------------------

let gpuAvailable = true;

function pollGpu() {
    if (!gpuAvailable) return;
    cp.execFile('nvidia-smi', [
        '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
    ], (err, stdout) => {
        if (err) { gpuAvailable = false; return; }
        renderGpus(String(stdout).trim().split('\n').map(l => l.split(',').map(s => s.trim())));
        setTimeout(pollGpu, 2500);
    });
}

function renderGpus(rows) {
    const host = $('gpus');
    for (const r of rows) {
        if (r.length < 6) continue;
        const [idx, name, util, memUsed, memTotal, temp] = r;
        let card = document.getElementById('gpu-' + idx);
        if (!card) {
            card = document.createElement('div');
            card.className = 'gauge';
            card.id = 'gpu-' + idx;
            card.innerHTML = `
                <div class="g-head"><span class="g-label">gpu ${esc(idx)}</span><span class="g-val"></span></div>
                <div class="bar"><div class="fill"></div></div>
                <div class="g-sub"></div>`;
            host.appendChild(card);
        }
        const u = Number(util) || 0;
        card.querySelector('.g-val').textContent = u + '%';
        const fill = card.querySelector('.fill');
        fill.style.width = u + '%';
        fill.className = 'fill' + (u > 90 ? ' hot' : u > 60 ? ' warn' : '');
        card.querySelector('.g-sub').textContent =
            `${esc(name.replace(/^NVIDIA (GeForce )?/, ''))} \u00b7 ${(memUsed / 1024).toFixed(1)}/${(memTotal / 1024).toFixed(0)} GB \u00b7 ${esc(temp)}\u00b0C`;
    }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

startStream();
startEvents();
runEnrich();
startPerfStream();
pollGpu();
