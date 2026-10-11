// Birds: open a photo, crop to the subject, name the species with BioCLIP.
// The models load on the first photo, not at boot, so the app opens instantly
// and boots on a machine without the weights (the status line then says why).
import { boot, ids, h, clear } from "/lib/kit/index.js";
import { loadSpeciesModel } from "/app/species.js";
import { loadSubjectCropper } from "/app/crop.js";
import { locate, searched } from "/app/models.js";

const { status } = boot({});
const el = ids('open', 'model', 'crop', 'photo', 'hits');

const models = {};
let cropper = null;

function ready() {
    if (!globalThis.bro || !bro.lm || bro.lm.available === false || !bro.image) {
        status.warn('this build has no bro.lm / bro.image');
        return false;
    }
    for (const name of ['bioclip-2', 'bioclip', 'species/upper-midwest.json']) {
        if (!locate(name)) {
            status.warn('missing ' + name + ' (looked in ' + searched(name) + '; see README.md)');
            return false;
        }
    }
    return true;
}

function model(name) {
    if (!models[name]) {
        status.busy('loading ' + name + ' and embedding the species list…');
        models[name] = loadSpeciesModel({
            modelDir: locate(name),
            speciesPath: locate('species/upper-midwest.json'),
            cacheDir: bro.app && bro.app.cacheDir ? bro.app.cacheDir + '/species' : undefined,
        });
    }
    return models[name];
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
    const img = bro.image.decodeScaled(path, { width: 1024, height: 1024 });
    if (!img.width) { status.error('could not decode ' + path + ': ' + img.error); return; }
    el.photo.src = path;
    let input = img, how = 'whole frame';
    if (el.crop.checked) {
        const birefnet = locate('birefnet.safetensors');
        if (birefnet) {
            cropper = cropper || loadSubjectCropper({ weightsPath: birefnet });
            const c = cropper.crop(img);
            input = c.image;
            how = c.method === 'saliency' ? 'subject crop' : 'no subject found, whole frame';
        } else {
            how = 'whole frame (no BiRefNet weights)';
        }
    }
    const m = model(el.model.value);
    const t = Date.now();
    show(m.classify(input, { topK: 5 }));
    status.ok(`${m.name}, ${how}, ${Date.now() - t} ms`);
}

if (ready()) {
    el.open.disabled = false;
    status.set('open a photo');
    el.open.addEventListener('click', () => {
        const files = showOpenFileDialog('Photos|jpg;jpeg;png;heic;cr3');
        if (files.length) classify(files[0]);
    });
}
