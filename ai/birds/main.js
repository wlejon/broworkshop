// Birds: open a photo, find the animal, name the species with BioCLIP.
// The models load on the first photo, not at boot, so the app opens instantly
// and boots on a machine without the weights (the status line then says why).
import { boot, ids, h, clear } from "/lib/kit/index.js";
import { loadSpeciesModel } from "/app/species.js";
import { loadAnimalDetector, subjectSquare, cropImage } from "/app/detect.js";
import { locate, searched } from "/app/models.js";

const { status } = boot({});
const el = ids('open', 'model', 'crop', 'photo', 'hits');

const models = {};
let detector = null;

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

// The animal finder: OWLv2 when its weights are there and bro.vision has it.
function animalDetector() {
    if (detector) return detector;
    const dir = locate('owlv2');
    if (!dir || !bro.vision || typeof bro.vision.loadOwlv2 !== 'function') return null;
    status.busy('loading OWLv2…');
    detector = loadAnimalDetector({ weightsDir: dir });
    return detector;
}

function classify(path) {
    const img = bro.image.decodeScaled(path, { width: 1280, height: 1280 });
    if (!img.width) { status.error('could not decode ' + path + ': ' + img.error); return; }
    el.photo.src = path;
    let input = img, how = 'whole frame';
    const t = Date.now();
    if (el.crop.checked) {
        const det = animalDetector();
        if (det) {
            const hits = det.detect(img);
            if (!hits.length) {
                clear(el.hits);
                status.ok(`no animal found (OWLv2, ${Date.now() - t} ms)`);
                return;
            }
            input = cropImage(img, subjectSquare(hits[0].box, img.width, img.height));
            how = `${hits[0].label.replace(/^an? /, '')} ${(hits[0].score * 100).toFixed(0)}%`;
        } else {
            how = 'whole frame (no OWLv2: ' + searched('owlv2') + ')';
        }
    }
    const m = model(el.model.value);
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
