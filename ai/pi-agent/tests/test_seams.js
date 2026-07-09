// Hard gate #2: the ExecutionEnv + tools work end-to-end inside the engine.
// fs + eval_js are the hard gate; bash is best-effort (brokit has no streaming
// spawn and cp async delivery may not be pumped in headless). Run:
//   bro-headless ai/pi-agent tests/test_seams.js

import { BrokitExecutionEnv, makeTools } from "/app/pi.bundle.js";

const os = require("os");
const cwd = os.tmpdir();
const env = new BrokitExecutionEnv(cwd);
const tools = Object.fromEntries(makeTools(env, cwd).map((t) => [t.name, t]));

const FNAME = "pi_agent_seam_test.txt";
const BODY = "hello-seam-é"; // includes a multibyte char

let coreDone = false;
let coreErr = null;

(async () => {
    // write -> read round trip through the tools (which unwrap env Results)
    const wr = await tools.write_file.execute("1", { path: FNAME, content: BODY });
    console.log("write_file =>", JSON.stringify(wr.content?.[0]?.text));

    const rd = await tools.read_file.execute("2", { path: FNAME });
    const readText = rd.content?.[0]?.text ?? "";
    console.log("read_file =>", JSON.stringify(readText));
    assert(readText.includes(BODY), "read_file returns the written content");

    // edit_file: unique replace
    const ed = await tools.edit_file.execute("3", { path: FNAME, old_text: "hello", new_text: "HELLO" });
    console.log("edit_file =>", JSON.stringify(ed.content?.[0]?.text));
    const rd2 = await tools.read_file.execute("4", { path: FNAME });
    assert((rd2.content?.[0]?.text ?? "").includes("HELLO-seam"), "edit_file applied the unique replace");

    // list_dir sees the file
    const ls = await tools.list_dir.execute("5", { path: "." });
    const lsText = ls.content?.[0]?.text ?? "";
    assert(typeof lsText === "string" && lsText.includes(FNAME), "list_dir lists the temp file");

    // eval_js: runs code in the live engine context, captures result + console
    const ev = await tools.eval_js.execute("6", { code: "console.log('from-eval'); return 6*7;" });
    const evText = ev.content?.[0]?.text ?? "";
    console.log("eval_js =>", JSON.stringify(evText));
    assert(evText.includes("42"), "eval_js computes 6*7 = 42");
    assert(evText.includes("from-eval"), "eval_js captures console output");

    // eval_js drives the engine: read the document title element count (proves
    // the agent's universal lever reaches the real DOM / globals).
    const ev2 = await tools.eval_js.execute("7", { code: "return typeof document + ',' + typeof bro;" });
    console.log("eval_js(engine) =>", JSON.stringify(ev2.content?.[0]?.text));
    assert((ev2.content?.[0]?.text ?? "").includes("object"), "eval_js can see engine globals");

    // eval_js never throws out of execute, even on a thrown error
    const ev3 = await tools.eval_js.execute("8", { code: "throw new Error('boom');" });
    assert((ev3.content?.[0]?.text ?? "").toLowerCase().includes("boom"), "eval_js reports thrown errors as content");

    // cleanup
    await env.remove(FNAME).catch(() => {});
    coreDone = true;
})().catch((e) => {
    coreErr = e;
    coreDone = true;
});

// Pump jobs (fs.promises resolve as microtasks; eval_js is sync) until core done.
for (let i = 0; i < 1500 && !coreDone; i++) advanceTime(10);
assert(coreDone, "core seam ops completed within budget");
if (coreErr) throw coreErr;

// Best-effort: bash echo through env.exec (real subprocess). Non-fatal.
let bashText = null;
tools.bash
    .execute("9", { command: 'echo seamhello' })
    .then((r) => { bashText = r.content?.[0]?.text ?? ""; })
    .catch((e) => { bashText = "ERR: " + (e?.message || e); });
for (let i = 0; i < 500 && bashText === null; i++) { advanceTime(10); wallSleep(3); }
console.log("bash =>", bashText === null ? "(no result — cp async not pumped in headless; non-fatal)" : JSON.stringify(bashText));

console.log("SEAM TEST PASSED (core: fs + eval_js)");
