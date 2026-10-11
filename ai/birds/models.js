// models.js — where the birds app finds its weights: the one place it does.
//
// species.js and detect.js take explicit paths; only the app and its tests ask
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
    'owlv2': 'brovisionml-data/owlv2',
};

/** Absolute path of a model directory or data file by name, or null. */
export function locate(name) {
    const models = globalThis.bro && bro.models;
    if (models && typeof models.find === 'function') {
        // bro.models finds directories; a data file is found through its own.
        const slash = name.lastIndexOf('/');
        if (!name.endsWith('.json') || slash < 0) return models.find(name) || null;
        const dir = models.find(name.slice(0, slash));
        const file = dir && dir + '/' + name.slice(slash + 1);
        return file && require('fs').existsSync(file) ? file : null;
    }
    const rel = FALLBACK[name];
    return rel ? findWeights([rel]) : null;
}

/** The fallback's search path for `name`, for "missing" messages. */
export function searched(name) {
    return globalThis.bro && bro.models && bro.models.find ? 'bro.models.find(' + JSON.stringify(name) + ')'
                                                            : (FALLBACK[name] || name);
}
