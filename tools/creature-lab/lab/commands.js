// The lab's commands: one function per command line verb, shared by cli.js
// and the tests. Every output lands under tests/out/creature-lab/<creature>/
// (A/B under <A>-vs-<B>/) unless --out names another root, and every command
// returns what it wrote.

import { loadCreature, snapshot } from "./creature.js";
import { runScenario } from "./run.js";
import { scenariosFor } from "./scenarios.js";
import { analyze } from "./analyze.js";
import { turnaroundSheet } from "./turnaround.js";
import { chartsSheet } from "./charts.js";
import { trajectorySheet } from "./trajectory.js";
import { rangeSheet } from "./range.js";
import { restForm, formInMotion } from "./form.js";
import { compareLookSets } from "/lib/kit/look.js";

export const HELP = `creature-lab <command> <creature> [scenario ...] [options]

  sheets      <creature> [scenario ...]    every sheet and the metrics, per scenario
  turnaround  <creature> [scenario ...]    8 views at 45 degrees by the phases of a cycle
  trajectory  <creature> [scenario ...]    feet, hips, withers, head, tail tip: side, front, top
  range       <creature> [scenario ...]    each joint at min / rest / max, the run's use of it
  charts      <creature> [scenario ...]    footfalls (Hildebrand), joint angles, body height and pitch
  metrics     <creature> [scenario ...]    JSON report per scenario, flags printed
  ab          <A> <B> [scenario ...]       the sheets of two versions interleaved / overlaid,
                                           metrics side by side (--diff: pixel diffs via look.js)
  form        <creature> [scenario ...]    the body measured: rest girths and extents against the
                                           creature's reference, ring areas and volumes through a cycle
  snapshot    <creature> <label>          copy creatures/<creature> to <creature>@<label> for A/B
  scenarios   <creature>                   list its scenarios

<creature>: a folder of creatures/ (deer), a snapshot (deer@before), a variant (deer:slip).
[scenario]: names, or 'all'. Defaults: walk trot gallop idle graze startle lie-down.
options: --out <dir>  --rows <n>  --seed <n>  --knob NAME=v[,NAME=v] (rig @knob overrides)
         --cell <scale>  --views right,front,...  (turnaround: bigger cells, some columns)`;

export const MOTION = ['walk', 'trot', 'gallop'];
export const ACTIONS = ['idle', 'graze', 'startle', 'lie-down'];
export const KINDS = ['turnaround', 'trajectory', 'range', 'charts'];

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

const safe = (label) => label.replace(/[:@+=,]/g, '_');
export function outRoot(opt) {
    const cwd = bro.app.cwd.replace(/\\/g, '/');
    if (!opt.out) return `${cwd}/tests/out/creature-lab`;
    const o = String(opt.out).replace(/\\/g, '/');
    return /^([A-Za-z]:)?\//.test(o) ? o : `${cwd}/${o}`;
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

// The analysis of a run, held to the creature's reference footfalls when the
// scenario is the one its `cycles` names for a gait (a steady gait).
export function analyzeRun(rec) {
    const cycles = rec.creature.def.cycles || {};
    const gait = Object.keys(cycles).find((g) => cycles[g].scenario === rec.scenario.name);
    return analyze(rec, { steady: !!gait, reference: gait ? cycles[gait].reference : null });
}

// One sheet of a kind for one run (or two, A/B), written to `path`.
export function sheet(kind, recs, path, opt = {}) {
    const rows = opt.rows ? +opt.rows : undefined;
    if (kind === 'turnaround') {
        return turnaroundSheet(recs, { path, rows, cell: opt.cell ? +opt.cell : 1, views: opt.views ? String(opt.views).split(',') : null });
    }
    if (kind === 'trajectory') return trajectorySheet(recs, { path });
    if (kind === 'charts') return chartsSheet(recs, { path });
    if (kind === 'range') return rangeSheet(recs[0], analyzeRun(recs[0]), { path });
    throw new Error(`no sheet '${kind}'`);
}

function report(sc, s, extra = '') {
    console.log(`${sc}: ${s.path} (${s.width}x${s.height}, ${s.ms} ms${extra})`);
}

// Metrics of A and B side by side: the numbers that move, and each one's flags.
export function compareReports(a, b) {
    const pick = (r) => ({
        meanSpeed: r.meanSpeed, heightRange: r.body.heightRange, pitchRangeDeg: r.body.pitchRangeDeg,
        head: r.head, support: r.support, period: r.footfalls.period, strideLength: r.footfalls.strideLength,
        feet: Object.fromEntries(Object.entries(r.feet).map(([k, f]) => [k, { slipMax: f.slipMax, sinkMax: f.sinkMax }])),
        duty: Object.fromEntries(Object.entries(r.footfalls.legs || {}).map(([k, l]) => [k, l.duty])),
        offset: Object.fromEntries(Object.entries(r.footfalls.legs || {}).map(([k, l]) => [k, l.offset])),
        flags: r.flags,
    });
    return { scenario: a.scenario, A: { creature: a.creature, ...pick(a) }, B: { creature: b.creature, ...pick(b) } };
}

export async function runCommand(argv) {
    const { pos, opt } = parseArgs(argv);
    const [cmd, spec, ...rest0] = pos;
    if (!cmd || cmd === 'help') { console.log(HELP); return null; }
    if (!spec) throw new Error(`${cmd}: name a creature\n${HELP}`);
    if (cmd === 'snapshot') {
        const s = snapshot(spec, rest0[0] || 'snap');
        console.log(`snapshot ${s.dir}: ${s.files.length} files`);
        return { written: s.files, summary: `A/B against it as ${s.dir}` };
    }
    const knobs = knobsOf(opt);
    const seed = opt.seed ? +opt.seed : 1;
    const creature = await loadCreature(spec, knobs);
    let other = null, rest = rest0;
    if (cmd === 'ab') {
        if (!rest0.length) throw new Error(`ab: name the second creature\n${HELP}`);
        other = await loadCreature(rest0[0], knobs);
        rest = rest0.slice(1);
    }
    const all = Object.keys(scenariosFor(creature));
    if (cmd === 'scenarios') {
        for (const name of all) console.log(`${name.padEnd(18)} ${scenariosFor(creature)[name].about || ''}`);
        return null;
    }
    const scenarios = rest.length ? (rest[0] === 'all' ? all : rest) : [...MOTION, ...ACTIONS];
    const dir = `${outRoot(opt)}/${safe(creature.label)}${other ? '-vs-' + safe(other.label) : ''}`;
    const written = [];
    const t0 = Date.now();

    if (cmd === 'form') {
        const { X, form } = restForm(creature);
        console.log(`rest: ${form.flags.length ? form.flags.length + ' off the reference' : 'on the reference'}`);
        for (const f of form.flags) console.log(`  - ${f}`);
        const runs = {};
        for (const sc of (rest.length ? scenarios : MOTION.slice(0, 2))) {
            const m = formInMotion(creature, runScenario(creature, sc, { seed }), X);
            runs[sc] = m;
            const span = (o) => Object.entries(o).map(([k, v]) => `${k} ${(100 * v.min).toFixed(1)}..${(100 * v.max).toFixed(1)}`).join(', ');
            console.log(`${sc}: area % ${span(m.area)}`);
            console.log(`${sc}: volume % ${span(m.volume)}`);
            console.log(`${sc}: protrude ${Object.entries(m.protrude).map(([k, v]) => `${k} ${(100 * v.out).toFixed(1)} cm`).join(', ')}`);
            console.log(`${sc}: fold ${Object.entries(m.fold).map(([k, v]) => `${k} ${v.min.toFixed(2)}..${v.max.toFixed(2)}`).join(', ')}`);
            for (const f of m.flags) console.log(`  - ${f}`);
        }
        const path = `${dir}/form.json`;
        writeFile(path, json({ creature: creature.label, rest: form, motion: runs }));
        written.push(path);
    } else if (cmd === 'metrics' || KINDS.includes(cmd) || cmd === 'sheets') {
        const kinds = cmd === 'sheets' ? KINDS : KINDS.includes(cmd) ? [cmd] : [];
        for (const sc of scenarios) {
            const rec = runScenario(creature, sc, { seed });
            if (cmd === 'metrics' || cmd === 'sheets') {
                const ta = Date.now();
                const r = analyzeRun(rec);
                const path = `${dir}/${sc}-metrics.json`;
                writeFile(path, json(r));
                written.push(path);
                console.log(`${sc}: ${r.flags.length ? r.flags.length + ' flag(s)' : 'clean'} -> ${path} (run ${rec.wallMs} ms, analysis ${Date.now() - ta} ms)`);
                for (const f of r.flags) console.log(`  - ${f}`);
            }
            for (const kind of kinds) {
                const s = sheet(kind, [rec], `${dir}/${sc}-${kind}.png`, opt);
                written.push(s.path);
                report(sc, s);
            }
        }
    } else if (cmd === 'ab') {
        const diff = !!opt.diff;
        const man = { a: { views: {} }, b: { views: {} } };
        for (const sc of scenarios) {
            const ra = runScenario(creature, sc, { seed }), rb = runScenario(other, sc, { seed });
            const cmp = compareReports(analyzeRun(ra), analyzeRun(rb));
            writeFile(`${dir}/${sc}-metrics.json`, json(cmp));
            written.push(`${dir}/${sc}-metrics.json`);
            console.log(`${sc}: A ${cmp.A.flags.length} flag(s), B ${cmp.B.flags.length} flag(s)`);
            for (const kind of ['turnaround', 'trajectory', 'charts']) {
                const s = sheet(kind, [ra, rb], `${dir}/${sc}-${kind}.png`, opt);
                written.push(s.path);
                report(sc, s);
            }
            for (const [tag, rec] of [['a', ra], ['b', rb]]) {
                const s = sheet('range', [rec], `${dir}/${sc}-range-${tag}.png`, opt);
                written.push(s.path);
                report(sc, s);
                if (diff) {
                    for (const kind of ['turnaround', 'charts']) {
                        const file = `${sc}-${kind}.png`;
                        sheet(kind, [rec], `${dir}/${tag}/${file}`, opt);
                        man[tag].views[`${sc}-${kind}`] = { file };
                    }
                }
            }
        }
        if (diff) {
            writeFile(`${dir}/a/manifest.json`, json(man.a));
            writeFile(`${dir}/b/manifest.json`, json(man.b));
            compareLookSets(`${dir}/a`, `${dir}/b`, `${dir}/diff`, { amplify: 4 });
            written.push(`${dir}/diff/comparison.json`);
        }
    } else {
        throw new Error(`unknown command '${cmd}'\n${HELP}`);
    }
    return { written, summary: `${written.length} file(s) in ${dir} (${Date.now() - t0} ms)` };
}
