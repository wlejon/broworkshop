// Shared dataset path & shell execution utilities for sci-atlas demos.
// Runs in both main window pages and headless/worker contexts (uses brokit fs/path/cp).

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

export const APP_DATA_ROOT_NAME = 'sci-atlas';

export function resolveDataDir() {
    const candidates = [];
    try {
        const p = globalThis.process || require('process');
        if (p && p.env && p.env.BRO_SCI_DATA) {
            candidates.push(p.env.BRO_SCI_DATA);
        }
    } catch (_) {}

    // Sibling of broworkshop checkout (e.g. D:/projects/bro-data/sci-atlas)
    try {
        const cwd = process.cwd();
        const normCwd = cwd.replace(/\\/g, '/');
        const idx = normCwd.toLowerCase().lastIndexOf('/broworkshop');
        if (idx >= 0) {
            const parent = normCwd.slice(0, idx);
            candidates.push(parent + '/bro-data/' + APP_DATA_ROOT_NAME);
        }
    } catch (_) {}

    candidates.push('D:/projects/bro-data/' + APP_DATA_ROOT_NAME);
    candidates.push('../bro-data/' + APP_DATA_ROOT_NAME);

    for (const c of candidates) {
        if (!c) continue;
        try {
            if (fs.existsSync(c) || fs.existsSync(path.dirname(path.dirname(c)))) {
                return c.replace(/\\/g, '/');
            }
        } catch (_) {}
    }

    try {
        if (globalThis.bro && bro.app && bro.app.dataDir) {
            return (bro.app.dataDir + '/' + APP_DATA_ROOT_NAME).replace(/\\/g, '/');
        }
    } catch (_) {}

    return candidates[0] || (os.tmpdir().replace(/\\/g, '/') + '/' + APP_DATA_ROOT_NAME);
}

export function resolveDataFile(filename) {
    const dir = resolveDataDir();
    return dir + '/' + filename;
}

export function hasRealDataFile(filename) {
    try {
        const full = resolveDataFile(filename);
        return fs.existsSync(full) && fs.statSync(full).size > 256;
    } catch (_) {
        return false;
    }
}

export function ensureDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
    } catch (_) {}
    return dirPath;
}

export function fmtInt(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString();
}

export function fmtMs(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    return ms < 1 ? (ms.toFixed(2) + ' ms') : (ms < 10 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms');
}

export function fmtBytes(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

export function runExec(file, args, opts = {}) {
    const res = cp.spawnSync(file, args || [], Object.assign({
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
    }, opts));
    return res;
}
