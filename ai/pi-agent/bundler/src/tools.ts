// tools.ts — the v1 tool set for the in-engine pi agent.
//
// Six AgentTools:
//   • read_file / write_file / edit_file / list_dir / bash — coding tools over the
//     ExecutionEnv seam (env.ts / BrokitExecutionEnv). All filesystem/shell work goes
//     through `env`, whose methods return a Result and never throw.
//   • eval_js — the universal engine-control lever: runs arbitrary JS in the LIVE bro
//     engine JS context (the same context that owns `document`, `bro`, the scene, etc.).
//
// Error signalling: the agent loop (agent-loop.ts) marks a tool result `isError` only
// when `execute` THROWS — AgentToolResult itself carries no `isError` field. Per the
// harness contract we keep every `execute` total (it always RESOLVES, never throws) and
// surface failures to the model as an "Error: …" text content plus `details.error = true`.
// The model reads the text content; `details` is for logs/UI.

import type { AgentTool, AgentToolResult, ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

// eval_js temporarily wraps the live engine's global console to capture output.
declare const console: any;

const EVAL_MAX_CHARS = 8000;
const BASH_MAX_CHARS = 30000;

// ── result helpers ──────────────────────────────────────────────────────────

function textResult(text: string, details: any = {}): AgentToolResult<any> {
	return { content: [{ type: "text", text }], details };
}

/** A failure surfaced to the model as text (there is no isError field to set). */
function errorResult(message: string, extra: any = {}): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details: { error: true, ...extra },
	};
}

/** Turn a FileError / ExecutionError (or anything) into a one-line description. */
function describeErr(e: any): string {
	if (!e) return "unknown error";
	const code = e.code ? `${e.code}: ` : "";
	const msg = typeof e.message === "string" && e.message ? e.message : String(e);
	return code + msg;
}

/** JSON.stringify with a String() fallback for circular / non-serializable values. */
function safeStringify(value: any): string {
	try {
		const json = JSON.stringify(value);
		if (json !== undefined) return json;
	} catch {
		// circular or throwing toJSON — fall through to String()
	}
	try {
		return String(value);
	} catch {
		return "[unstringifiable value]";
	}
}

function stringifyArg(a: any): string {
	return typeof a === "string" ? a : safeStringify(a);
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]`;
}

/** UTF-8 byte length without touching any runtime global (no TextEncoder). */
function utf8ByteLength(s: string): number {
	let bytes = 0;
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			// high surrogate — a full code point is 4 UTF-8 bytes; skip the low surrogate
			bytes += 4;
			i++;
		} else bytes += 3;
	}
	return bytes;
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let from = 0;
	for (;;) {
		const idx = haystack.indexOf(needle, from);
		if (idx === -1) break;
		count++;
		from = idx + needle.length;
	}
	return count;
}

function firstLine(s: string): string {
	const nl = s.indexOf("\n");
	const line = nl === -1 ? s : s.slice(0, nl) + " …";
	return truncate(line, 200);
}

// ── the tool set ────────────────────────────────────────────────────────────

export function makeTools(env: ExecutionEnv, cwd: string): AgentTool[] {
	const readFileTool: AgentTool = {
		name: "read_file",
		label: "Read file",
		description:
			"Read a UTF-8 text file and return its full contents. `path` may be relative to the " +
			"working directory or absolute. Use this to inspect source before editing it.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)." }),
		}),
		executionMode: "parallel",
		async execute(_id: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<any>> {
			try {
				const res = await env.readTextFile(params.path, signal);
				if (!res.ok) return errorResult(`could not read ${params.path}: ${describeErr(res.error)}`);
				return textResult(res.value, { path: params.path, bytes: utf8ByteLength(res.value) });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const writeFileTool: AgentTool = {
		name: "write_file",
		label: "Write file",
		description:
			"Create or OVERWRITE a file with the given contents, creating parent directories as " +
			"needed. `path` may be relative or absolute. Use edit_file for small in-place changes; " +
			"use this to create new files or fully replace one.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to write (relative or absolute)." }),
			content: Type.String({ description: "Full new contents of the file." }),
		}),
		executionMode: "sequential",
		async execute(_id: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<any>> {
			try {
				const res = await env.writeFile(params.path, params.content, signal);
				if (!res.ok) return errorResult(`could not write ${params.path}: ${describeErr(res.error)}`);
				const bytes = utf8ByteLength(params.content);
				return textResult(`Wrote ${bytes} bytes to ${params.path}.`, { path: params.path, bytes });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const editFileTool: AgentTool = {
		name: "edit_file",
		label: "Edit file",
		description:
			"Replace exactly one occurrence of `old_text` with `new_text` in a file. `old_text` must " +
			"appear EXACTLY ONCE in the file — include enough surrounding context to make it unique. " +
			"Fails (without writing) if `old_text` is not found or is not unique.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to edit (relative or absolute)." }),
			old_text: Type.String({ description: "Exact text to replace. Must occur exactly once in the file." }),
			new_text: Type.String({ description: "Text to replace it with." }),
		}),
		executionMode: "sequential",
		async execute(_id: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<any>> {
			try {
				const path = params.path;
				const oldText = params.old_text;
				const newText = params.new_text;

				if (oldText.length === 0) {
					return errorResult("old_text must not be empty.", { path });
				}

				const readRes = await env.readTextFile(path, signal);
				if (!readRes.ok) return errorResult(`could not read ${path}: ${describeErr(readRes.error)}`, { path });
				const content = readRes.value;

				const first = content.indexOf(oldText);
				if (first === -1) {
					return errorResult(`old_text was not found in ${path}.`, { path });
				}
				if (content.indexOf(oldText, first + oldText.length) !== -1) {
					const n = countOccurrences(content, oldText);
					return errorResult(
						`old_text is not unique in ${path} (${n} occurrences). ` +
							"Add more surrounding context so it matches exactly once.",
						{ path, occurrences: n },
					);
				}

				const updated = content.slice(0, first) + newText + content.slice(first + oldText.length);
				const writeRes = await env.writeFile(path, updated, signal);
				if (!writeRes.ok) return errorResult(`could not write ${path}: ${describeErr(writeRes.error)}`, { path });

				const diff = `- ${firstLine(oldText)}\n+ ${firstLine(newText)}`;
				return textResult(`Edited ${path}: replaced 1 occurrence.\n${diff}`, { path });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const listDirTool: AgentTool = {
		name: "list_dir",
		label: "List directory",
		description:
			"List the direct children of a directory (default: the working directory). Directories are " +
			"shown with a trailing '/'. Does not recurse — use bash `find`/`ls -R` for deep listings.",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "Directory to list (relative or absolute). Defaults to '.'." }),
			),
		}),
		executionMode: "parallel",
		async execute(_id: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<any>> {
			try {
				const path = params.path ?? ".";
				const res = await env.listDir(path, signal);
				if (!res.ok) return errorResult(`could not list ${path}: ${describeErr(res.error)}`, { path });
				const entries = res.value
					.slice()
					.sort((a: any, b: any) => a.name.localeCompare(b.name))
					.map((info: any) => (info.kind === "directory" ? `${info.name}/` : info.name));
				const body = entries.length ? entries.join("\n") : "(empty directory)";
				return textResult(body, { path, count: res.value.length });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const bashTool: AgentTool = {
		name: "bash",
		label: "Run shell command",
		description:
			"Run a shell command in the working directory and return its combined stdout/stderr. Use " +
			"for builds, tests, git, and filesystem operations the dedicated tools don't cover. A " +
			"non-zero exit code is reported but is not itself a tool failure.",
		parameters: Type.Object({
			command: Type.String({ description: "The shell command line to execute." }),
			timeout_seconds: Type.Optional(
				Type.Number({ description: "Kill the command after this many seconds. Defaults to no timeout." }),
			),
		}),
		executionMode: "sequential",
		async execute(_id: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<any>> {
			try {
				const res = await env.exec(params.command, {
					cwd,
					timeout: params.timeout_seconds,
					abortSignal: signal,
				});
				if (!res.ok) {
					return errorResult(`command failed to run: ${describeErr(res.error)}`, {
						command: params.command,
					});
				}
				const { stdout, stderr, exitCode } = res.value;
				let out = stdout || "";
				if (stderr) out += (out ? "\n" : "") + stderr;
				if (exitCode !== 0) out += (out ? "\n" : "") + `[exit code ${exitCode}]`;
				if (!out) out = "(no output)";
				return textResult(truncate(out, BASH_MAX_CHARS), { exitCode });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const evalJsTool: AgentTool = {
		name: "eval_js",
		label: "Evaluate JS in engine",
		description:
			"Run JavaScript in the LIVE bro engine context — the same context that owns `document`, the " +
			"global `bro` API, the scene graph, and settings. This is your lever to inspect and drive the " +
			"running app. The code runs as a function body: use multiple statements and `return` a value to " +
			"report it. For async work, `return` a Promise (it is awaited) rather than using top-level `await`. " +
			"Anything you `console.log` is captured, then the returned value is shown after `=> `.",
		parameters: Type.Object({
			code: Type.String({
				description:
					"JavaScript to execute in the engine. Runs as a function body; `return` a value (or a " +
					"Promise for async work) to report it.",
			}),
		}),
		executionMode: "sequential",
		async execute(_id: string, params: any): Promise<AgentToolResult<any>> {
			const lines: string[] = [];
			const methods = ["log", "info", "warn", "error"] as const;
			const saved: Record<string, any> = {};
			const capture = (...args: any[]) => {
				lines.push(args.map(stringifyArg).join(" "));
			};
			try {
				let result: any;
				try {
					for (const m of methods) {
						saved[m] = console[m];
						console[m] = capture;
					}
					// Run the user code in a SYNC function so a synchronous throw is caught
					// immediately (no promise ever rejects) — an async function body would
					// transiently reject and trip the engine's rejection tracker, spamming
					// bro.log on every failing eval_js. A returned Promise is still awaited, so
					// async work is done via `return <promise>` (documented on the tool). The
					// `.then(ok, err)` folds a late rejection into a resolved outcome so it, too,
					// never surfaces as unhandled.
					const fn = new Function(
						"var __r;" +
							"try { __r = (function(){ " + params.code + " })(); }" +
							"catch (e) { return Promise.resolve({ __err: e }); }" +
							"return Promise.resolve(__r).then(function(v){ return { __val: v }; }, function(e){ return { __err: e }; });",
					);
					const outcome = await fn();
					if (outcome && "__err" in outcome) throw outcome.__err;
					result = outcome ? outcome.__val : undefined;
				} finally {
					for (const m of methods) {
						console[m] = saved[m];
					}
				}
				const logs = lines.length ? lines.join("\n") + "\n" : "";
				const out = truncate(logs + "=> " + safeStringify(result), EVAL_MAX_CHARS);
				return textResult(out, { logs: lines });
			} catch (err) {
				// Never let eval_js throw out of execute — report the error as a tool result.
				const message = err instanceof Error ? err.message : String(err);
				const stack = err instanceof Error && err.stack ? err.stack : "";
				const logs = lines.length ? lines.join("\n") + "\n" : "";
				const body = truncate(logs + `Error: ${message}` + (stack ? `\n${stack}` : ""), EVAL_MAX_CHARS);
				return {
					content: [{ type: "text", text: body }],
					details: { error: true, message, stack, logs: lines },
				};
			}
		},
	};

	return [readFileTool, writeFileTool, editFileTool, listDirTool, bashTool, evalJsTool];
}
