// masks.js — bone masks as named, inspectable presets.
//
// A mask is the whole reason layering is useful: it is a per-bone 0/1 array,
// one entry per skeleton bone, saying "this layer drives that bone; leave the
// rest to whatever is underneath". `playLayer(slot, clip, { mask })` takes one
// directly, and the engine applies it inside its own blend — no JS involved
// per frame.
//
// They live in their own module rather than as a constant next to the wave
// clip because masking is a thing to EXPLORE, not a thing to hardcode once.
// The interesting question a viewer has is "what changes if the layer owns the
// arms but not the chest?", and that question needs a menu, not a magic
// number. Each preset therefore keeps its bone-name list alongside the packed
// array so the HUD can show exactly which bones a layer claims.
//
// A note on what a mask does NOT do: masking a bone OUT leaves it to the base
// track, but masking a bone IN hands it to the layer unconditionally — even if
// the layer's clip has no track for it, in which case the bone snaps to its
// bind transform. That is why every layer clip in clips.js drives the full
// upper-body set: it makes every preset here safe on every layer clip.

/**
 * Preset definitions, as bone-name selectors. Suffixed names expand over both
 * sides so the table stays readable — `shoulder_*` is both shoulders.
 */
const PRESETS = [
    ['upper body', 'chest / neck / head / both arms — the classic gesture mask',
     ['chest', 'neck', 'head', 'shoulder_*', 'elbow_*', 'wrist_*']],

    ['arms only', 'both arms, torso untouched — the chest keeps the gait\'s twist',
     ['shoulder_*', 'elbow_*', 'wrist_*']],

    ['right arm', 'one limb — what a wave actually needs',
     ['shoulder_R', 'elbow_R', 'wrist_R']],

    ['left arm', 'the mirror, so two arm layers can run without colliding',
     ['shoulder_L', 'elbow_L', 'wrist_L']],

    ['head only', 'neck + head — a nod that survives a full-speed run',
     ['neck', 'head']],

    ['full body', 'every bone: the layer completely replaces the base',
     ['*']],
];

/**
 * Expand the preset table against a concrete skeleton.
 *
 * @param {Object} rig - what buildSkeleton() returned (needs .names / .index)
 * @returns {{ names: string[], get(name): Uint8Array, bones(name): string[],
 *             describe(name): string, count(name): number }}
 */
export function buildMasks(rig) {
    const all = rig.names;
    const table = {};

    for (const [name, blurb, selectors] of PRESETS) {
        const bones = [];
        for (const sel of selectors) {
            if (sel === '*') {
                bones.push(...all);
            } else if (sel.endsWith('_*')) {
                const stem = sel.slice(0, -1);          // "shoulder_"
                for (const b of all) if (b.startsWith(stem)) bones.push(b);
            } else if (rig.index[sel] !== undefined) {
                bones.push(sel);
            } else {
                throw new Error(`mask "${name}": unknown bone "${sel}"`);
            }
        }

        // The packed form is what the engine wants: length === bone count,
        // 1 = this layer owns the bone. Built once at startup, then handed to
        // playLayer as-is — masks never change per frame.
        const packed = new Uint8Array(all.length);
        for (const b of bones) packed[rig.index[b]] = 1;

        table[name] = { name, blurb, bones, packed };
    }

    return {
        names: PRESETS.map((p) => p[0]),
        /** The Uint8Array to hand to playLayer({ mask }). */
        get(name)      { return entry(table, name).packed; },
        /** Which bones this preset claims, for the HUD's mask readout. */
        bones(name)    { return entry(table, name).bones.slice(); },
        describe(name) { return entry(table, name).blurb; },
        count(name)    { return entry(table, name).bones.length; },
    };
}

function entry(table, name) {
    const e = table[name];
    if (!e) throw new Error(`no such mask preset: ${name}`);
    return e;
}
