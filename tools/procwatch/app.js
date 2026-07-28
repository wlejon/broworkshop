// procwatch — leftover-process monitor + system gauges + auto-reaper.
//
// Three data feeds, all via child_process:
//   1. A PowerShell CIM scan (every 2.5 s) → the process table. CPU per process
//      is computed here in JS from user+kernel time deltas between scans.
//   2. A persistent `typeperf` stream (1 s cadence) → CPU total, per-core bars,
//      available RAM.
//   3. An `nvidia-smi` poll (every 2.5 s) → GPU utilization/VRAM/temp cards.
//      Silently absent on machines without the NVIDIA driver.

import { installSystemMenu } from "/lib/system-menu.js";

const cp = require('child_process');

installSystemMenu();

// ---------------------------------------------------------------------------
// Config (persisted)
// ---------------------------------------------------------------------------

const REAP_DEFAULT_NAMES =
    'find,grep,egrep,fgrep,rg,sed,awk,gawk,sort,uniq,xargs,cat,tail,head,tr,wc,cut,sleep,less,yes';

const cfg = Object.assign({
    reapOn: true,
    reapSecs: 30,
    reapNames: REAP_DEFAULT_NAMES,
    reapNamesCustom: false,
}, loadCfg());
// A stored list only sticks if the user actually edited it — otherwise pick
// up additions to the shipped default.
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
const reapOnEl = $('reap-on'), reapSecsEl = $('reap-secs'), reapNamesEl = $('reap-names'), reapLogEl = $('reap-log');

reapOnEl.checked = cfg.reapOn;
reapSecsEl.value = cfg.reapSecs;
reapNamesEl.value = cfg.reapNames;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const UNIX_NAME_RE = /^(bash|sh|dash|zsh|fish|find|grep|egrep|fgrep|rg|fd|sed|awk|gawk|xargs|tail|head|cat|less|tee|sort|uniq|cut|tr|wc|sleep|make|node|python[\d.]*|perl|ruby|curl|wget|git|ssh|scp|diff|patch)(\.exe)?$/i;
const UNIX_PATH_RE = /[\\/](usr[\\/]bin|msys64|cygwin\d*)[\\/]/i;

// Never killable from this app — by us, by "kill shown", or by the reaper.
const PROTECTED_NAMES = new Set([
    'system', 'system idle process', 'secure system', 'registry', 'memory compression',
    'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
    'lsass.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe', 'fontdrvhost.exe',
]);

const baseName = n => (n || '').toLowerCase().replace(/\.exe$/, '');

function isProtected(p) {
    return p.pid <= 4 || PROTECTED_NAMES.has((p.name || '').toLowerCase()) ||
           p.pid === selfPid || p.pid === scannerPid;
}

// ---------------------------------------------------------------------------
// Process scanner (PowerShell CIM → JSON)
// ---------------------------------------------------------------------------

// Single argv element, no shell anywhere, deliberately free of double quotes.
const PS_SCAN =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    '$cs=@(Get-CimInstance Win32_Process | ForEach-Object { @{' +
    ' pid=[int64]$_.ProcessId; ppid=[int64]$_.ParentProcessId; name=$_.Name;' +
    ' path=$_.ExecutablePath; cmd=$_.CommandLine;' +
    ' start=if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{0};' +
    ' mem=[int64]$_.WorkingSetSize; cpu=[int64]($_.UserModeTime+$_.KernelModeTime) } });' +
    '$os=Get-CimInstance Win32_OperatingSystem;' +
    '@{ t=[DateTimeOffset]::Now.ToUnixTimeMilliseconds(); n=[int][Environment]::ProcessorCount;' +
    ' mt=[int64]$os.TotalVisibleMemorySize*1024; mf=[int64]$os.FreePhysicalMemory*1024; procs=$cs }' +
    ' | ConvertTo-Json -Compress -Depth 4';

let selfPid = 0;          // our own engine process (parent of the scanner child)
let scannerPid = 0;       // the currently running scanner powershell
let snapshot = [];        // enriched procs from the last scan
let totalMemBytes = 0;
let logicalCores = 0;
let prevCpu = new Map();  // "pid:start" → { cpu (100 ns units), t (ms) }
let scanError = null;

function scan() {
    const child = cp.spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_SCAN],
        { stdio: 'pipe', encoding: 'utf8' });
    scannerPid = child.pid;
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.on('close', () => {
        try {
            handleScan(JSON.parse(out));
            scanError = null;
        } catch (e) {
            scanError = String(e);
        }
        render();
        setTimeout(scan, 2500);
    });
}

function handleScan(data) {
    totalMemBytes = data.mt;
    availMemBytes = data.mf;
    logicalCores = data.n;
    drawGauges();
    const now = data.t;
    const byPid = new Map();
    for (const p of data.procs) byPid.set(p.pid, p);

    // Our scanner child's parent is us.
    const scanProc = byPid.get(scannerPid);
    if (scanProc) selfPid = scanProc.ppid;

    const nextCpu = new Map();
    const enriched = [];
    for (const p of data.procs) {
        if (p.pid === 0 || p.pid === scannerPid) continue;
        const key = p.pid + ':' + p.start;
        const prev = prevCpu.get(key);
        // cpu is cumulative 100 ns units; Δ/(Δt·10000) = fraction of one core.
        p.cores = prev && now > prev.t ? Math.max(0, (p.cpu - prev.cpu) / ((now - prev.t) * 10000)) : 0;
        nextCpu.set(key, { cpu: p.cpu, t: now });

        const parent = byPid.get(p.ppid);
        p.orphan = p.pid > 4 && (!parent || parent.start > p.start);
        p.isUnix = UNIX_NAME_RE.test(p.name || '') || UNIX_PATH_RE.test(p.path || '');
        p.isD = /^d:/i.test(p.path || '') || /^"?d:\\/i.test(p.cmd || '');
        p.ageMs = p.start ? Math.max(0, now - p.start) : 0;
        p.isSelf = p.pid === selfPid;
        enriched.push(p);
    }
    prevCpu = nextCpu;
    snapshot = enriched;
    reap(now);
}

// ---------------------------------------------------------------------------
// Auto-reaper
// ---------------------------------------------------------------------------

const reapLog = [];          // { name, pid, at }
const reapInFlight = new Set();

function reapSet() {
    return new Set(cfg.reapNames.split(',').map(s => baseName(s.trim())).filter(Boolean));
}

function reap(now) {
    if (!cfg.reapOn) return;
    const names = reapSet();
    const maxAge = Math.max(5, cfg.reapSecs) * 1000;
    for (const p of snapshot) {
        if (!names.has(baseName(p.name))) continue;
        if (!p.start || p.ageMs < maxAge) continue;
        if (isProtected(p) || reapInFlight.has(p.pid)) continue;
        reapInFlight.add(p.pid);
        kill(p.pid, () => {
            reapInFlight.delete(p.pid);
            reapLog.push({ name: p.name, pid: p.pid, at: now });
            renderReapLog();
        });
    }
}

function renderReapLog() {
    if (!reapLog.length) { reapLogEl.textContent = ''; return; }
    const last = reapLog[reapLog.length - 1];
    reapLogEl.textContent = `reaped ${reapLog.length}  ·  last: ${last.name} #${last.pid}`;
}

function kill(pid, done) {
    cp.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => { if (done) done(); });
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

const armed = new Map();  // pid → arm timestamp (two-click confirm)

function visible() {
    const q = qEl.value.trim().toLowerCase();
    return snapshot.filter(p => {
        const bucket = (chips.unix.checked && p.isUnix) ||
                       (chips.ddrive.checked && p.isD) ||
                       (chips.other.checked && !p.isUnix && !p.isD);
        if (!bucket) return false;
        if (chips.orphans.checked && !p.orphan) return false;
        if (q) {
            const hay = ((p.name || '') + ' ' + (p.cmd || '') + ' ' + (p.path || '')).toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }).sort((a, b) => (b.cores - a.cores) || (b.mem - a.mem));
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

function render() {
    const rows = visible();
    const nowMs = Date.now();
    for (const [pid, t] of armed) if (nowMs - t > 5000) armed.delete(pid);

    tbodyEl.innerHTML = rows.map(p => {
        const cores = p.cores.toFixed(2);
        const cpuCls = p.cores > 3 ? 'pegged' : p.cores > 0.5 ? 'busy' : '';
        const badges =
            (p.isSelf ? '<span class="badge self">this app</span>' : '') +
            (p.orphan ? '<span class="badge orphan">orphan</span>' : '');
        const killable = !isProtected(p) && !p.isSelf;
        const armedCls = armed.has(p.pid) ? ' armed' : '';
        return `<tr data-pid="${p.pid}">
            <td class="c-name">${esc(p.name)}${badges}</td>
            <td class="c-pid">${p.pid}</td>
            <td class="c-cpu ${cpuCls}">${cores}</td>
            <td class="c-mem">${fmtMem(p.mem)}</td>
            <td class="c-age">${fmtAge(p.ageMs)}</td>
            <td class="c-cmd" title="${esc(p.cmd || p.path || '')}">${esc(p.cmd || p.path || '')}</td>
            <td class="c-kill"><button class="kill${armedCls}" data-pid="${p.pid}" ${killable ? '' : 'disabled'}>${armed.has(p.pid) ? 'sure?' : 'kill'}</button></td>
        </tr>`;
    }).join('');

    emptyEl.classList.toggle('hidden', rows.length > 0);
    statusEl.textContent = scanError
        ? 'scan error: ' + scanError
        : `${snapshot.length} processes · showing ${rows.length}` +
          (reapLog.length ? ` · reaped ${reapLog.length}` : '') +
          ` · updated ${new Date().toLocaleTimeString()}`;
}

tbodyEl.addEventListener('click', e => {
    const btn = e.target.closest('button.kill');
    if (!btn || btn.disabled) return;
    const pid = Number(btn.dataset.pid);
    if (armed.get(pid)) {
        armed.delete(pid);
        kill(pid, () => render());
        btn.textContent = '…';
    } else {
        armed.set(pid, Date.now());
        btn.textContent = 'sure?';
        btn.classList.add('armed');
    }
});

const killShownBtn = $('kill-shown');
let killShownArmedAt = 0;
killShownBtn.addEventListener('click', () => {
    const targets = visible().filter(p => !isProtected(p) && !p.isSelf);
    if (Date.now() - killShownArmedAt < 5000) {
        killShownArmedAt = 0;
        killShownBtn.textContent = 'kill shown';
        killShownBtn.classList.remove('armed');
        for (const p of targets) kill(p.pid);
        setTimeout(render, 600);
    } else {
        killShownArmedAt = Date.now();
        killShownBtn.textContent = `sure? (${targets.length})`;
        killShownBtn.classList.add('armed');
    }
});

for (const el of Object.values(chips)) el.addEventListener('change', render);
qEl.addEventListener('input', render);

reapOnEl.addEventListener('change', () => { cfg.reapOn = reapOnEl.checked; saveCfg(); });
reapSecsEl.addEventListener('change', () => { cfg.reapSecs = Number(reapSecsEl.value) || 30; saveCfg(); });
reapNamesEl.addEventListener('change', () => {
    cfg.reapNames = reapNamesEl.value;
    cfg.reapNamesCustom = cfg.reapNames !== REAP_DEFAULT_NAMES;
    saveCfg();
});

// ---------------------------------------------------------------------------
// CPU + RAM gauges (persistent typeperf stream, 1 s cadence)
// ---------------------------------------------------------------------------

const cpuHist = [];               // last 120 samples of total %
let coreVals = [];                // current per-core %
let availMemBytes = 0;

function startPerfStream() {
    const child = cp.spawn('typeperf', [
        '\\Processor Information(*)\\% Processor Time',
        '-si', '1',
    ], { stdio: 'pipe', encoding: 'utf8' });

    let tail = '';
    let cols = null;              // per column: {core: n} | {total: true} | {mem: true}
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
            `${esc(name.replace(/^NVIDIA (GeForce )?/, ''))} · ${(memUsed / 1024).toFixed(1)}/${(memTotal / 1024).toFixed(0)} GB · ${esc(temp)}°C`;
    }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

scan();
startPerfStream();
pollGpu();
