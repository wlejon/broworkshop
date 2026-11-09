// Creature Lab from the command line (run from the broworkshop root):
//
//   bro-headless tools/creature-lab tools/creature-lab/cli.js -- <command> <creature> [scenario ...] [options]
//
// <creature> is a folder under creatures/, optionally `name@snapshot` and
// `:variant` (deer, deer@before, deer:slip). Scenarios default by command.
// Commands are listed in README.md; `help` prints them.

import { runCommand } from "/app/lab/commands.js";

// `--profile` samples the command with bronze's profiler and prints where its
// time went (functions by self time, then by total), and who called the
// costliest ones.
function printProfile(p) {
    console.log(p.report);
    const F = p.functions, name = (i) => `${F[i].name} (${F[i].tier})`;
    for (let f = 0; f < Math.min(12, F.length); f++) {
        const by = p.callers.filter((e) => e.callee === f).slice(0, 3);
        if (by.length) console.log(`${name(f)} <- ${by.map((e) => `${name(e.caller)} ${e.count}`).join(', ')}`);
    }
    for (const f of F.slice(0, 40)) if (f.tier1Rejected) console.log(`${f.name}: tier 1 rejected it: ${f.tier1Rejected}`);
}
const argv = bro.app.argv.filter((a) => a !== '--profile');
const profile = argv.length !== bro.app.argv.length;
const t0 = Date.now();
try {
    if (profile) bro.profiler.start({ hz: 1000 });
    const out = await runCommand(argv);
    if (profile) printProfile(bro.profiler.stop({ report: true, top: 30, callers: true }));
    if (out && out.summary) console.log(out.summary);
    console.log(`done in ${Date.now() - t0} ms`);
} catch (e) {
    console.error(`creature-lab: ${e && e.stack ? e.stack : e}`);
    globalThis.__creatureLabFailed = true;
    assert(false, String(e && e.message ? e.message : e));
}
