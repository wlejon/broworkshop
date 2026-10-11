// batch.js — process a folder of photos into records (process.js is the CLI).
//
// For every photo (recursive; JPEG and Canon CR3, a RAW+JPEG pair processed
// once through its JPEG): decode, EXIF, the per-photo analysis of
// bro.vision.wildlife (OWLv2 animal detection, BioCLIP species top 5 on the
// subject square), sharpness of the subject and of the whole frame, and a
// small luma thumbnail; then the photos are grouped into bursts
// (wildlife.groupBursts). Records, bursts, meta and a report go to the output
// directory (store.js, RECORDS.md); a photo whose path, size and mtime (and
// processing config) match its record is not processed again.
//
// The CPU half (decode, EXIF, sharpness, thumbnail) runs in decode-worker.js
// workers, so the next photos decode while this thread runs the models on
// the GPU. Headless only: it waits for the workers with advanceTime/wallSleep.
//
//   import { runBatch } from "/app/batch.js";
//   const result = runBatch({ input, output, model: 'bioclip-2' });

import { fileKey, readJsonl, writeJsonl, writeAtomic, appender, toBase64, fromBase64 } from "/app/store.js";
import { writeReport } from "/app/report.js";

const fs = require('fs');
const pathMod = require('path');
const wildlife = bro.vision.wildlife;

export const SCHEMA = 1;

/** Defaults; every one is a process.js option (README "Batch processing"). */
export const DEFAULTS = {
    model: wildlife.DEFAULTS.model,          // 'bioclip-2', or 'bioclip'
    threshold: wildlife.DEFAULTS.threshold,
    gapS: wildlife.DEFAULTS.gapS,
    sceneNcc: 0,                 // 0: no scene split (README "Bursts")
    metric: 'tenengrad',         // the keeper's sharpness measure
    detectSize: 1280,            // detection/classification image, long side
    sharpSize: 3000,             // sharpness image, long side
    thumbSize: 96,               // scene-check thumbnail, long side
    topK: wildlife.DEFAULTS.topK,
    margin: wildlife.DEFAULTS.margin,        // subject square padding
    labelThreshold: wildlife.DEFAULTS.labelThreshold,   // the report's labelled / unidentified (0.85)
    workers: 3,
    noModels: false,             // decode/EXIF/sharpness/bursts only
    force: false,
    limit: 0,
    progressS: 10,
};

const PHOTO_EXT = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.cr3': 'cr3' };

// Paths are recorded with forward slashes on every OS (Windows takes them too),
// so records, pairs and keys read the same wherever the card was processed.
const slash = (p) => String(p).replace(/\\/g, '/');

/** Is `child` the directory `parent` or inside it? (absolute, normalized paths;
 *  case-insensitive on Windows, whose file system is) */
export function isInside(child, parent) {
    const norm = (s) => {
        const t = slash(s).replace(/\/+$/, '') + '/';
        return process.platform === 'win32' ? t.toLowerCase() : t;
    };
    return norm(child).startsWith(norm(parent));
}

// The real path of `p`, or of its nearest existing ancestor plus the rest.
function realish(p) {
    let head = pathMod.resolve(p), tail = '';
    for (;;) {
        try { return slash(pathMod.join(fs.realpathSync(head), tail)); } catch (_) {}
        const up = pathMod.dirname(head);
        if (up === head) return slash(pathMod.resolve(p));
        tail = pathMod.join(pathMod.basename(head), tail);
        head = up;
    }
}

/**
 * The photos under `root`: one shot per JPEG (its same-named CR3, if any, is
 * its `pair`) or per CR3 without a JPEG. Other files are counted by extension.
 */
export function scanPhotos(root) {
    const byStem = new Map(), skipped = {};
    let files = 0;
    const walk = (dir) => {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            const p = slash(pathMod.join(dir, e.name));
            if (e.isDirectory()) { walk(p); continue; }
            files++;
            const ext = pathMod.extname(e.name).toLowerCase();
            const kind = PHOTO_EXT[ext];
            if (!kind) { skipped[ext || '(none)'] = (skipped[ext || '(none)'] || 0) + 1; continue; }
            const stem = pathMod.join(dir, e.name.slice(0, e.name.length - ext.length)).toLowerCase();
            const s = byStem.get(stem) || {};
            s[kind] = p;
            byStem.set(stem, s);
        }
    };
    walk(root);
    const shots = [];
    for (const s of byStem.values()) {
        if (s.jpeg) shots.push({ path: s.jpeg, format: 'jpeg', pair: s.cr3 || null });
        else shots.push({ path: s.cr3, format: 'cr3', pair: null });
    }
    shots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { shots, skipped, files };
}

// FNV-1a, for the config hash.
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
}

// The analyzer's options: the models through bro.models, the run's settings.
function wildlifeOpts(o) {
    return { model: o.model, threshold: o.threshold, topK: o.topK, margin: o.margin };
}

// The settings a record depends on. A record made under a different config
// is processed again. With models: wildlife.config (models and revisions,
// threshold, queries, topK, margin, the species list), read without loading.
function processingConfig(o) {
    const c = {
        schema: SCHEMA, detectSize: o.detectSize, sharpSize: o.sharpSize, thumbSize: o.thumbSize,
        models: !o.noModels,
    };
    if (!o.noModels) Object.assign(c, wildlife.config(wildlifeOpts(o)));
    return c;
}

function r1(x) { return Math.round(x * 10) / 10; }

// Wait for worker messages: a turn of the headless loop delivers them
// (advanceTime(0) runs no turn, so one virtual millisecond), and real time
// passes for the workers.
function pump() {
    advanceTime(1);
    wallSleep(1);
}

function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
}

/**
 * Run the batch. Returns { meta, records, bursts } (what was written).
 * @param {Object} opts  DEFAULTS plus input, output (directories), log(fn)
 */
export function runBatch(opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const log = o.log || ((s) => console.log(s));
    const t0 = Date.now();
    if (!o.input || !o.output) throw new Error('runBatch: input and output are required');
    const input = realish(o.input), output = realish(o.output);
    if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) throw new Error('not a directory: ' + input);
    if (isInside(output, input))
        throw new Error('the output directory ' + output + ' is inside the photo folder ' + input +
                        '; records never go beside the photos');
    fs.mkdirSync(output, { recursive: true });

    // Models and their config.
    let analyzer = null;
    if (!o.noModels) {
        const loc = wildlife.locate(wildlifeOpts(o));
        if (loc.missing.length) {
            throw new Error('missing ' + loc.missing.map((k) => k + ' (' + (loc[k] || 'not found by bro.models') + ')').join(', ') +
                            '; or pass --no-models');
        }
    }
    const config = processingConfig(o);
    const configHash = fnv1a(JSON.stringify(config));

    // What is there, and what needs doing.
    const scan = scanPhotos(input);
    let shots = scan.shots;
    if (o.limit > 0) shots = shots.slice(0, o.limit);
    const recFile = output + '/records.jsonl', thumbFile = output + '/thumbs.jsonl';
    const old = readJsonl(recFile), oldThumbs = readJsonl(thumbFile);
    const records = new Map(), thumbs = new Map(), todo = [];
    for (const s of shots) {
        let st;
        try { st = fs.statSync(s.path); } catch (e) {
            records.set(s.path, { v: SCHEMA, path: s.path, key: null, config: configHash, error: 'stat: ' + e.message, stage: 'stat' });
            continue;
        }
        s.key = fileKey(st);
        s.size = st.size;
        s.mtimeMs = Math.round(st.mtimeMs);
        const prev = old.get(s.path);
        if (!o.force && prev && prev.key === s.key && prev.config === configHash) {
            prev.pair = s.pair;
            records.set(s.path, prev);
            const th = oldThumbs.get(s.path);
            if (th && th.key === s.key) thumbs.set(s.path, th);
            continue;
        }
        todo.push(s);
    }
    const reused = shots.length - todo.length;
    log(`birds: ${shots.length} photos in ${input} (${scan.files} files; ${reused} unchanged, ${todo.length} to process)`);

    if (todo.length && !o.noModels) {
        const tl = Date.now();
        analyzer = wildlife.open(Object.assign(wildlifeOpts(o),
            { cacheDir: bro.app && bro.app.cacheDir ? bro.app.cacheDir + '/species' : false }));
        log(`birds: models loaded in ${Date.now() - tl} ms (OWLv2 on ${analyzer.device}, ` +
            `${pathMod.basename(analyzer.paths.classifier)})`);
    }

    // ── the pipeline ─────────────────────────────────────────────────────
    const stage = { decode: [], exif: [], sharpness: [], thumb: [], detect: [], classify: [], subject: [], wait: [] };
    const out = appender(recFile), thumbOut = appender(thumbFile);
    const nWorkers = Math.max(1, Math.min(o.workers, todo.length));
    const workers = [];
    const inbox = [];
    const spawn = (wk) => {
        const w = new Worker('decode-worker.js');
        w.onmessage = (e) => { inbox.push({ w, m: e.data }); };
        w.onerror = (e) => { inbox.push({ w, m: { id: -1, workerError: 'worker error: ' + ((e && e.message) || e) } }); };
        wk.w = w;
        wk.busy = 0;
        return wk;
    };
    for (let i = 0; i < (todo.length ? nWorkers : 0); i++) workers.push(spawn({}));
    const pending = new Map();      // id -> { shot, rec, worker }
    let next = 0, done = 0, errors = 0, lastLog = Date.now(), workT = Date.now();
    const maxPerWorker = 2;

    const finish = (p, rec) => {
        pending.delete(p.id);
        p.worker.busy--;
        records.set(rec.path, rec);
        out.add(rec);
        done++;
        if (rec.error) errors++;
        if (Date.now() - lastLog > o.progressS * 1000 || done === todo.length) {
            lastLog = Date.now();
            const rate = done / Math.max((Date.now() - workT) / 1000, 1e-3);
            log(`  [${done}/${todo.length}] ${(100 * done / todo.length).toFixed(1)}%  ${rate.toFixed(2)} photos/s` +
                `  ETA ${Math.round((todo.length - done) / Math.max(rate, 1e-3))} s  errors ${errors}`);
        }
    };
    const fail = (p, stageName, msg) => {
        finish(p, { v: SCHEMA, path: p.shot.path, size: p.shot.size, mtimeMs: p.shot.mtimeMs, key: p.shot.key,
                    config: configHash, format: p.shot.format, pair: p.shot.pair,
                    processedAt: new Date().toISOString(), error: String(msg), stage: stageName });
        log(`  error: ${p.shot.path}: ${stageName}: ${msg}`);
    };
    // A worker that died or stopped answering: its photos fail, a new one
    // takes its place (late answers from the old one find nothing pending).
    const restart = (wk, why) => {
        for (const p of [...pending.values()]) {
            if (p.worker !== wk) continue;
            if (p.rec) { p.rec.sharpness.subject = null; finish(p, p.rec); }
            else fail(p, 'worker', why);
        }
        try { wk.w.terminate(); } catch (_) {}
        spawn(wk);
    };
    const STALL_MS = 120000;

    while (done < todo.length) {
        // Keep every worker fed.
        for (const wk of workers) {
            while (wk.busy < maxPerWorker && next < todo.length) {
                const shot = todo[next];
                const id = next++;
                pending.set(id, { id, shot, worker: wk, rec: null });
                wk.busy++;
                wk.w.postMessage({ cmd: 'decode', id, path: shot.path, detectSize: o.detectSize,
                                   sharpSize: o.sharpSize, thumbSize: o.thumbSize });
            }
        }
        if (!inbox.length) {
            const tw = Date.now();
            while (!inbox.length && Date.now() - tw < STALL_MS) pump();
            stage.wait.push(Date.now() - tw);
            if (!inbox.length) {
                for (const wk of workers) if (wk.busy) restart(wk, 'no answer in ' + STALL_MS / 1000 + ' s');
                continue;
            }
        }
        const { w: from, m } = inbox.shift();
        if (m.workerError) {
            const wk = workers.find((x) => x.w === from);
            log('  ' + m.workerError);
            if (wk) restart(wk, m.workerError);
            continue;
        }
        const p = pending.get(m.id);
        if (!p || p.worker.w !== from) continue;
        if (!m.ok && p.rec) {
            // Only the subject's sharpness is missing.
            p.rec.sharpness.subject = null;
            finish(p, p.rec);
            continue;
        }
        if (!m.ok) { fail(p, m.stage || 'decode', m.error); continue; }
        if (p.rec) {
            // The subject's sharpness: the record is complete.
            p.rec.sharpness.subject = m.subject;
            p.rec.timing.subject = m.ms;
            stage.subject.push(m.ms);
            finish(p, p.rec);
        } else {
            let rec;
            try { rec = analyze(p, m); } catch (e) {
                p.worker.w.postMessage({ cmd: 'drop', id: p.id });
                fail(p, 'analyze', (e && e.message) || e);
                continue;
            }
            thumbs.set(rec.path, { path: rec.path, key: rec.key, width: m.thumb.width, height: m.thumb.height,
                                   luma: toBase64(m.thumb.luma) });
            thumbOut.add(thumbs.get(rec.path));
            for (const k of ['decode', 'exif', 'sharpness', 'thumb']) stage[k].push(m.ms[k]);
            if (rec.timing.detect != null) stage.detect.push(rec.timing.detect);
            if (rec.timing.classify != null) stage.classify.push(rec.timing.classify);
            p.rec = rec;
            if (rec.animal) p.worker.w.postMessage({ cmd: 'subject', id: p.id, box: rec.detections[0].box,
                                                     sourceWidth: rec.width, sourceHeight: rec.height });
            else { p.worker.w.postMessage({ cmd: 'drop', id: p.id }); finish(p, rec); }
        }
    }
    for (const wk of workers) wk.w.terminate();
    const loopMs = Date.now() - workT;

    // The GPU half of one photo: detect, classify, the record.
    function analyze(p, m) {
        const shot = p.shot;
        const exif = m.exif || null;
        const time = exif && exif.dateTaken ? wildlife.parseExifTime(exif.dateTaken) : null;
        const rec = {
            v: SCHEMA, path: shot.path, size: shot.size, mtimeMs: shot.mtimeMs, key: shot.key, config: configHash,
            format: shot.format, pair: shot.pair, processedAt: new Date().toISOString(),
            width: m.source.width, height: m.source.height, decodePath: m.decodePath,
            exif: pickExif(exif),
            time: time != null ? time : shot.mtimeMs, timeSource: time != null ? 'exif' : 'mtime',
            animal: null, detections: [], subject: null, species: [],
            sharpness: { scale: Math.max(m.sharp.width, m.sharp.height), frame: m.frame, subject: null },
            timing: Object.assign({}, m.ms),
        };
        if (o.noModels) return rec;
        // Detections and subject in the photo's pixels (RECORDS.md).
        const a = analyzer.analyze(m.image, { source: m.source });
        rec.animal = a.animal;
        rec.detections = a.detections;
        rec.subject = a.subject;
        rec.species = a.species;
        rec.timing.detect = a.timing.detect;
        if (a.animal) rec.timing.classify = a.timing.classify;
        return rec;
    }

    // ── compaction, bursts, meta, report ─────────────────────────────────
    const current = shots.map((s) => records.get(s.path)).filter(Boolean)
        .sort((a, b) => (a.time || 0) - (b.time || 0) || (a.path < b.path ? -1 : 1));
    const removed = [...old.keys()].filter((p) => !records.has(p)).length;
    writeJsonl(recFile, current);
    writeJsonl(thumbFile, current.map((r) => thumbs.get(r.path)).filter(Boolean));

    const sceneCache = new Map();
    const sameScene = (a, b) => {
        const ta = thumbs.get(a.path), tb = thumbs.get(b.path);
        if (!ta || !tb) return null;
        const k = a.path + '\n' + b.path;
        if (!sceneCache.has(k)) sceneCache.set(k, sceneNcc(ta, tb));
        const ncc = sceneCache.get(k);
        return { ncc, split: o.sceneNcc > 0 && ncc < o.sceneNcc };
    };
    const bursts = wildlife.groupBursts(current,{ gapS: o.gapS, sameScene, metric: o.metric });
    writeJsonl(output + '/bursts.jsonl', bursts);
    const labels = labelCounts(current, bursts, o.labelThreshold);

    const wallMs = Date.now() - t0;
    const timing = {};
    for (const k of Object.keys(stage)) {
        const a = stage[k];
        timing[k] = { n: a.length, meanMs: a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : 0,
                      medianMs: median(a), totalMs: a.reduce((x, y) => x + y, 0) };
    }
    const meta = {
        schema: SCHEMA,
        tool: 'broworkshop ai/birds/process.js',
        input, output,
        configHash, config,
        options: { gapS: o.gapS, sceneNcc: o.sceneNcc, metric: o.metric, labelThreshold: o.labelThreshold,
                   workers: nWorkers, force: !!o.force, limit: o.limit },
        engine: { exePath: (bro.app && bro.app.exePath) || null, device: analyzer ? analyzer.device : null },
        run: {
            startedAt: new Date(t0).toISOString(), wallMs,
            photos: shots.length, files: scan.files, skippedFiles: scan.skipped,
            processed: todo.length, reused, errors: current.filter((r) => r.error).length, removed,
            pairs: shots.filter((s) => s.pair).length,
            msPerPhoto: todo.length ? r1(loopMs / todo.length) : 0,
            timing,
            labels,
        },
        history: [],
    };
    // Earlier runs into this directory, newest last (the last 50).
    try {
        const prev = JSON.parse(String(fs.readFileSync(output + '/meta.json', 'utf-8')));
        if (Array.isArray(prev.history)) meta.history = prev.history.slice(-49);
    } catch (_) {}
    meta.history.push({ startedAt: meta.run.startedAt, wallMs, processed: todo.length, reused, errors: meta.run.errors,
                        msPerPhoto: meta.run.msPerPhoto, configHash });
    writeAtomic(output + '/meta.json', JSON.stringify(meta, null, 2) + '\n');
    writeReport(output + '/summary.md', { meta, records: current, bursts });
    log(`birds: ${todo.length} processed, ${reused} unchanged, ${meta.run.errors} errors, ${bursts.length} bursts; ` +
        `${(wallMs / 1000).toFixed(1)} s. ${output}/summary.md`);
    if (!o.noModels) {
        log(`birds: at ${labels.threshold}: ${labels.photos.labelled} photos labelled, ${labels.photos.unidentified} unidentified; ` +
            `${labels.bursts.labelled} bursts labelled, ${labels.bursts.unidentified} unidentified`);
    }
    return { meta, records: current, bursts };
}

/**
 * Photos and bursts with an animal, split by bro.vision.wildlife.label() at
 * `threshold`: labelled (a name at or over it) or unidentified (an animal
 * without one). A photo is labelled by its burst's consensus (RECORDS.md).
 */
export function labelCounts(records, bursts, threshold) {
    const byPath = new Map();
    for (const b of bursts) for (const p of b.photos) byPath.set(p, b);
    const opts = { labelThreshold: threshold };
    const out = { threshold, photos: { animal: 0, labelled: 0, unidentified: 0 },
                  bursts: { animal: 0, labelled: 0, unidentified: 0 } };
    const count = (k, animal, named) => {
        if (!animal) return;
        out[k].animal++;
        out[k][named ? 'labelled' : 'unidentified']++;
    };
    for (const r of records) {
        if (r.error) continue;
        const b = byPath.get(r.path) || null;
        count('photos', r.animal === true || !!(b && b.species), wildlife.label(r, b, opts));
    }
    for (const b of bursts) count('bursts', !!b.species, wildlife.label(null, b, opts));
    return out;
}

// The EXIF fields a record keeps (all optional, as readExif gives them).
const EXIF_KEYS = ['dateTaken', 'subSecTime', 'offsetTime', 'make', 'model', 'lensModel', 'focalLength',
                   'focalLength35mm', 'exposureTime', 'exposureTimeText', 'fNumber', 'iso',
                   'latitude', 'longitude', 'altitude', 'orientation'];
function pickExif(e) {
    if (!e) return null;
    const out = {};
    for (const k of EXIF_KEYS) if (e[k] !== undefined) out[k] = e[k];
    return out;
}

/**
 * How alike two frames are: their luma thumbnails aligned (a translation of
 * up to ~8 px, plus gain/bias) and correlated, -1..1. Translation only: with
 * scale and rotation free, a 96 px thumbnail of one scene can be bent onto
 * an unrelated one. Different sizes (a portrait after a landscape) are not
 * the same scene: -1.
 */
export function sceneNcc(ta, tb) {
    if (ta.width !== tb.width || ta.height !== tb.height) return -1;
    const a = typeof ta.luma === 'string' ? fromBase64(ta.luma) : ta.luma;
    const b = typeof tb.luma === 'string' ? fromBase64(tb.luma) : tb.luma;
    const r = bro.image.alignSimilarity(a, b, { width: ta.width, height: ta.height, channels: 1,
                                                levels: 1, search: 4, similarity: false });
    return Math.round(r.ncc * 1e4) / 1e4;
}
