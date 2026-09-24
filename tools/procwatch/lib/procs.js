// procs.js — the process model: what the feeds report, merged and classified.
//
// Three sources update one `world`:
//   snap    a full native-API snapshot every ~2 s (ps/stream.ps1): replaces the set
//   new/del WMI creation / deletion events (ps/events.ps1): patch it between snaps
//   enrich  command lines, paths and start times from WMI (ps/enrich.ps1), slow
// Command lines only come from WMI, so they are kept per pid in `extra` and
// merged into each snapshot. No DOM here: the view reads `world`.

import { summarize } from "./cmdline.js";

export const world = {
    procs: new Map(),         // pid -> proc
    extra: new Map(),         // pid -> { cmd, path, start, ppid } from enrich / events
    prevCpu: new Map(),       // "pid:name" -> { cpu, t } for per-process CPU deltas
    selfPid: 0,               // the engine (parent of the stream child)
    childPids: new Set(),     // our own PowerShell children: never listed or killed
    streamPid: 0,
    live: false,              // a snapshot arrived and the stream is still up
    lastSnapT: 0,
    memTotal: 0, memAvail: 0, cores: 0,
};

const UNIX_NAME_RE = /^(bash|sh|dash|zsh|fish|find|grep|egrep|fgrep|rg|fd|sed|awk|gawk|xargs|tail|head|cat|less|tee|sort|uniq|cut|tr|wc|sleep|yes|make|node|python[\d.]*|perl|ruby|curl|wget|git|ssh|scp|diff|patch)(\.exe)?$/i;
const UNIX_PATH_RE = /[\\/](usr[\\/]bin|msys64|cygwin\d*)[\\/]/i;

// Never killable from this app: by click, "kill shown" or the reaper.
const PROTECTED_NAMES = new Set([
    'system', 'system idle process', 'secure system', 'registry', 'memory compression',
    'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
    'lsass.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe', 'fontdrvhost.exe',
]);

/** 'Sleep.EXE' -> 'sleep'. */
export const baseName = (n) => (n || '').toLowerCase().replace(/\.exe$/, '');

export function isProtected(p) {
    return p.pid <= 4 || PROTECTED_NAMES.has((p.name || '').toLowerCase()) ||
           p.pid === world.selfPid || world.childPids.has(p.pid);
}

export const killable = (p) => !isProtected(p);

/** Derived fields a row shows and the filters test. */
function classify(p, now) {
    const parent = world.procs.get(p.ppid);
    // An orphan's parent is gone, or the pid was reused by a younger process.
    p.orphan = p.pid > 4 && p.ppid > 0 && (!parent || (p.start && parent.start && parent.start > p.start));
    p.parentName = parent ? parent.name : null;
    p.isUnix = UNIX_NAME_RE.test(p.name || '') || UNIX_PATH_RE.test(p.path || '');
    p.isD = /^d:/i.test(p.path || '') || /^"?d:\\/i.test(p.cmd || '');
    p.ageMs = p.start ? Math.max(0, now - p.start) : 0;
    p.isSelf = p.pid === world.selfPid;
    if (!p.sum) p.sum = summarize(p.name, p.cmd, p.path);
    if (p.cores === undefined) p.cores = 0;
    return p;
}

function mergeExtra(p) {
    const ex = world.extra.get(p.pid);
    if (!ex) return;
    if (!p.cmd && ex.cmd) { p.cmd = ex.cmd; p.sum = summarize(p.name, p.cmd, p.path); }
    if (!p.path && ex.path) p.path = ex.path;
    if (!p.start && ex.start) p.start = ex.start;
    if (!p.ppid && ex.ppid) p.ppid = ex.ppid;
}

/** A full snapshot { t, n, mt, mf, procs } replaces the process set. */
export function applySnap(data) {
    world.live = true;
    world.memTotal = data.mt;
    world.memAvail = data.mf;
    world.cores = data.n;
    world.lastSnapT = data.t;

    const stream = data.procs.find((p) => p.pid === world.streamPid);
    if (stream) world.selfPid = stream.ppid;

    const next = new Map();
    const nextCpu = new Map();
    for (const p of data.procs) {
        if (p.pid === 0 || world.childPids.has(p.pid)) continue;
        // cpu is cumulative 100 ns units; delta / (dt * 10000) = fraction of one core.
        const key = p.pid + ':' + p.name;
        const prev = world.prevCpu.get(key);
        p.cores = prev && data.t > prev.t ? Math.max(0, (p.cpu - prev.cpu) / ((data.t - prev.t) * 10000)) : 0;
        nextCpu.set(key, { cpu: p.cpu, t: data.t });
        next.set(p.pid, p);
    }
    world.prevCpu = nextCpu;
    for (const pid of world.extra.keys()) if (!next.has(pid)) world.extra.delete(pid);   // pid reuse guard
    world.procs = next;
    for (const p of next.values()) mergeExtra(p);
    for (const p of next.values()) classify(p, data.t);
}

/** A creation event: remember its command line; list it until the next snap. */
export function applyNew(p) {
    if (!p || !p.pid || world.childPids.has(p.pid)) return;
    world.extra.set(p.pid, { cmd: p.cmd, path: p.path, start: p.start, ppid: p.ppid });
    const now = world.lastSnapT || Date.now();
    const cur = world.procs.get(p.pid);
    if (cur) {
        mergeExtra(cur);
        return;
    }
    if (!p.start) p.start = now;
    world.procs.set(p.pid, p);
    classify(p, now);
}

/** A deletion event. Returns true when the pid was listed. */
export function applyDel(pid) {
    world.extra.delete(pid);
    return world.procs.delete(pid);
}

/** An enrich pass: { procs: [{ pid, ppid, cmd, path, start }] }. */
export function applyEnrich(msg) {
    for (const e of msg.procs || []) {
        if (!e.pid) continue;
        const prev = world.extra.get(e.pid) || {};
        world.extra.set(e.pid, { cmd: e.cmd || prev.cmd, path: e.path || prev.path,
                                 start: e.start || prev.start, ppid: e.ppid ?? prev.ppid });
    }
    if (!world.lastSnapT) return;
    for (const p of world.procs.values()) { mergeExtra(p); classify(p, world.lastSnapT); }
}

// ---- the view's selection --------------------------------------------------------

export const SORTERS = {
    cpu: (a, b) => (Math.round(b.cores * 20) - Math.round(a.cores * 20)) || (a.pid - b.pid),
    mem: (a, b) => (b.mem - a.mem) || (a.pid - b.pid),
    age: (a, b) => (a.ageMs - b.ageMs) || (a.pid - b.pid),
    name: (a, b) => (a.name || '').localeCompare(b.name || '') || (a.pid - b.pid),
};

/**
 * The rows to show. filter: { unix, ddrive, other, orphans, query, sort }.
 * A process shows when one of its checked buckets holds it (unix tool,
 * started from D:, everything else), then orphans-only and the search narrow.
 */
export function visible(filter) {
    const q = (filter.query || '').trim().toLowerCase();
    return [...world.procs.values()].filter((p) => {
        const bucket = (filter.unix && p.isUnix) || (filter.ddrive && p.isD) ||
                       (filter.other && !p.isUnix && !p.isD);
        if (!bucket) return false;
        if (filter.orphans && !p.orphan) return false;
        if (q) {
            const hay = (p.pid + ' ' + (p.name || '') + ' ' + (p.sum ? p.sum.title : '') + ' ' +
                         (p.cmd || '') + ' ' + (p.path || '')).toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }).sort(SORTERS[filter.sort] || SORTERS.cpu);
}
