// feeds.js — every external process procwatch runs, and the OS actions.
//
//   ps/stream.ps1   persistent: a native-API snapshot every ~2 s (no WMI, so it never stalls)
//   ps/events.ps1   persistent: WMI create/delete events (registration can take a minute)
//   ps/enrich.ps1   short-lived, at start and every 60 s: command lines from WMI (8+ s on
//                   a WMI-degraded machine, which is why it is never in the tick path)
//   typeperf        persistent: total + per-core CPU once a second
//   nvidia-smi      polled every 2.5 s; absent without the NVIDIA driver
// Persistent children restart two seconds after they exit. Each child's pid
// is registered in world.childPids so the table and the reaper skip it.

import { world } from "./procs.js";

const cp = require('child_process');
export const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const script = (name) => bro.appDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/ps/' + name;

/** Split a chunked stdout stream into lines; fn(line) for each complete one. */
export function lineSplitter(fn) {
    let tail = '';
    return (chunk) => {
        tail += chunk;
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const line of lines) fn(line.replace(/\r$/, ''));
    };
}

/** Parse NDJSON lines; malformed lines are skipped. */
function ndjson(fn) {
    return lineSplitter((line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        fn(msg);
    });
}

function powershell(name) {
    const child = cp.spawn('powershell.exe', [...PS_ARGS, script(name)], { stdio: 'pipe', encoding: 'utf8' });
    world.childPids.add(child.pid);
    child.on('close', () => world.childPids.delete(child.pid));
    return child;
}

/** A persistent NDJSON PowerShell child, restarted when it exits. onClose runs first. */
function persistent(name, onMsg, onClose) {
    const start = () => {
        const child = powershell(name);
        child.stdout.on('data', ndjson(onMsg));
        child.on('close', () => { if (onClose) onClose(); setTimeout(start, 2000); });
        return child;
    };
    return start();
}

/**
 * Start the process feeds. handlers: { snap(msg), created(proc), deleted(pid),
 * enriched(msg), down() } — down when the snapshot stream exits (it restarts).
 */
export function startProcessFeeds(handlers) {
    if (!isWindows) return;
    const stream = persistent('stream.ps1', (m) => {
        if (m.e === 'snap') handlers.snap(m);
        else if (m.e === 'new') handlers.created(m.p);
        else if (m.e === 'del') handlers.deleted(m.id);
    }, () => { world.live = false; handlers.down(); });
    world.streamPid = stream.pid;
    persistent('events.ps1', (m) => {
        if (m.e === 'new') handlers.created(m.p);
        else if (m.e === 'del') handlers.deleted(m.id);
    });
    const enrich = () => {
        const child = powershell('enrich.ps1');
        let out = '';
        child.stdout.on('data', (c) => { out += c; });
        child.on('close', () => {
            try { handlers.enriched(JSON.parse(out.trim())); } catch {}
            setTimeout(enrich, 60000);
        });
    };
    enrich();
}

/**
 * typeperf's CSV stream -> onSample(totalPercent | null, perCorePercents[]).
 * The header row names the columns ("\\host\Processor Information(0,3)\% Processor Time").
 */
export function startCpuFeed(onSample) {
    if (!isWindows) return;
    const start = () => {
        const child = cp.spawn('typeperf', ['\\Processor Information(*)\\% Processor Time', '-si', '1'],
                               { stdio: 'pipe', encoding: 'utf8' });
        let cols = null;
        child.stdout.on('data', lineSplitter((raw) => {
            const line = raw.trim();
            if (!line.startsWith('"')) return;
            const cells = line.slice(1, -1).split('","');
            if (line.includes('PDH-CSV')) { cols = cpuColumns(cells); return; }
            if (!cols) return;
            const cores = [];
            let total = null;
            for (let i = 1; i < cells.length && i < cols.length; i++) {
                const c = cols[i], v = parseFloat(cells[i]);
                if (!c || !Number.isFinite(v)) continue;
                if (c.total) total = v;                 // "0,_Total" and "_Total" may both exist
                else cores[c.core] = v;
            }
            onSample(total, cores);
        }));
        child.on('close', () => setTimeout(start, 3000));
    };
    start();
}

export function cpuColumns(header) {
    return header.map((h) => {
        const m = /Processor Information\(([^)]+)\)/.exec(h);
        if (!m) return null;
        if (m[1].endsWith('_Total')) return { total: true };
        const core = Number(m[1].split(',').pop());
        return Number.isFinite(core) ? { core } : null;
    });
}

/** nvidia-smi rows -> onCards([{ idx, name, util, memUsed, memTotal, temp }]); stops when absent. */
export function startGpuFeed(onCards) {
    const poll = () => cp.execFile('nvidia-smi', [
        '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
    ], (err, stdout) => {
        if (err) return;                           // no driver: no GPU cards, stop polling
        onCards(parseGpuCsv(String(stdout)));
        setTimeout(poll, 2500);
    });
    poll();
}

export function parseGpuCsv(text) {
    return text.trim().split('\n').map((l) => l.split(',').map((s) => s.trim()))
        .filter((r) => r.length >= 6)
        .map(([idx, name, util, memUsed, memTotal, temp]) => ({
            idx, name, util: Number(util) || 0, memUsed: Number(memUsed) || 0,
            memTotal: Number(memTotal) || 0, temp,
        }));
}

/** Total / free RAM from Node's os module, for platforms without the stream. */
export function osMemory() {
    try {
        const os = require('os');
        return { total: os.totalmem(), free: os.freemem() };
    } catch { return null; }
}

// ---- actions --------------------------------------------------------------------

/** Kill a pid (and its tree), then done(). */
export function kill(pid, tree, done) {
    if (isWindows) {
        const args = ['/PID', String(pid)];
        if (tree) args.push('/T');
        args.push('/F');
        cp.execFile('taskkill', args, () => { if (done) done(); });
        return;
    }
    try { process.kill(pid, 'SIGKILL'); } catch {}
    if (done) done();
}

/** Show a file in the OS file manager. */
export function reveal(path) {
    if (isWindows) cp.spawn('explorer.exe', ['/select,' + path]);
    else if (process.platform === 'darwin') cp.spawn('open', ['-R', path]);
    else cp.spawn('xdg-open', [require('path').dirname(path)]);
}
