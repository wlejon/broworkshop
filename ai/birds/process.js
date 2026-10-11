// process.js — batch-process a folder of bird photos (headless).
//
//   bro-headless ai/birds ai/birds/process.js -- <photo folder> <output dir> [options]
//
// Every photo under the folder (recursive; JPEG and Canon CR3, a RAW+JPEG
// pair once through its JPEG; videos skipped) gets a record: EXIF, the
// animals OWLv2 finds, BioCLIP's top 5 species and taxa on each of them,
// sharpness; then bursts with their consensus and keeper, and the labels. Everything is written
// under the output dir, never beside the photos (RECORDS.md); a re-run skips
// photos that did not change. See README.md "Batch processing" and batch.js.
//
// Options:
//   --model bioclip-2|bioclip   species model (default bioclip-2)
//   --threshold N               OWLv2 score threshold (default 0.15)
//   --label-threshold N         score a label needs in the report (default 0.85; byQuery's fallback too)
//   --candidates all|byQuery    a crop's softmax over every species, or its query's classes (default all)
//   --max-classify N            animal boxes classified a photo, best first (default 8)
//   --gap S                     max seconds between shots of a burst (default 1.0)
//   --scene-ncc N               also split a burst where the frame changes, NCC < N (default 0: off)
//   --metric tenengrad|laplacianVar   keeper sharpness measure (default tenengrad)
//   --workers N                 decode workers (default 3)
//   --no-models                 decode, EXIF, sharpness and bursts only
//   --force                     process every photo again
//   --limit N                   only the first N photos (by path)
//   --progress S                progress line every S seconds (default 10)

import { runBatch, DEFAULTS } from "/app/batch.js";

const pathMod = require('path');

const USAGE = 'usage: bro-headless ai/birds ai/birds/process.js -- <photo folder> <output dir> ' +
    '[--model bioclip-2|bioclip] [--threshold N] [--label-threshold N] [--candidates all|byQuery] [--max-classify N] [--gap S] [--scene-ncc N] [--metric tenengrad|laplacianVar] ' +
    '[--workers N] [--no-models] [--force] [--limit N] [--progress S]';

function parse(argv) {
    const o = {}, pos = [];
    const num = (k, v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(k + ' needs a number, got ' + v);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const val = () => {
            if (i + 1 >= argv.length) throw new Error(a + ' needs a value');
            return argv[++i];
        };
        if (a === '--') continue;
        else if (a === '--model') o.model = val();
        else if (a === '--threshold') o.threshold = num(a, val());
        else if (a === '--label-threshold') o.labelThreshold = num(a, val());
        else if (a === '--candidates') o.candidates = val();
        else if (a === '--max-classify') o.maxClassify = num(a, val());
        else if (a === '--gap') o.gapS = num(a, val());
        else if (a === '--scene-ncc') o.sceneNcc = num(a, val());
        else if (a === '--metric') o.metric = val();
        else if (a === '--workers') o.workers = num(a, val());
        else if (a === '--limit') o.limit = num(a, val());
        else if (a === '--progress') o.progressS = num(a, val());
        else if (a === '--no-models') o.noModels = true;
        else if (a === '--force') o.force = true;
        else if (a === '-h' || a === '--help') { o.help = true; }
        else if (a.startsWith('--')) throw new Error('unknown option ' + a);
        else pos.push(a);
    }
    if (o.model && !['bioclip', 'bioclip-2'].includes(o.model)) throw new Error('--model is bioclip-2 or bioclip');
    if (o.candidates && !['all', 'byQuery'].includes(o.candidates)) throw new Error('--candidates is all or byQuery');
    if (o.maxClassify != null && !(o.maxClassify >= 1)) throw new Error('--max-classify is 1 or more');
    if (o.metric && !['tenengrad', 'laplacianVar'].includes(o.metric)) throw new Error('--metric is tenengrad or laplacianVar');
    if (pos.length !== 2 && !o.help) throw new Error('need <photo folder> <output dir>');
    const cwd = (bro.app && bro.app.cwd) || process.cwd();
    o.input = pos[0] && pathMod.resolve(cwd, pos[0]);
    o.output = pos[1] && pathMod.resolve(cwd, pos[1]);
    return o;
}

let code = 0;
try {
    const opts = parse((bro.app && bro.app.argv) || scriptArgs || []);
    if (opts.help) console.log(USAGE + '\ndefaults: ' + JSON.stringify(DEFAULTS));
    else runBatch(opts);
} catch (e) {
    console.error('birds: ' + ((e && e.message) || e));
    console.error(USAGE);
    code = 1;
}
process.exit(code);
