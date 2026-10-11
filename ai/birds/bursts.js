// bursts.js — group a card's photos into bursts and summarize each one.
//
// A burst is a run of shots taken in quick succession: sorted by capture time
// (EXIF DateTimeOriginal with SubSecTimeOriginal), a shot joins the burst
// before it when it follows the previous shot by at most `gapS` seconds, and
// optionally only when its frame still looks like the previous one (the
// scene check: a small luma thumbnail of each frame aligned to the previous
// one with bro.image.alignSimilarity, split below an NCC threshold).
// Per burst: the consensus species (score-weighted vote over every frame's
// top 5), how many frames agree with it, and the keeper (the sharpest frame
// of the subject; the sharpest whole frame when no frame has an animal).
//
// Pure data in, data out (the scene check takes a function), so the grouping
// is testable without pixels or models.

/** Default gap between shots of one burst, seconds (see README "Bursts"). */
export const DEFAULT_GAP_S = 1.0;

const TIME_RE = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)?$/;

/**
 * A readExif dateTaken ("2026-10-05T11:34:38.56-05:00") as milliseconds.
 * Without an offset the clock time is read as UTC: the camera's local time,
 * which is all a burst's gaps need. Null when it does not parse.
 */
export function parseExifTime(s) {
    const m = typeof s === 'string' && TIME_RE.exec(s.trim());
    if (!m) return null;
    const frac = m[7] ? Number('0.' + m[7]) * 1000 : 0;
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac;
    if (m[8] && m[8] !== 'Z') {
        const sign = m[8][0] === '-' ? -1 : 1;
        const hh = +m[8].slice(1, 3), mm = +m[8].slice(-2);
        t -= sign * (hh * 60 + mm) * 60000;
    }
    return Number.isFinite(t) ? Math.round(t * 1000) / 1000 : null;
}

// The vote of one frame: each of its top-K species adds its score.
function vote(tally, rec) {
    for (const s of rec.species || []) {
        const k = s.scientific || s.common;
        const t = tally.get(k) || { common: s.common, scientific: s.scientific, sum: 0, top1: 0 };
        t.sum += s.score;
        tally.set(k, t);
    }
    const top = rec.species && rec.species[0];
    if (top) tally.get(top.scientific || top.common).top1++;
}

/** The sharpness a keeper is chosen by (see README "Sharpness"). */
export function keeperScore(rec, metric) {
    const sh = rec.sharpness;
    if (!sh) return -1;
    const m = metric || 'tenengrad';
    const pick = (o) => (o ? o[m] : -1);
    return rec.animal && sh.subject ? pick(sh.subject) : pick(sh.frame);
}

/**
 * Group records (photos) into bursts.
 * @param {Object[]} records  each with `path`, `time` (ms or null) and the
 *   per-photo fields of RECORDS.md; records with an `error` are left out.
 * @param {{gapS?:number, sameScene?:(prev:Object, cur:Object)=>({ncc:number, split:boolean}|null),
 *          metric?:'tenengrad'|'laplacianVar'}} [opts]
 * @returns {Object[]} bursts, in time order (RECORDS.md "bursts.jsonl")
 */
export function groupBursts(records, opts) {
    const o = opts || {};
    const gapMs = (o.gapS == null ? DEFAULT_GAP_S : o.gapS) * 1000;
    const shots = records.filter((r) => !r.error).slice().sort((a, b) =>
        (a.time == null) - (b.time == null) || (a.time || 0) - (b.time || 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const groups = [];
    let cur = null;
    for (const r of shots) {
        const prev = cur && cur.shots[cur.shots.length - 1];
        let join = !!prev && prev.time != null && r.time != null && r.time - prev.time <= gapMs;
        let scene = null;
        if (join && o.sameScene) {
            scene = o.sameScene(prev, r);
            if (scene && scene.split) join = false;
        }
        if (join) {
            cur.shots.push(r);
            cur.gaps.push(r.time - prev.time);
            cur.ncc.push(scene ? scene.ncc : null);
        } else {
            const splitBy = prev && prev.time != null && r.time != null && r.time - prev.time <= gapMs ? 'scene' : null;
            cur = { shots: [r], gaps: [], ncc: [], splitBy };
            groups.push(cur);
        }
    }
    return groups.map((g, i) => summarize(g, i + 1, o.metric));
}

function round(x, d) {
    const k = Math.pow(10, d == null ? 3 : d);
    return x == null ? null : Math.round(x * k) / k;
}

function summarize(g, id, metric) {
    const shots = g.shots;
    const animals = shots.filter((r) => r.animal);
    const tally = new Map();
    for (const r of animals) vote(tally, r);
    let best = null;
    for (const t of tally.values()) if (!best || t.sum > best.sum) best = t;
    let keeper = shots[0], keeperScoreV = -Infinity;
    for (const r of animals.length ? animals : shots) {
        const s = keeperScore(r, metric);
        if (s > keeperScoreV) { keeper = r; keeperScoreV = s; }
    }
    const first = shots[0], last = shots[shots.length - 1];
    return {
        id,
        first: first.path,
        start: first.exif && first.exif.dateTaken || null,
        durationS: first.time != null && last.time != null ? round((last.time - first.time) / 1000) : 0,
        count: shots.length,
        animalCount: animals.length,
        species: best ? {
            common: best.common, scientific: best.scientific,
            share: round(best.sum / animals.length, 4),
            agree: best.top1,
        } : null,
        keeper: keeper.path,
        keeperSharpness: round(keeperScoreV, 2),
        startedBy: g.splitBy || 'gap',
        maxGapS: g.gaps.length ? round(Math.max(...g.gaps) / 1000) : null,
        minNcc: g.ncc.some((v) => v != null) ? round(Math.min(...g.ncc.filter((v) => v != null)), 4) : null,
        photos: shots.map((r) => r.path),
    };
}
