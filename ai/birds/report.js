// report.js — summary.md, the human-readable report of a batch run: photos,
// animals, species by photos and by bursts, burst sizes, the keeper of each
// burst, where the time went, failures. Everything in it is also in
// meta.json / records.jsonl / bursts.jsonl (RECORDS.md).

const fs = require('fs');
const pathMod = require('path');

function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '-'; }
function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|'); }
function rel(p, root) { return p && root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p; }

function modelLine(m) {
    if (!m) return '-';
    return `${m.repo || m.name}${m.revision ? ' @ ' + m.revision.slice(0, 12) : ''}` +
           `${m.weightsBytes ? ` (${(m.weightsBytes / 1048576).toFixed(0)} MB)` : ''}`;
}

/** Size buckets for the burst-size distribution. */
const BUCKETS = [[1, 1], [2, 2], [3, 5], [6, 10], [11, 20], [21, 50], [51, Infinity]];

export function writeReport(file, { meta, records, bursts, taxa }) {
    const L = [];
    const run = meta.run, c = meta.config, root = meta.input;
    const ok = records.filter((r) => !r.error);
    const animals = ok.filter((r) => r.animal === true), none = ok.filter((r) => r.animal === false);
    const failed = records.filter((r) => r.error);

    L.push(`# Birds: ${pathMod.basename(root)}`, '');
    L.push(`- Photos: \`${root}\``);
    L.push(`- Records: \`${meta.output}\` (records.jsonl, bursts.jsonl, meta.json; fields in ai/birds/RECORDS.md)`);
    L.push(`- Run: ${run.startedAt}, ${(run.wallMs / 1000).toFixed(1)} s wall; ${run.processed} processed, ` +
           `${run.reused} unchanged from an earlier run${run.removed ? `, ${run.removed} records dropped (photo gone)` : ''}`);
    if (c.models) {
        L.push(`- Detector: OWLv2 ${modelLine(c.detector)}, threshold ${c.threshold}, ${c.queries.length} animal queries`);
        // speciesList.files since the lists merged (an older meta has `file`).
        const lists = c.speciesList.files ? c.speciesList.files.join(' + ') : c.speciesList.file;
        L.push(`- Species: ${modelLine(c.classifier)}, top ${c.topK} over ${c.speciesList.count} species ` +
               `(${lists}), subject square +${Math.round(c.margin * 100)}%`);
        if (c.candidates)
            L.push(`- Crops: up to ${c.maxClassify} animal boxes a photo, each ranked over ` +
                   (c.candidates.mode === 'byQuery'
                       ? `the species of its query's classes (every species when that is under ${c.candidates.fallback} and another class's best clears it)`
                       : 'every species'));
        if (meta.options.labelThreshold != null)
            L.push(`- Labels: each animal is named at the narrowest rank (species, genus, family, order, class) scoring ` +
                   `${meta.options.labelThreshold} or more; a photo shows its burst's labels when it has any; ` +
                   'no rank there and the animal is unidentified');
    } else {
        L.push('- Models: none (--no-models: decode, EXIF, sharpness and bursts only)');
    }
    L.push(`- Bursts: gap <= ${meta.options.gapS} s` +
           `${meta.options.sceneNcc > 0 ? `, split when scene NCC < ${meta.options.sceneNcc}` : ', no scene split'}; ` +
           `keeper by ${meta.options.metric} of the subject (whole frame without an animal)`);
    L.push(`- Images: detection ${c.detectSize} px, sharpness ${c.sharpSize} px (long side); config ${meta.configHash}`, '');

    L.push('## Photos', '');
    L.push('| photos | animal | no animal | errors | RAW+JPEG pairs | other files skipped |');
    L.push('|---:|---:|---:|---:|---:|---|');
    const skipped = Object.entries(run.skippedFiles || {}).map(([e, n]) => `${n} ${e}`).join(', ') || '-';
    L.push(`| ${records.length} | ${animals.length} (${pct(animals.length, ok.length)}) | ${none.length} | ` +
           `${failed.length} | ${run.pairs} | ${skipped} |`, '');
    const detLabels = new Map();
    for (const r of animals) detLabels.set(r.detections[0].label, (detLabels.get(r.detections[0].label) || 0) + 1);
    if (detLabels.size)
        L.push('Detector labels (best box): ' + [...detLabels.entries()].sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k.replace(/^an? /, '')} ${n}`).join(', '), '');

    // Labels: what an app shows at the label threshold (bro.vision.wildlife.labels).
    const lb = meta.run.labels;
    if (c.models && lb) {
        L.push(`## Labels at ${lb.threshold}`, '');
        L.push('Photos with an animal (theirs or their burst\'s) and bursts with one: labelled when at least one ' +
               'name clears the threshold at some rank, else unidentified; 2+ names: several animals named. ' +
               'A photo shows its burst\'s labels when the burst has any.', '');
        L.push('| | with an animal | labelled | unidentified | 2+ names |');
        L.push('|---|---:|---:|---:|---:|');
        for (const k of ['photos', 'bursts'])
            L.push(`| ${k} | ${lb[k].animal} | ${lb[k].labelled} (${pct(lb[k].labelled, lb[k].animal)}) | ` +
                   `${lb[k].unidentified} | ${lb[k].multi != null ? lb[k].multi : '-'} |`);
        L.push('');
        if (lb.byRank) {
            L.push('Photo labels by rank: ' + Object.entries(lb.byRank).map(([r, n]) => `${r} ${n}`).join(', ') +
                   `. Animal boxes over the detector threshold not classified (over ${c.maxClassify} a photo): ${lb.droppedBoxes}.`, '');
        }
        if (lb.groups) {
            L.push('| photos labelled with | photos |');
            L.push('|---|---:|');
            for (const g of lb.groups) L.push(`| ${g.name} | ${g.photos} |`);
            if (lb.ungrouped) L.push(`| (another class) | ${lb.ungrouped} |`);
            L.push('');
        }
        if (lb.taxa && lb.taxa.length) {
            L.push('Per name: photos and bursts showing it.', '');
            L.push('| label | rank | scientific | group | photos | bursts |');
            L.push('|---|---|---|---|---:|---:|');
            for (const t of lb.taxa)
                L.push(`| ${esc(t.label)} | ${t.rank} | *${esc(t.scientific)}* | ${t.group || '-'} | ${t.photos} | ${t.bursts} |`);
            L.push('');
        }
    }

    // Species: photos by top-1 (best box), bursts by consensus.
    const sp = new Map();
    const get = (common, scientific) => {
        if (!sp.has(scientific)) sp.set(scientific, { common, scientific, photos: 0, bursts: 0, burstPhotos: 0 });
        return sp.get(scientific);
    };
    for (const r of animals) if (r.species[0]) get(r.species[0].common, r.species[0].scientific).photos++;
    for (const b of bursts) if (b.species) {
        const s = get(b.species.common, b.species.scientific);
        s.bursts++; s.burstPhotos += b.count;
    }
    if (sp.size) {
        L.push('## Species (top-1)', '');
        L.push('Whatever the score, before the label threshold. Bursts: bursts whose consensus it is (photos in them); ' +
               'photos: photos whose best box\'s top-1 it is.', '');
        L.push('| species | scientific | bursts | photos in them | photos (top-1) |');
        L.push('|---|---|---:|---:|---:|');
        for (const s of [...sp.values()].sort((a, b) => b.bursts - a.bursts || b.photos - a.photos))
            L.push(`| ${esc(s.common)} | *${esc(s.scientific)}* | ${s.bursts} | ${s.burstPhotos} | ${s.photos} |`);
        L.push('');
    }

    // Bursts.
    L.push('## Bursts', '');
    const sizes = bursts.map((b) => b.count);
    const withAnimal = bursts.filter((b) => b.animalCount > 0).length;
    const multi = bursts.filter((b) => b.count > 1);
    L.push(`${bursts.length} bursts from ${ok.length} photos: ${withAnimal} with an animal, ` +
           `${bursts.length - multi.length} single shots; mean ${(ok.length / Math.max(1, bursts.length)).toFixed(1)} ` +
           `photos, largest ${sizes.length ? Math.max(...sizes) : 0}` +
           `${multi.length ? `, longest ${Math.max(...multi.map((b) => b.durationS)).toFixed(1)} s` : ''}.` +
           `${bursts.some((b) => b.startedBy === 'scene') ? ` ${bursts.filter((b) => b.startedBy === 'scene').length} started by a scene change.` : ''}`, '');
    L.push('| photos in burst | ' + BUCKETS.map(([a, b]) => (a === b ? a : b === Infinity ? a + '+' : a + '-' + b)).join(' | ') + ' |');
    L.push('|---|' + BUCKETS.map(() => '---:').join('|') + '|');
    L.push('| bursts | ' + BUCKETS.map(([a, b]) => sizes.filter((s) => s >= a && s <= b).length).join(' | ') + ' |');
    L.push('| photos | ' + BUCKETS.map(([a, b]) => sizes.filter((s) => s >= a && s <= b).reduce((x, y) => x + y, 0)).join(' | ') + ' |', '');
    const agreeing = bursts.filter((b) => b.species && b.animalCount > 1);
    if (agreeing.length) {
        const a = agreeing.reduce((x, b) => x + b.species.agree, 0), n = agreeing.reduce((x, b) => x + b.animalCount, 0);
        L.push(`In bursts of 2+ animal frames, ${pct(a, n)} of frames name the burst's consensus species first.`, '');
    }

    // Keepers.
    L.push('## Keepers', '');
    L.push('The sharpest frame of each burst with an animal (labels: the burst\'s at the threshold; consensus: the ' +
           'top-1 vote, its share, agree: frames whose top-1 it is / frames with an animal).', '');
    L.push('| # | start | photos | labels | consensus | share | agree | keeper | sharpness |');
    L.push('|---:|---|---:|---|---|---:|---:|---|---:|');
    const lopts = lb ? { labelThreshold: lb.threshold, taxa: taxa || undefined } : null;
    for (const b of bursts.filter((x) => x.species)) {
        const names = lopts ? bro.vision.wildlife.labels(null, b, lopts).map(bro.vision.wildlife.formatLabel).join(', ') : '';
        L.push(`| ${b.id} | ${esc(b.start || '-')} | ${b.count} | ${esc(names || '-')} | ${esc(b.species.common)} | ` +
               `${b.species.share.toFixed(2)} | ${b.species.agree}/${b.animalCount} | ${esc(rel(b.keeper, root))} | ${b.keeperSharpness} |`);
    }
    L.push('');

    // Timing: this run's wall time; per-stage cost from every record (a
    // re-run that reuses records still reports what processing them cost).
    L.push('## Timing', '');
    L.push(`This run: ${(run.wallMs / 1000).toFixed(1)} s wall, ${run.processed} photos processed` +
           (run.processed ? ` at ${run.msPerPhoto} ms a photo end to end (models loading excluded; ` +
                            `${meta.options.workers} decode workers, ${meta.engine.device || 'no models'})` : '') +
           `, ${run.reused} reused.`, '');
    const where = { decode: 'worker', exif: 'worker', sharpness: 'worker (frame)', thumb: 'worker', subject: 'worker (subject)',
                    detect: 'GPU (OWLv2)', classify: 'GPU (crop + BioCLIP)' };
    L.push('Per photo, over every record (all runs):', '');
    L.push('| stage | where | photos | mean ms | median ms | total s |');
    L.push('|---|---|---:|---:|---:|---:|');
    for (const k of Object.keys(where)) {
        const v = ok.map((r) => r.timing && r.timing[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
        if (!v.length) continue;
        const sum = v.reduce((a, b) => a + b, 0);
        L.push(`| ${k} | ${where[k]} | ${v.length} | ${(sum / v.length).toFixed(1)} | ${v[v.length >> 1]} | ${(sum / 1000).toFixed(1)} |`);
    }
    L.push('', 'Worker stages run in parallel with the GPU ones, so the GPU stages (detect + classify) set the pace.');
    if (run.timing.wait && run.timing.wait.n)
        L.push(`This run the page waited ${(run.timing.wait.totalMs / 1000).toFixed(1)} s in all for a decode to arrive.`);
    L.push('');
    if (meta.history && meta.history.length) {
        L.push('Runs into this directory:', '');
        L.push('| started | wall s | processed | reused | errors | ms a photo | config |');
        L.push('|---|---:|---:|---:|---:|---:|---|');
        for (const h of meta.history)
            L.push(`| ${h.startedAt} | ${(h.wallMs / 1000).toFixed(1)} | ${h.processed} | ${h.reused} | ${h.errors} | ` +
                   `${h.processed ? h.msPerPhoto : '-'} | ${h.configHash} |`);
        L.push('');
    }

    // Failures.
    L.push('## Failures', '');
    if (!failed.length) L.push('None.');
    for (const r of failed) L.push(`- \`${esc(rel(r.path, root))}\`: ${esc(r.stage)}: ${esc(r.error)}`);
    L.push('');

    fs.writeFileSync(file + '.tmp', L.join('\n'), 'utf-8');
    fs.renameSync(file + '.tmp', file);
}
