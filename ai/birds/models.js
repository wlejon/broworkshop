// models.js — where the birds app finds its weights: the one place it does.
//
// species.js and crop.js take explicit paths; only the app and its tests ask
// where things are, through locate(). bro.models.find(name) (bro's
// docs/models-api.js: BRO_MODELS, then a bro setting, then the per-user models
// dir) answers when the engine has it. Until it does, the kit's sibling-repo
// search stands in.
// TODO(bro.models): once bro.models ships everywhere, drop the fallback.
import { findWeights } from "/lib/kit/weights.js";

// name -> the sibling-repo path the fallback searches.
const FALLBACK = {
    'bioclip': 'brovisionml-data/bioclip',
    'bioclip-2': 'brovisionml-data/bioclip-2',
    'species/upper-midwest.json': 'brovisionml-data/species/upper-midwest.json',
    'birefnet.safetensors': 'brovisionml/weights/triposplat/background_removal/birefnet.safetensors',
};

/** Absolute path of a model directory or data file by name, or null. */
export function locate(name) {
    const models = globalThis.bro && bro.models;
    if (models && typeof models.find === 'function') return models.find(name) || null;
    const rel = FALLBACK[name];
    return rel ? findWeights([rel]) : null;
}

/** The fallback's search path for `name`, for "missing" messages. */
export function searched(name) {
    return globalThis.bro && bro.models && bro.models.find ? 'bro.models.find(' + JSON.stringify(name) + ')'
                                                            : (FALLBACK[name] || name);
}
