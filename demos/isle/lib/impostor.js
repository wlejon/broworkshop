// impostor.js — bake a grown tree "master" mesh into an octahedral impostor atlas.
//
import { growPrototype } from '/app/lib/flora.js';
import { bakeImpostorAtlas } from '/lib/impostor.js';

export { bakeImpostorAtlas };

/**
 * Grow the `decid` (deciduous) master and bake its octahedral impostor atlas in
 * a dedicated hidden capture scene.
 *
 * @param {Object} [opts]  passed through to bakeImpostorAtlas
 * @returns {Object} the bakeImpostorAtlas result, plus `.master`
 */
export function bakeDecidImpostor(opts) {
    opts = opts || {};
    const master = growPrototype('decid', 4, 0.7, {
        shadeTolerance: 0.35, moduleMatureAge: 0.6,
        tropismG2: 0.12, growthScale: 1.0,
        orthotropy: 0.4, rootVigorMax: 3.0,
        apicalControl: 0.35, apicalControlMature: 0.3,
        individualVariation: 0.15, maxAge: 60,
    });

    const cvs = document.createElement('canvas');
    cvs.width = opts.cell || 256;
    cvs.height = cvs.width;
    const capScene = cvs.getContext('scene');

    const result = bakeImpostorAtlas(capScene, master, opts);
    result.master = master;
    return result;
}
