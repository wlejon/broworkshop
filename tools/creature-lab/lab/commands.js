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
import { filmSheet } from "./film.js";
import { lookSheet } from "./look.js";
import { posesSheet } from "./poses.js";
import { modelSheet } from "./posing.js";
import { upperSheet, upperLines } from "./upper.js";
import { skinSheet, boundFlags } from "./skinsee.js";
import { partsSheet } from "./parts.js";
import { watchSheet, WATCH, WATCH_VIEWS } from "./watch.js";
import { rangeSheet } from "./range.js";
import { kinematicsSheet, spacingSheet } from "./kinematics.js";
import { restForm, formInMotion } from "./form.js";
import { compareLookSets } from "/lib/kit/look.js";
import { scanScenario } from "./finder.js";
import { finderReport } from "./finder-out.js";
import { naturalReport, naturalRun } from "./natural-out.js";
import { herdCost } from "./herd.js";
import { flockCost } from "./flock-cost.js";
import { scoreTable, sweepTable, compareTable, kinkReport, traceText } from "./iterate.js";

export const HELP = `creature-lab <command> <creature> [scenario ...] [options]

  model       <creature> [pose ...]        its poses and cycles as its keys have them, with no rig: each
                                           pose from four sides with its balance over its feet, each
                                           cycle's phases from the side and the front
                                           (--cycles a,b | none, --frames <n>, --cell <scale>, --dist)
  sheets      <creature> [scenario ...]    every sheet and the metrics, per scenario
  turnaround  <creature> [scenario ...]    8 views at 45 degrees by the phases of a cycle
  trajectory  <creature> [scenario ...]    feet, hips, withers, head, tail tip: side, front, top
  range       <creature> [scenario ...]    each joint at min / rest / max, the run's use of it
  charts      <creature> [scenario ...]    footfalls (Hildebrand), joint angles, body height and pitch
  film        <creature> [scenario ...]    a filmstrip, the head/withers/hips/tail-tip paths over a side
                                           view, slit-scans through head, withers and tail tip
                                           (--from <s> --to <s>: the window, 1.5 s mid-run by default;
                                           --frames <n>)
  watch       <creature> <scenario> --view side|front|back|front-quarter|back-quarter|top
                                           the sheet a motion is judged by eye in: one run from one view in
                                           at most 6 consecutive frames, the creature filling each; one
                                           still camera, the frame before outlined in each, a plumb line
                                           and its hips' and head's rest heights. Run again per view.
                                           (--frames <1..6>; --from <phase> --span <share of the cycle>:
                                           part of a cycle closer in time; without a cycle --from/--to s)
  look        <creature> [scenario ...]    the creature as the live view draws it (lit, shadowed), close,
                                           through a cycle: three-quarter front, side, three-quarter back
                                           (--rows <n> | --phases, --views front-left,left,back-left,front,right,
                                           --dist <body lengths>; --focus <bone>: aimed at that bone as
                                           it moves; --pieces: coloured and named by body piece;
                                           --cell <scale>: bigger shots)
  poses       <creature> [scenario ...]    a gait's key poses large from the side, legs traced; the stance
                                           leg's bend, the hips' vault against a rigid leg's, a run's
                                           push-off; the silhouette: crotch, arms clear, waist and neck
  upper       <creature> [scenario ...]    the upper body over the run's time: head, withers, elbows, hands
                                           (world acceleration) and the trunk's, neck's, head's and arms'
                                           bones (world turning speed), kinks tagged with the start/stop
                                           they follow; each bone's own swing against its parent
                                           (--from <s> --to <s>: the window)
  parts       <creature> [scenario ...]    each part of the body (an ear, an arm, the head, the tail) close
                                           through the cycle, and every frame laid over the others, going
                                           along with the creature and with the part's carrier held still;
                                           how far it turns and travels on its carrier and in the world:
                                           glued, wobbling, steadied (--part head,shoulderL, --frames <n>,
                                           --cell <scale>)
  skin        <creature> [scenario ...]    whether each limb has a skin of its own at rest, and through
                                           the run the body coloured by how far the skin is pulled or
                                           crushed from rest, the places listed (--rows, --cell, --dist)
  kinematics  <creature> [scenario ...]    per leg, each bone's flexion, velocity and acceleration over
                                           the cycle with contact, lift-off and touchdown; corners in red
  spacing     <creature> [scenario ...]    toes, leg joints and tracked points at 30 fps (--fps): paths
                                           with a dot a frame and each frame's step; skips in red
  metrics     <creature> [scenario ...]    JSON report per scenario, flags printed
  ab          <A> <B> [scenario ...]       the sheets of two versions interleaved / overlaid,
                                           metrics side by side (--diff: pixel diffs via look.js)
  form        <creature> [scenario ...]    the body measured: rest sections against the creature's
                                           reference, section areas and mass volumes through a cycle
  finder      <creature> [scenario ...]    hard lines: pieces crossing, folds, creases, outline notches,
                                           scanned on the mesh and from the live view's cameras; ranks
                                           every scanned scenario and draws the worst as lit close-ups
                                           (--rank: rank what is scanned, --top <n>, --every <steps>)
  natural     <creature> [scenario ...]    motion against principles, no reference: overlap and
                                           follow-through, secondary motion, the mass's physics,
                                           smoothness, variety, head stabilisation, arcs
  score       <creature> [scenario ...]    one line a scenario, fast: metrics flags, natural flags, kinks a
                                           second and where most fall, the root's kinks, pushed past friction,
                                           pulled down, off free fall, swing-foot corners, jittering joints
                                           (--vs <creature>: a snapshot's rows above these, a table a scenario)
  sweep       <creature> [scenario ...]    score for each value of a knob, one table a scenario
                                           (--sweep NAME=a,b,c; the rig's own value first)
  kinks       <creature> [scenario ...]    where the kinks are: by foot event, the bones in each, the root
                                           (--bone <name>: its every kink; --at "LF lift": every bone there)
  trace       <creature> <scenario>        frame by frame (--from <s> --to <s>, --every <steps>): a leg
                                           (--leg LF: down, toe height, reach, miss, each bone's angle, *
                                           at a kink) and/or bones (--bones neck,head), the nearest foot
                                           event, the rig's creature::probe values
  herd        <creature> [scenario]        a herd's GPU cost a frame and triangles (--count 50, --frames 240)
  flock       <creature> [behaviour]       a flock on the GPU brain (graze travel mill flee): GPU cost,
                                           what the group does, a screenshot (--count 200, --frames 240,
                                           --warm <steps>, --shadows off, --view field|ground|close)
  snapshot    <creature> <label>        copy creatures/<creature> to <creature>@<label> for A/B
  scenarios   <creature>                   list its scenarios

<creature>: a folder of creatures/ (deer), a snapshot (deer@before), a variant (deer:slip).
[scenario]: names, or 'all'. Defaults: walk trot gallop idle graze startle lie-down.
options: --out <dir>  --rows <n>  --seed <n>  --knob NAME=v[,NAME=v] (rig @knob overrides)
         --cell <scale>  --views right,front,...  --phases 0.4,0.45  (turnaround: bigger cells,
                                           some columns, chosen phases)`;

export const MOTION = ['walk', 'trot', 'gallop'];
export const ACTIONS = ['idle', 'graze', 'startle', 'lie-down'];
export const KINDS = ['turnaround', 'trajectory', 'range', 'charts', 'film', 'kinematics', 'spacing'];
// The natural command's default: the steady gaits, a stop and a turn.
export const NATURAL = ['walk', 'trot', 'gallop', 'start-stop', 'gaits', 'trot-turn', 'startle'];

export function parseArgs(argv) {
    const pos = [], opt = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) opt[key] = true;
            // --knob may be given more than once: its overrides add up.
            else { opt[key] = key === 'knob' && typeof opt.knob === 'string' ? `${opt.knob},${next}` : next; i++; }
        } else pos.push(a);
    }
    return { pos, opt };
}

// The sheets asked for by name only (`sheets` draws KINDS).
const CLOSE = ['look', 'poses', 'upper', 'skin', 'parts'];

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
        return turnaroundSheet(recs, {
            path, rows, cell: opt.cell ? +opt.cell : 1, views: opt.views ? String(opt.views).split(',') : null,
            phases: opt.phases ? String(opt.phases).split(',').map(Number) : null,
        });
    }
    if (kind === 'trajectory') return trajectorySheet(recs, { path });
    if (kind === 'film') {
        return filmSheet(recs[0], { path, from: opt.from !== undefined ? +opt.from : null, to: opt.to !== undefined ? +opt.to : null,
            frames: opt.frames ? +opt.frames : 14 });
    }
    if (kind === 'poses') return posesSheet(recs[0], { path });
    if (kind === 'upper') return upperSheet(recs[0], { path, from: opt.from !== undefined ? +opt.from : null, to: opt.to !== undefined ? +opt.to : null });
    if (kind === 'look') {
        return lookSheet(recs[0], { path: opt.pieces ? path.replace(/\.png$/, '-pieces.png') : path, pieces: !!opt.pieces, rows: rows || 6, views: opt.views ? String(opt.views).split(',') : null,
            phases: opt.phases ? String(opt.phases).split(',').map(Number) : null, dist: opt.dist ? +opt.dist : 2.6,
            focus: opt.focus ? String(opt.focus) : null, cell: opt.cell ? Math.round(360 * +opt.cell) : 360 });
    }
    if (kind === 'skin') {
        const s = skinSheet(recs[0], { path, rows: rows || 4, cell: opt.cell ? Math.round(300 * +opt.cell) : 300, dist: opt.dist ? +opt.dist : 2.2 });
        return { ...s, json: { flags: s.flags, bound: s.bound, places: s.motion.places } };
    }
    if (kind === 'parts') {
        return partsSheet(recs[0], { path, part: opt.part ? String(opt.part).split(',') : null, frames: opt.frames ? +opt.frames : 6,
            cell: opt.cell ? Math.round(230 * +opt.cell) : 230 });
    }
    if (kind === 'charts') return chartsSheet(recs, { path });
    if (kind === 'kinematics') return kinematicsSheet(recs[0], { path });
    if (kind === 'spacing') return spacingSheet(recs[0], { path, fps: opt.fps ? +opt.fps : 30 });
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
    if (cmd === 'model') {
        const t0 = Date.now();
        const path = `${outRoot(opt)}/${safe(creature.label)}/model.png`;
        const s = modelSheet(creature, { path, poses: rest0.length ? rest0 : null, cycles: opt.cycles ? String(opt.cycles).split(',') : null,
            cell: opt.cell ? +opt.cell : 1, frames: opt.frames ? +opt.frames : 8, dist: opt.dist ? +opt.dist : 2.1 });
        report('model', s);
        // (A limb drawn inside another mass at rest is no limb: said with the model.)
        for (const f of [...s.flags, ...boundFlags(creature)]) console.log(`  - ${f}`);
        return { written: [path], summary: `model sheet in ${Date.now() - t0} ms (body ${creature.timing.bodyMs} ms)` };
    }
    if (cmd === 'scenarios') {
        for (const name of all) console.log(`${name.padEnd(18)} ${scenariosFor(creature)[name].about || ''}`);
        return null;
    }
    const scenarios = rest.length ? (rest[0] === 'all' ? all : rest) : [...MOTION, ...ACTIONS];
    const dir = `${outRoot(opt)}/${safe(creature.label)}${other ? '-vs-' + safe(other.label) : ''}`;
    const written = [];
    const t0 = Date.now();

    if (cmd === 'herd') {
        const r = herdCost(creature, { count: opt.count ? +opt.count : 50, scenario: rest[0] || 'trot', frames: opt.frames ? +opt.frames : 240 });
        console.log(`${r.count} x ${r.creature} ${r.scenario}: ${r.herdTriangles} triangles (${r.triangles} each), GPU ms a frame mean ${r.gpu.mean}, median ${r.gpu.median}, p90 ${r.gpu.p90}; rig ${JSON.stringify(r.kernelsBy)}`);
        console.log(`  passes ${JSON.stringify(r.passes)}`);
        const path = `${dir}/herd-${r.scenario}-${r.count}.json`;
        writeFile(path, json(r));
        written.push(path);
    } else if (cmd === 'flock') {
        const behaviour = rest[0] || 'graze', count = opt.count ? +opt.count : 200;
        const shadows = opt.shadows !== 'off';
        const view = ['ground', 'close'].includes(opt.view) ? opt.view : 'field';
        const cull = opt.cull !== 'off';
        const base = `${dir}/flock-${behaviour}-${count}${shadows ? '' : '-noshadow'}${view === 'field' ? '' : '-' + view}${cull ? '' : '-nocull'}`;
        const r = flockCost(creature, { count, behaviour, shadows, view, cull, frames: opt.frames ? +opt.frames : 240,
            warm: opt.warm ? +opt.warm : 600, shot: base + '.png' });
        console.log(`${r.count} x ${r.creature} ${r.behaviour} (${r.view} view, field ${r.field} m, shadows ${r.shadows ? 'on' : 'off'}): levels drew ${r.levels.drawn.join(' / ')} (${r.levels.triangles.join(' / ')} triangles each), ${r.triangles} triangles, GPU ms a frame mean ${r.gpu.mean}, median ${r.gpu.median}, p90 ${r.gpu.p90}; kernels ${JSON.stringify(r.kernelsBy)}`);
        console.log(`  passes ${JSON.stringify(r.passes)}`);
        console.log(`  group ${JSON.stringify(r.group)}`);
        writeFile(base + '.json', json(r));
        written.push(base + '.json', base + '.png');
    } else if (cmd === 'finder') {
        const fdir = `${dir}/finder`;
        const fs = require('fs');
        const todo = opt.rank && !rest.length ? [] : scenarios;
        for (const sc of todo) {
            const s = scanScenario(creature, sc, { seed, every: opt.every ? +opt.every : undefined });
            const path = `${fdir}/scan-${sc}.json`;
            writeFile(path, JSON.stringify(s) + '\n');
            written.push(path);
            const top = new Map();
            for (const l of s.looks) for (const v of Object.values(l.views)) for (const x of v.sites) top.set(x.key, Math.max(top.get(x.key) || 0, x.score));
            console.log(`${sc}: ${s.frames.length} frames on the mesh, ${s.looks.length} looked at (${s.ms.total} ms); worst seen: ` +
                [...top].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', '));
        }
        const scans = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((f) => /^scan-.*\.json$/.test(f)).sort()
            .map((f) => JSON.parse(fs.readFileSync(`${fdir}/${f}`, 'utf-8'))) : [];
        if (!scans.length) throw new Error(`finder: nothing scanned in ${fdir}`);
        const r = finderReport(creature, scans, fdir, { top: opt.top !== undefined ? +opt.top : 10 });
        for (const m of r.worst) console.log(`  #${m.rank} ${m.score}  ${m.key}  (${m.scenario} t ${m.t} s, ${m.view}) -> ${m.image}`);
        written.push(`${fdir}/finder.json`, r.index, ...r.worst.map((m) => m.image), ...r.charts);
    } else if (cmd === 'score' || cmd === 'sweep' || cmd === 'kinks' || cmd === 'trace') {
        const scs = rest.length ? scenarios : NATURAL;
        let lines = [], file;
        if (cmd === 'score' && opt.vs) {
            const vs = await loadCreature(String(opt.vs), knobs);
            ({ lines } = compareTable([{ label: vs.label, creature: vs }, { label: creature.label, creature }], scs, analyzeRun, { seed }));
            file = `${dir}/score-vs-${safe(vs.label)}.txt`;
        } else if (cmd === 'score') {
            ({ lines } = scoreTable(creature, scs, analyzeRun, { seed }));
            file = `${dir}/score.txt`;
        } else if (cmd === 'sweep') {
            if (!opt.sweep) throw new Error(`sweep: give --sweep NAME=a,b,c\n${HELP}`);
            const r = await sweepTable(spec, opt.sweep, scs, analyzeRun, { knobs, seed });
            lines = r.lines;
            file = `${dir}/sweep-${r.name}.txt`;
        } else if (cmd === 'kinks') {
            for (const sc of scs) lines.push(...kinkReport(naturalRun(creature, sc, { seed }), { bone: opt.bone || null, at: opt.at || null }).lines);
            file = `${dir}/kinks.txt`;
        } else {
            if (!rest.length) throw new Error(`trace: name a scenario\n${HELP}`);
            const r = traceText(runScenario(creature, rest[0], { seed }), {
                leg: opt.leg || null, bones: opt.bones ? String(opt.bones).split(',') : null,
                from: opt.from !== undefined ? +opt.from : null, to: opt.to !== undefined ? +opt.to : null, every: opt.every ? +opt.every : 1,
            });
            lines = r.lines;
            file = `${dir}/${rest[0]}-trace.txt`;
        }
        for (const l of lines) console.log(l);
        writeFile(file, lines.join('\n') + '\n');
        written.push(file);
    } else if (cmd === 'natural') {
        const r = naturalReport(creature, rest.length ? scenarios : NATURAL, `${dir}/natural`, { seed });
        for (const line of r.lines) console.log(line);
        written.push(...r.written);
    } else if (cmd === 'form') {
        const { X, form } = restForm(creature);
        console.log(`rest: ${form.flags.length ? form.flags.length + ' off the reference' : 'on the reference'}`);
        for (const f of form.flags) console.log(`  - ${f}`);
        const runs = {};
        for (const sc of (rest.length ? scenarios : MOTION.slice(0, 2))) {
            const m = formInMotion(creature, runScenario(creature, sc, { seed }), X);
            runs[sc] = m;
            const span = (o) => Object.entries(o).map(([k, v]) => `${k} ${(100 * v.min).toFixed(1)}..${(100 * v.max).toFixed(1)}`).join(', ');
            console.log(`${sc}: area % ${span(m.area)}`);
            console.log(`${sc}: volume % ${span(m.volume)}, body ${(100 * m.body.min).toFixed(1)}..${(100 * m.body.max).toFixed(1)}`);
            for (const f of m.flags) console.log(`  - ${f}`);
        }
        const path = `${dir}/form.json`;
        writeFile(path, json({ creature: creature.label, rest: form, motion: runs }));
        written.push(path);
    } else if (cmd === 'watch') {
        // One run from one side, large: it takes one scenario and a view, and no more.
        if (rest.length !== 1 || !opt.view) throw new Error(`watch: name one scenario and one --view (${Object.keys(WATCH_VIEWS).join(', ')}); it draws at most ${WATCH.frames} frames, large, and is run again for another view`);
        const sc = rest[0], rec = runScenario(creature, sc, { seed });
        const num = (v) => (v !== undefined ? +v : null);
        const part = opt.from !== undefined || opt.span !== undefined ? `-${String(opt.from ?? 0)}+${String(opt.span ?? 1)}` : '';
        const s = watchSheet(rec, { path: `${dir}/${sc}-watch-${opt.view}${part}.png`, view: String(opt.view), frames: opt.frames ? +opt.frames : WATCH.frames,
            from: num(opt.from), span: num(opt.span), to: num(opt.to) });
        written.push(s.path);
        report(sc, s, ` ${s.cell} px a frame`);
    } else if (cmd === 'metrics' || KINDS.includes(cmd) || CLOSE.includes(cmd) || cmd === 'sheets') {
        const kinds = cmd === 'sheets' ? KINDS : KINDS.includes(cmd) || CLOSE.includes(cmd) ? [cmd] : [];
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
                if (s.json) {
                    const jp = `${dir}/${sc}-${kind}.json`;
                    writeFile(jp, json({ creature: creature.label, scenario: sc, ...s.json }));
                    written.push(jp);
                    for (const p of (s.json.byPlace || []).slice(0, 8)) console.log(`  - ${p.place}: ${p.count}`);
                    for (const f of (s.json.flags || [])) console.log(`  - ${f}`);
                    if (kind === 'upper') for (const l of upperLines(s.json)) console.log(`  ${l}`);
                }
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
