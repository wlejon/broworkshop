// Birds: open a photo, find the animal, name the species with BioCLIP
// (bro.vision.wildlife). The models load on the first photo, not at boot, so
// the app opens instantly and boots on a machine without the weights (the
// status line then says why).
import { boot, ids, h, clear } from "/lib/kit/index.js";

const { status } = boot({});
const el = ids('open', 'model', 'crop', 'photo', 'hits');
const wildlife = bro.vision && bro.vision.wildlife;

let analyzer = null;

function ready() {
    if (!wildlife) {
        status.warn('this build has no bro.vision.wildlife');
        return false;
    }
    for (const model of ['bioclip-2', 'bioclip']) {
        const loc = wildlife.locate({ model });
        if (loc.missing.length) {
            status.warn('missing ' + loc.missing.map((k) => k + ' (' + (loc[k] || 'not found by bro.models') + ')')
                .join(', ') + '; see README.md');
            return false;
        }
    }
    return wildlife.available();
}

// One analyzer at a time: another model replaces it.
function open(model) {
    if (analyzer && analyzer.config.classifier.name === model) return analyzer;
    if (analyzer) analyzer.dispose();
    analyzer = null;
    status.busy('loading OWLv2 and ' + model + ', embedding the species list…');
    analyzer = wildlife.open({
        model,
        cacheDir: bro.app && bro.app.cacheDir ? bro.app.cacheDir + '/species' : false,
    });
    return analyzer;
}

function show(hits) {
    clear(el.hits);
    for (const r of hits) {
        el.hits.appendChild(h('div.hit', null,
            h('span.p', null, (r.score * 100).toFixed(1) + '%'),
            h('span', null, r.common, ' ', h('span.sci.dim', null, r.scientific))));
    }
}

function classify(path) {
    const img = bro.image.decodeScaled(path, { width: 1280, height: 1280 });
    if (!img.width) { status.error('could not decode ' + path + ': ' + img.error); return; }
    el.photo.src = path;
    const an = open(el.model.value);
    const name = an.config.classifier.name;
    const t = Date.now();
    if (!el.crop.checked) {
        show(an.classify(img, { topK: 5 }));
        status.ok(`${name}, whole frame, ${Date.now() - t} ms`);
        return;
    }
    const rec = an.analyze(img);
    if (!rec.animal) {
        clear(el.hits);
        status.ok(`no animal found (OWLv2, ${Date.now() - t} ms)`);
        return;
    }
    show(rec.species);
    const best = rec.detections[0];
    status.ok(`${name}, ${best.label.replace(/^an? /, '')} ${(best.score * 100).toFixed(0)}%, ${Date.now() - t} ms`);
}

if (ready()) {
    el.open.disabled = false;
    status.set('open a photo');
    el.open.addEventListener('click', () => {
        const files = showOpenFileDialog('Photos|jpg;jpeg;png;heic;cr3');
        if (files.length) classify(files[0]);
    });
}
