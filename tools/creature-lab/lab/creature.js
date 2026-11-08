// Loading a creature: its folder's creature.js, its skeleton resolved, its
// rig compiled (with a variant's knobs), its body built.
//
// A spec names a folder under creatures/, optionally a variant:
//   'deer'            the deer as it is
//   'deer:slip'       the deer with its `slip` variant's knobs
//   'deer@before'     a snapshot (creatures/deer@before/, see snapshot())
// Every load reads the folder afresh, so an edit shows on the next run.

import { resolveSkeleton } from "./skeleton.js";
import { contractModule } from "./contract.js";

const fs = require('fs');

export const appPath = (p) => bro.resolvePath('/app/' + p);
export const readApp = (p) => fs.readFileSync(appPath(p), 'utf-8');

// The lab's modules every rig may import (read afresh each load): the
// helpers, the ground, the contract, and the general motion layers any
// skeleton gets (lab/pose.bk, secondary.bk, body.bk, spine.bk).
export function labModules() {
    return {
        'creature::common': readApp('lab/common.bk'),
        'creature::ground': readApp('lab/ground.bk'),
        'creature::contract': contractModule(),
        'creature::pose': readApp('lab/pose.bk'),
        'creature::secondary': readApp('lab/secondary.bk'),
        'creature::body': readApp('lab/body.bk'),
        'creature::spine': readApp('lab/spine.bk'),
        'creature::leap': readApp('lab/leap.bk'),
    };
}

// The modules a skin hook (lab/skin.bk, skin-crowd.bk) imports: the
// creature's skeleton and its face, or (face false: a coarse level, where
// a face is under a pixel) none.
export function skinModules(creature, face = true) {
    return { 'creature::skeleton': creature.skel.module, 'creature::face': face ? creature.face : readApp('lab/face.bk') };
}

// A rig's own modules: `rig.modules` maps a module name to a file of the
// creature's folder (read afresh each load) or to source.
function rigModules(def, folder) {
    const out = {};
    for (const [name, v] of Object.entries((def.rig && def.rig.modules) || {})) {
        out[name] = /\.bk$/.test(v) ? readApp(`${folder}/${v}`) : v;
    }
    return out;
}

export function parseSpec(spec) {
    const m = /^([^:]+)(?::(.+))?$/.exec(spec);
    if (!m) throw new Error(`creature spec '${spec}' is not name[@snapshot][:variant]`);
    return { dir: m[1], variant: m[2] || null };
}

// A creature is found by its entry module, creatures/<name>.js, which
// re-exports its folder's creature.js (bronze compiles dynamic imports
// ahead of the run, from a glob over one directory). Its JS is read when the
// lab starts; its rig (.bk) is read afresh every load.
//
// `extraKnobs` ({NAME: value}) override the rig's @knob constants on top of
// the variant's, for trying a value without editing the rig.
export async function loadCreature(spec, extraKnobs = null) {
    const t0 = Date.now();
    const { dir, variant } = parseSpec(spec);
    const folder = `creatures/${dir}`;
    const def = (await import(`/app/creatures/${dir}.js`)).default;
    const skel = resolveSkeleton(def.skeleton);
    let knobs;
    if (variant) {
        knobs = def.variants && def.variants[variant];
        if (!knobs) throw new Error(`${dir} has no variant '${variant}' (has ${Object.keys(def.variants || {}).join(', ')})`);
    }
    if (extraKnobs && Object.keys(extraKnobs).length) knobs = { ...(knobs || {}), ...extraKnobs };
    const modules = { ...labModules(), 'creature::skeleton': skel.module, ...rigModules(def, folder) };
    const t1 = Date.now();
    const mod = bro.kernel.compile(readApp(`${folder}/${def.rig.file}`), { file: `${folder}/${def.rig.file}`, modules, knobs });
    const t2 = Date.now();
    const rig = mod.kernel(def.rig.kernel);
    const body = def.body(skel);
    const t3 = Date.now();
    // Its face (creature::face, drawn per pixel by the skin hooks): a .bk
    // of its folder, else the lab's, which draws none.
    const face = readApp(def.face ? `${folder}/${def.face}` : 'lab/face.bk');
    return {
        face,
        spec, dir, variant, knobs: knobs || null, folder, name: def.name,
        label: spec + (extraKnobs && Object.keys(extraKnobs).length ? '+' + Object.entries(extraKnobs).map(([k, v]) => `${k}=${v}`).join(',') : ''), def, skel, mod, rig, body, modules,
        stateStride: mod.consts.STATE,
        timing: { importMs: t1 - t0, compileMs: t2 - t1, bodyMs: t3 - t2 },
    };
}

// Copy a creature's folder to creatures/<name>@<label>/ with its entry
// module, to A/B against later (a run that starts after the snapshot sees
// it). Uses the headless harness's writeFile: run it from bro-headless.
export function snapshot(name, label) {
    const snap = `${name}@${label}`;
    const src = appPath(`creatures/${name}`);
    const dst = appPath(`creatures/${snap}`);
    const files = [];
    const walk = (rel) => {
        for (const e of fs.readdirSync(src + rel, { withFileTypes: true })) {
            const r = `${rel}/${e.name}`;
            if (e.isDirectory()) walk(r);
            else { writeFile(dst + r, fs.readFileSync(src + r, 'utf-8')); files.push(r.slice(1)); }
        }
    };
    walk('');
    writeFile(appPath(`creatures/${snap}.js`), `// A snapshot of ${name} (lab/creature.js snapshot).\nexport { default } from "./${snap}/creature.js";\n`);
    return { dir: snap, files };
}
