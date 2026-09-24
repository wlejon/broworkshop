// The agent's tools (lib/kit/agent-tools.js) against a scratch directory:
// file round trips, edit_file's uniqueness rule, list_dir, eval_js in the
// live engine (value, console capture, thrown errors) and bash.
import { check, eq, test, done, pumpUntil } from "/lib/kit/test.js";
import { codingTools } from "/lib/kit/agent-tools.js";

const fs = require('fs');
const dir = (require('os').tmpdir() + '/pi-agent-tools-test').replace(/\\/g, '/');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
const tools = Object.fromEntries(codingTools(dir).map((t) => [t.name, t]));
const run = (name, args) => tools[name].execute('t', args, new AbortController().signal, () => {});
const txt = (r) => r.content[0].text;

eq(Object.keys(tools), ['read_file', 'write_file', 'edit_file', 'list_dir', 'bash', 'eval_js'], 'tool set');

await test('write then read (UTF-8, parent dirs created)', async () => {
    const w = await run('write_file', { path: 'sub/a.txt', content: 'hello-seam-é' });
    eq(w.details.bytes, 13, 'utf-8 byte count');
    eq(txt(await run('read_file', { path: 'sub/a.txt' })), 'hello-seam-é');
});

await test('edit_file replaces exactly one occurrence', async () => {
    await run('write_file', { path: 'b.txt', content: 'x y x' });
    const dup = await run('edit_file', { path: 'b.txt', old_text: 'x', new_text: 'z' });
    check(dup.details.error && dup.details.occurrences === 2, 'refuses a non-unique match');
    const missing = await run('edit_file', { path: 'b.txt', old_text: 'q', new_text: 'z' });
    check(missing.details.error && /not found/.test(txt(missing)), 'reports a missing match');
    const ok = await run('edit_file', { path: 'b.txt', old_text: 'y', new_text: 'Y' });
    check(!ok.details.error, txt(ok));
    eq(fs.readFileSync(dir + '/b.txt', 'utf-8'), 'x Y x');
});

await test('list_dir marks directories', async () => {
    eq(txt(await run('list_dir', {})), 'b.txt\nsub/');
});

await test('read of a missing file is an error result', async () => {
    const r = await run('read_file', { path: 'nope.txt' });
    check(r.details.error && /^Error: /.test(txt(r)), txt(r));
});

await test('eval_js runs in the engine', async () => {
    const r = await run('eval_js', { code: "console.log('from-eval'); return typeof document + ',' + typeof bro + ',' + 6 * 7;" });
    eq(txt(r), 'from-eval\n=> "object,object,42"');
    const p = await run('eval_js', { code: 'return Promise.resolve({ a: 1 });' });
    eq(txt(p), '=> {"a":1}', 'awaits a promise');
    const e = await run('eval_js', { code: "throw new Error('boom');" });
    check(e.details.error && /boom/.test(txt(e)), 'thrown error as content');
});

await test('bash runs a command', async () => {
    let r = null;
    run('bash', { command: 'echo seamhello' }).then((x) => { r = x; });
    check(pumpUntil(() => r, 20000), 'bash finished');
    check(/seamhello/.test(txt(r)), txt(r));
    eq(r.details.exitCode, 0);
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
done('tools');
