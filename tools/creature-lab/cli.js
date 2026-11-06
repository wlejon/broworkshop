// Creature Lab from the command line (run from the broworkshop root):
//
//   bro-headless tools/creature-lab tools/creature-lab/cli.js -- <command> <creature> [scenario ...] [options]
//
// <creature> is a folder under creatures/, optionally `name@snapshot` and
// `:variant` (deer, deer@before, deer:slip). Scenarios default by command.
// Commands are listed in README.md; `help` prints them.

import { runCommand } from "/app/lab/commands.js";

const t0 = Date.now();
try {
    const out = await runCommand(bro.app.argv);
    if (out && out.summary) console.log(out.summary);
    console.log(`done in ${Date.now() - t0} ms`);
} catch (e) {
    console.error(`creature-lab: ${e && e.stack ? e.stack : e}`);
    globalThis.__creatureLabFailed = true;
    assert(false, String(e && e.message ? e.message : e));
}
