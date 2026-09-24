// lib/kit/agent-tools.js — the coding tool set for lib/kit/agent.js agents:
// read_file, write_file, edit_file, list_dir, bash (brokit fs + child_process)
// and eval_js (run code in the live engine that hosts the agent).
//
//   import { codingTools, lookTool } from "/lib/kit/agent-tools.js";
//   const tools = codingTools(cwd);                 // paths resolve against cwd
//   tools.push(lookTool(async (instruction) => ...)); // an app-supplied perception tool
//
// Every execute() resolves (never throws): failures are an "Error: ..." text
// result with details.error, which the agent loop reports as a tool error.

import { textResult, errorResult } from "./agent.js";

const fs = require('fs');
const pathMod = require('path');
const cp = require('child_process');

const EVAL_MAX_CHARS = 8000;
const BASH_MAX_CHARS = 30000;

function describeErr(e) {
    if (!e) return 'unknown error';
    const code = e.code ? e.code + ': ' : '';
    return code + (typeof e.message === 'string' && e.message ? e.message : String(e));
}

function safeStringify(v) {
    try { const s = JSON.stringify(v); if (s !== undefined) return s; } catch (_) { /* fall through */ }
    try { return String(v); } catch (_) { return '[unstringifiable value]'; }
}

export function truncate(s, max) {
    return s.length <= max ? s : s.slice(0, max) + '\n… [truncated, ' + (s.length - max) + ' more chars]';
}

export function utf8Length(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

function countOccurrences(hay, needle) {
    let n = 0;
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
    return n;
}

function firstLine(s) {
    const nl = s.indexOf('\n');
    return truncate(nl === -1 ? s : s.slice(0, nl) + ' …', 200);
}

const str = (description) => ({ type: 'string', description });
const schema = (properties, required) => ({ type: 'object', properties, required: required || Object.keys(properties) });

/** Run a shell command: { stdout, stderr, exitCode } (resolves; spawn failures reject). */
export function runShell(command, { cwd, timeoutSec, signal } = {}) {
    return new Promise((resolve, reject) => {
        const opts = { cwd };
        if (timeoutSec > 0) opts.timeout = timeoutSec * 1000;
        if (signal) opts.signal = signal;
        cp.exec(command, opts, (error, stdout, stderr) => {
            const out = stdout == null ? '' : String(stdout);
            const err = stderr == null ? '' : String(stderr);
            if (!error) return resolve({ stdout: out, stderr: err, exitCode: 0 });
            if (signal && signal.aborted) return reject(new Error('aborted'));
            if (error.killed && timeoutSec > 0) return reject(new Error('timed out after ' + timeoutSec + ' s'));
            // A numeric code is the exit status of a command that did run.
            if (typeof error.code === 'number') return resolve({ stdout: out, stderr: err, exitCode: error.code });
            if (typeof error.code === 'string') return reject(error);
            resolve({ stdout: out, stderr: err, exitCode: 1 });
        });
    });
}

/**
 * Run `code` as a function body in this realm, capturing console output.
 * Resolves { ok, value, logs, error }.
 */
export async function evalInEngine(code) {
    const logs = [];
    const methods = ['log', 'info', 'warn', 'error'];
    const saved = {};
    for (const m of methods) {
        saved[m] = console[m];
        console[m] = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' '));
    }
    try {
        const fn = new Function(code);
        const value = await fn();
        return { ok: true, value, logs };
    } catch (e) {
        return { ok: false, error: e, logs };
    } finally {
        for (const m of methods) console[m] = saved[m];
    }
}

/**
 * The file/shell/engine tools, resolving relative paths against `cwd`.
 * opts: { evalJs = true, bash = true } drop tools an app does not want.
 */
export function codingTools(cwd, opts) {
    const o = Object.assign({ evalJs: true, bash: true }, opts);
    const resolve = (p) => (pathMod.isAbsolute(p) ? p : pathMod.resolve(cwd, p));
    const guard = (fn) => async (id, args, signal) => {
        try { return await fn(args, signal); }
        catch (e) { return errorResult(describeErr(e)); }
    };

    const tools = [
        {
            name: 'read_file', label: 'Read file',
            description: 'Read a UTF-8 text file and return its full contents. `path` may be relative to the working directory or absolute.',
            parameters: schema({ path: str('Path to the file to read (relative or absolute).') }),
            execute: guard(async ({ path }) => {
                const text = await fs.promises.readFile(resolve(path), 'utf-8');
                return textResult(text, { path, bytes: utf8Length(text) });
            }),
        },
        {
            name: 'write_file', label: 'Write file',
            description: 'Create or OVERWRITE a file with the given contents, creating parent directories as needed. ' +
                         'Use edit_file for small in-place changes; use this to create new files or fully replace one.',
            parameters: schema({ path: str('Path to the file to write (relative or absolute).'),
                                 content: str('Full new contents of the file.') }),
            execute: guard(async ({ path, content }) => {
                const abs = resolve(path);
                await fs.promises.mkdir(pathMod.dirname(abs), { recursive: true });
                await fs.promises.writeFile(abs, content, 'utf-8');
                const bytes = utf8Length(content);
                return textResult('Wrote ' + bytes + ' bytes to ' + path + '.', { path, bytes });
            }),
        },
        {
            name: 'edit_file', label: 'Edit file',
            description: 'Replace exactly one occurrence of `old_text` with `new_text` in a file. `old_text` must appear ' +
                         'EXACTLY ONCE: include enough surrounding context to make it unique. Fails (without writing) if ' +
                         '`old_text` is not found or is not unique.',
            parameters: schema({ path: str('Path to the file to edit (relative or absolute).'),
                                 old_text: str('Exact text to replace. Must occur exactly once in the file.'),
                                 new_text: str('Text to replace it with.') }),
            execute: guard(async ({ path, old_text: oldText, new_text: newText }) => {
                if (!oldText) return errorResult('old_text must not be empty.', { path });
                const abs = resolve(path);
                const text = await fs.promises.readFile(abs, 'utf-8');
                const at = text.indexOf(oldText);
                if (at === -1) return errorResult('old_text was not found in ' + path + '.', { path });
                if (text.indexOf(oldText, at + oldText.length) !== -1) {
                    const n = countOccurrences(text, oldText);
                    return errorResult('old_text is not unique in ' + path + ' (' + n + ' occurrences). Add more surrounding context.',
                                       { path, occurrences: n });
                }
                await fs.promises.writeFile(abs, text.slice(0, at) + newText + text.slice(at + oldText.length), 'utf-8');
                return textResult('Edited ' + path + ': replaced 1 occurrence.\n- ' + firstLine(oldText) + '\n+ ' + firstLine(newText), { path });
            }),
        },
        {
            name: 'list_dir', label: 'List directory',
            description: "List the direct children of a directory (default: the working directory). Directories show a trailing '/'. Does not recurse.",
            parameters: schema({ path: str("Directory to list. Defaults to '.'.") }, []),
            execute: guard(async ({ path }) => {
                const dir = path || '.';
                const entries = await fs.promises.readdir(resolve(dir), { withFileTypes: true });
                const names = entries.map((e) => {
                    const name = typeof e === 'string' ? e : e.name;
                    let isDir = typeof e === 'object' && typeof e.isDirectory === 'function' && e.isDirectory();
                    if (typeof e === 'string') { try { isDir = fs.statSync(resolve(dir) + '/' + name).isDirectory(); } catch (_) {} }
                    return isDir ? name + '/' : name;
                }).sort((a, b) => a.localeCompare(b));
                return textResult(names.length ? names.join('\n') : '(empty directory)', { path: dir, count: names.length });
            }),
        },
    ];

    if (o.bash) tools.push({
        name: 'bash', label: 'Run shell command',
        description: 'Run a shell command in the working directory and return its combined stdout/stderr. A non-zero exit code is reported but is not itself a tool failure.',
        parameters: schema({ command: str('The shell command line to execute.'),
                             timeout_seconds: { type: 'number', description: 'Kill the command after this many seconds.' } }, ['command']),
        execute: guard(async ({ command, timeout_seconds: t }, signal) => {
            const r = await runShell(command, { cwd, timeoutSec: t, signal });
            let out = r.stdout || '';
            if (r.stderr) out += (out ? '\n' : '') + r.stderr;
            if (r.exitCode !== 0) out += (out ? '\n' : '') + '[exit code ' + r.exitCode + ']';
            return textResult(truncate(out || '(no output)', BASH_MAX_CHARS), { exitCode: r.exitCode });
        }),
    });

    if (o.evalJs) tools.push({
        name: 'eval_js', label: 'Evaluate JS in engine',
        description: 'Run JavaScript in the LIVE bro engine that hosts this agent: the context owning `document`, the global ' +
                     '`bro` API, the scene graph and settings. Runs as a function body: use statements and `return` a value ' +
                     '(or a Promise, which is awaited). Anything you console.log is captured; the returned value is shown after `=> `.',
        parameters: schema({ code: str('JavaScript to execute in the engine (function body; `return` a value/Promise).') }),
        execute: async (id, { code }) => {
            const r = await evalInEngine(code);
            const logs = r.logs.length ? r.logs.join('\n') + '\n' : '';
            if (r.ok) return textResult(truncate(logs + '=> ' + safeStringify(r.value), EVAL_MAX_CHARS), { logs: r.logs });
            const msg = (r.error && r.error.message) || String(r.error);
            const stack = (r.error && r.error.stack) || '';
            return { content: [{ type: 'text', text: truncate(logs + 'Error: ' + msg + (stack ? '\n' + stack : ''), EVAL_MAX_CHARS) }],
                     details: { error: true, message: msg, stack, logs: r.logs } };
        },
    });

    return tools;
}

/**
 * A `look` tool over an app-supplied perception callback: look(instruction)
 * resolves a tool result (text description or image blocks). `description`
 * overrides the default wording.
 */
export function lookTool(look, description) {
    return {
        name: 'look', label: 'Look at the preview',
        description: description ||
            'Reload the live preview from the app files you have written and get a view of what actually rendered. ' +
            'The preview opens on a placeholder until you write `index.html`; you can look at any point. Pass ' +
            '`instruction` to focus the observation (e.g. "is the horizon level and is the sun warm-colored?"). ' +
            'This is how you SEE your own work: write files, then look, then decide what to change.',
        parameters: schema({ instruction: str('What to look for or evaluate about the preview. Optional.') }, []),
        async execute(id, args) {
            try { return await look((args && args.instruction) || 'Describe what is currently on the stage in detail.'); }
            catch (e) { return errorResult(describeErr(e)); }
        },
    };
}
