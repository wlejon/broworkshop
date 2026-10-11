// species.js — zero-shot species identification with BioCLIP / BioCLIP 2.
//
// BioCLIP is a CLIP model trained on images paired with their taxonomy, so
// a species list becomes a classifier with no training: each species is a
// text prompt, embedded once, and a photo's label is the prompt its image
// embedding sits closest to. The weights are the open_clip releases converted
// by brolm's scripts/convert-openclip.py (model.safetensors, config.json,
// vocab.json, merges.txt; brovisionml-data/bioclip and bioclip-2), loaded
// through bro.lm.loadClip.
//
//   import { loadSpeciesModel } from "/app/species.js";
//   const model = loadSpeciesModel({ modelDir, speciesPath, cacheDir });
//   const top = model.classify(bro.image.decodeScaled(path, { width: 1024, height: 1024 }),
//                               { topK: 5 });
//   // [{ common: 'Mourning Dove', scientific: 'Zenaida macroura', score: 0.91,
//   //    similarity: 0.31, order: 'Columbiformes', family: 'Columbidae' }, ...]
//
// Prompts follow the BioCLIP paper and model card: the full taxonomic name
// (kingdom to species) followed by the common name, which scored best of the
// text types the paper compared ("Taxonomic + Common").
//
// The text side is the slow part (one encoder pass per species, ~570 for the
// Upper-Midwest list), so the embeddings are cached: in memory per model, and
// on disk under `cacheDir` keyed by the model and the exact prompt list, so a
// changed list or model re-embeds and an unchanged one loads in milliseconds.
//
// Images: any { width, height, data|pixels, channels? } with 8-bit RGB or RGBA
// rows (ImageData, a decodeScaled / decodeOriented result). The image is
// centre-cropped to a square and area-resized to the model's input size here,
// the same framing as open_clip's resize-shortest-side + centre crop, so the
// encoder's own resize is an identity. Crop to the subject before calling for
// small subjects (see crop.js).

const fs = require('fs');

const IMAGE_SIZE = 224;

/** "a photo of Animalia Chordata Aves Columbiformes Columbidae Zenaida macroura
 *  with common name Mourning Dove." */
export function speciesPrompt(sp) {
    const taxa = [sp.kingdom || 'Animalia', sp.phylum || 'Chordata', sp.class, sp.order,
                  sp.family, sp.scientific].filter(Boolean).join(' ');
    return `a photo of ${taxa} with common name ${sp.common}.`;
}

/** The species rows of a list file (upper-midwest.json's shape). */
export function readSpeciesList(speciesPath, opts) {
    const o = opts || {};
    const doc = JSON.parse(fs.readFileSync(speciesPath, 'utf-8'));
    let rows = doc.species || doc;
    if (o.accidental === false) rows = rows.filter((s) => !s.accidental);
    if (o.classes) rows = rows.filter((s) => o.classes.includes(s.class));
    return rows;
}

// FNV-1a over the prompts and the model's identity: the cache file's name.
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function modelKey(modelDir) {
    let size = 0;
    try { size = fs.statSync(modelDir + '/model.safetensors').size; } catch (_) {}
    return modelDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() + '-' + size;
}

// RGB(A) 8-bit -> the model's square RGBA input: centre crop, area resize.
export function squareInput(img, size) {
    size = size || IMAGE_SIZE;
    const w = img.width, h = img.height;
    const ch = img.channels || 4;
    let src = img.data || img.pixels;
    if (ch === 3) {
        const rgba = new Uint8Array(w * h * 4);
        bro.image.rgbToRgba(rgba, src, w * h, 255);
        src = rgba;
    }
    const side = Math.min(w, h);
    let sq = src;
    if (w !== h) {
        sq = new Uint8Array(side * side * 4);
        bro.image.centerCropU8(sq, src, { srcW: w, srcH: h, channels: 4, cropW: side, cropH: side });
    }
    if (side === size) return { width: size, height: size, data: sq };
    const out = new Uint8Array(size * size * 4);
    bro.image.resizeU8(out, sq, { srcW: side, srcH: side, dstW: size, dstH: size, channels: 4,
                                  filter: side > size ? 'area' : 'bicubic' });
    return { width: size, height: size, data: out };
}

/**
 * Load a BioCLIP-family model and embed a species list.
 * @param {{modelDir:string, speciesPath?:string, species?:Object[], cacheDir?:string,
 *          accidental?:boolean, classes?:string[], device?:string, config?:Object,
 *          onProgress?:(done:number,total:number)=>void}} opts
 *   `species` (rows) instead of `speciesPath`; `accidental: false` drops the
 *   rows the list marks accidental; `classes: ['Aves']` keeps those classes.
 */
export function loadSpeciesModel(opts) {
    const o = opts || {};
    const dir = String(o.modelDir).replace(/\\/g, '/').replace(/\/+$/, '');
    const species = o.species || readSpeciesList(o.speciesPath, o);
    if (!species.length) throw new Error('loadSpeciesModel: empty species list');
    const config = JSON.parse(fs.readFileSync(dir + '/config.json', 'utf-8'));
    const clipOpts = { vocabPath: dir + '/vocab.json', mergesPath: dir + '/merges.txt',
                       weightsPath: dir + '/model.safetensors' };
    if (o.device) clipOpts.device = o.device;
    // Architecture overrides over config.json (loadClip's `config`), e.g.
    // { textConfig: { hiddenAct: 'quick_gelu' }, visionConfig: { ... } }.
    if (o.config) clipOpts.config = o.config;
    const clip = bro.lm.loadClip(clipOpts);
    const dim = clip.projectionDim;
    const imageSize = (config.vision_config && config.vision_config.image_size) || IMAGE_SIZE;
    // open_clip's trained temperature: exp(logit_scale) = 100 for both BioCLIPs.
    const scale = 100;

    const prompts = species.map(speciesPrompt);
    const key = modelKey(dir) + '-' + fnv1a(JSON.stringify(o.config || null) + '\n' + prompts.join('\n')) + '.f32';
    const text = new Float32Array(species.length * dim);
    let cached = false;
    if (o.cacheDir) {
        try {
            // brokit hands back a Uint8Array (node: a Buffer); copy the bytes,
            // not the elements.
            const buf = fs.readFileSync(o.cacheDir + '/' + key);
            if (buf && buf.byteLength === text.byteLength) {
                const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf)
                    : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
                new Uint8Array(text.buffer).set(bytes);
                cached = true;
            }
        } catch (_) {}
    }
    if (!cached) {
        const batch = 32;
        for (let i = 0; i < prompts.length; i += batch) {
            const embs = clip.encodeText(prompts.slice(i, i + batch));
            embs.forEach((e, j) => text.set(e, (i + j) * dim));
            if (o.onProgress) o.onProgress(Math.min(i + batch, prompts.length), prompts.length);
        }
        if (o.cacheDir) {
            try {
                fs.mkdirSync(o.cacheDir, { recursive: true });
                fs.writeFileSync(o.cacheDir + '/' + key, new Uint8Array(text.buffer));
            } catch (_) {}
        }
    }

    function embedImage(img) {
        return clip.encodeImage(squareInput(img, imageSize));
    }

    // Cosine similarities against every species, then the softmax at the
    // model's temperature: `score` is a probability over the list, so it says
    // how much the list's best answer stands out, not whether the photo is of
    // any listed species at all.
    function classifyEmbedding(emb, copts) {
        const topK = (copts && copts.topK) || 5;
        const n = species.length;
        const sims = new Float32Array(n);
        let max = -Infinity;
        for (let s = 0; s < n; s++) {
            let d = 0;
            const off = s * dim;
            for (let i = 0; i < dim; i++) d += emb[i] * text[off + i];
            sims[s] = d;
            if (d > max) max = d;
        }
        let z = 0;
        const probs = new Float32Array(n);
        for (let s = 0; s < n; s++) { probs[s] = Math.exp((sims[s] - max) * scale); z += probs[s]; }
        const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);
        return order.slice(0, topK).map((s) => {
            const sp = species[s];
            return { common: sp.common, scientific: sp.scientific, order: sp.order,
                     family: sp.family, class: sp.class,
                     score: probs[s] / z, similarity: sims[s] };
        });
    }

    return {
        species, prompts, dim, imageSize, cached,
        name: dir.split('/').pop(),
        embedImage,
        classifyEmbedding,
        classify(img, copts) { return classifyEmbedding(embedImage(img), copts); },
    };
}
