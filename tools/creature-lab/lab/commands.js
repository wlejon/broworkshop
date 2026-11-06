// The lab's commands: one function per command line verb, shared by cli.js
// and the tests. Every output lands under tests/out/creature-lab/<creature>/
// unless --out says otherwise, and every command returns what it wrote.

import { loadCreature, snapshot } from "./creature.js";
import { runScenario } from "./run.js";
import { scenariosFor } from "./scenarios.js";
import { analyze } from "./analyze.js";
import { turnaroundSheet } from "./turnaround.js";

const HELP = `creature-lab <command> <creature> [scenario ...] [--out dir] [--rows n] [--seed n]

  metrics     <creature> [scenario ...]   JSON metrics report per scenario (+ flags)
  turnaround  <creature> [scenario ...]   8 views x phases
  scenarios   <creature>                  list the creature's scenarios

<creature>: a folder of creatures/ (deer), a snapshot (deer@before), a variant (deer:slip).`;

export const MOTION = ['walk', 'trot', 'gallop'];
export const ACTIONS = ['idle', 'graze', 'startle', 'lie-down'];

export function parseArgs(argv) {
    const pos = [], opt = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) opt[key] = true;
            else { opt[key] = next; i++; }
        } else pos.push(a);
    }
    return { pos, opt };
}

export function outDir(opt, label) {
    const base = opt.out ? String(opt.out) : `${bro.app.cwd.replace(/\\/g, '/')}/tests/out/creature-lab`;
    return `${base}/${label.replace(/[:@+=,]/g, '_')}`;
}

// --knob NAME=v[,NAME=v]: rig knob overrides.
export function knobsOf(opt) {
    if (!opt.knob) return null;
    const out = {};
    for (const kv of String(opt.knob).split(',')) {
        const [k, v] = kv.split('=');
        if (!k || v === undefined || !Number.isFinite(+v)) throw new Error(`--knob wants NAME=number, not '${kv}'`);
        out[k.trim()] = +v;
    }
    return out;
}

const json = (o) => JSON.stringify(o, null, 2) + '\n';

export async function metricsFor(creature, scenario, opt = {}) {
    const rec = runScenario(creature, scenario, { seed: opt.seed ? +opt.seed : 1 });
    return { rec, report: analyzeRun(rec) };
}

// The analysis of a run, held to the creature's reference footfalls when the
// scenario is the one its `cycles` names for a gait (a steady gait).
export function analyzeRun(rec) {
    const cycles = rec.creature.def.cycles || {};
    const gait = Object.keys(cycles).find((g) => cycles[g].scenario === rec.scenario.name);
    return analyze(rec, { steady: !!gait, reference: gait ? cycles[gait].reference : null });
}

// The gait a run settles into (the most common over its steady part), for
// picking the reference footfall pattern.
export function gaitOf(rec) {
    const names = ['stand', 'walk', 'trot', 'gallop'];
    const count = [0, 0, 0, 0];
    for (let k = Math.floor(rec.steps * 0.4); k < rec.steps; k++) count[rec.tele[k * 48 + 5] | 0]++;
    return names[count.indexOf(Math.max(...count))];
}

export async function runCommand(argv) {
    const { pos, opt } = parseArgs(argv);
    const [cmd, spec, ...rest] = pos;
    if (!cmd || cmd === 'help') { console.log(HELP); return null; }
    if (!spec) throw new Error(`${cmd}: name a creature\n${HELP}`);
    if (cmd === 'snapshot') return snapshot(spec, rest[0] || 'snap');

    const creature = await loadCreature(spec, knobsOf(opt));
    const dir = outDir(opt, creature.label);
    const all = Object.keys(scenariosFor(creature));
    if (cmd === 'scenarios') {
        for (const name of all) console.log(`${name.padEnd(18)} ${scenariosFor(creature)[name].about || ''}`);
        return null;
    }
    const pick = (dflt) => (rest.length ? (rest[0] === 'all' ? all : rest) : dflt);
    const written = [];

    if (cmd === 'metrics') {
        for (const sc of pick(MOTION)) {
            const { report } = await metricsFor(creature, sc, opt);
            const path = `${dir}/${sc}-metrics.json`;
            writeFile(path, json(report));
            written.push(path);
            console.log(`${sc}: ${report.flags.length ? report.flags.length + ' flag(s)' : 'clean'} -> ${path}`);
            for (const f of report.flags) console.log(`  - ${f}`);
        }
    } else if (cmd === 'turnaround') {
        for (const sc of pick([...MOTION, ...ACTIONS])) {
            const rec = runScenario(creature, sc);
            const s = turnaroundSheet(rec, { path: `${dir}/${sc}-turnaround.png`, rows: opt.rows ? +opt.rows : undefined });
            written.push(s.path);
            console.log(`${sc}: ${s.path} (${s.width}x${s.height}, run ${rec.wallMs} ms, sheet ${s.ms} ms)`);
        }
    } else {
        throw new Error(`unknown command '${cmd}'\n${HELP}`);
    }
    return { written, summary: `${written.length} file(s) in ${dir}` };
}
