// tools.js — the maker-agent tool set: the same coding tools as pi-agent (files +
// bash + eval_js over the ExecutionEnv seam) PLUS `look`, the tool that closes the
// perceptual loop by capturing the live visual stage and returning a view of it.
//
// `eval_js` is the maker's primary lever: it runs JS in the LIVE bro engine, so the
// agent draws/builds into the on-screen stage element with it, then calls `look` to
// SEE the result and decide the next change — create → look → change, all in-app.
//
// The `look` implementation is app-side (it captures the stage and runs a vision
// model or hands the pixels to a vision-capable brain), injected as `opts.look`, so
// the bundle stays model-agnostic. If no look callback is supplied the tool is
// omitted (e.g. a headless run with no stage).
//
// Error signalling matches pi's contract: every execute() is total (resolves, never
// throws) and surfaces failures as an "Error: …" text content + details.error.

import { Type } from "@earendil-works/pi-ai";

// `console` is the live engine global (captured during eval_js).

const EVAL_MAX_CHARS = 8000;
const BASH_MAX_CHARS = 30000;

// ── result helpers ──────────────────────────────────────────────────────────

function textResult(text, details = {}) {
	return { content: [{ type: "text", text }], details };
}

function errorResult(message, extra = {}) {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: true, ...extra } };
}

function describeErr(e) {
	if (!e) return "unknown error";
	const code = e.code ? `${e.code}: ` : "";
	const msg = typeof e.message === "string" && e.message ? e.message : String(e);
	return code + msg;
}

function safeStringify(value) {
	try {
		const json = JSON.stringify(value);
		if (json !== undefined) return json;
	} catch {
		/* fall through */
	}
	try {
		return String(value);
	} catch {
		return "[unstringifiable value]";
	}
}

function stringifyArg(a) {
	return typeof a === "string" ? a : safeStringify(a);
}

function truncate(s, max) {
	if (s.length <= max) return s;
	return s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]`;
}

function utf8ByteLength(s) {
	let bytes = 0;
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			bytes += 4;
			i++;
		} else bytes += 3;
	}
	return bytes;
}

function countOccurrences(haystack, needle) {
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

function firstLine(s) {
	const nl = s.indexOf("\n");
	const line = nl === -1 ? s : s.slice(0, nl) + " …";
	return truncate(line, 200);
}

// ── the tool set ────────────────────────────────────────────────────────────
//
// opts: { look?: (instruction) => Promise<AgentToolResult> }
//   look — capture the live stage and return a view of it. Supplied by the app: it
//   may return a text critique (a separate vision model looked) or an image content
//   block (handed straight to a vision-capable brain). Omit to drop the `look` tool.

export function makeTools(env, cwd, opts = {}) {
	const readFileTool = {
		name: "read_file",
		label: "Read file",
		description:
			"Read a UTF-8 text file and return its full contents. `path` may be relative to the " +
			"working directory or absolute.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)." }),
		}),
		executionMode: "parallel",
		async execute(_id, params, signal) {
			try {
				const res = await env.readTextFile(params.path, signal);
				if (!res.ok) return errorResult(`could not read ${params.path}: ${describeErr(res.error)}`);
				return textResult(res.value, { path: params.path, bytes: utf8ByteLength(res.value) });
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const writeFileTool = {
		name: "write_file",
		label: "Write file",
		description:
			"Create or OVERWRITE a file with the given contents, creating parent directories as needed. " +
			"Use edit_file for small in-place changes; use this to create new files or fully replace one.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to write (relative or absolute)." }),
			content: Type.String({ description: "Full new contents of the file." }),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal) {
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

	const editFileTool = {
		name: "edit_file",
		label: "Edit file",
		description:
			"Replace exactly one occurrence of `old_text` with `new_text` in a file. `old_text` must appear " +
			"EXACTLY ONCE — include enough surrounding context to make it unique. Fails (without writing) if " +
			"`old_text` is not found or is not unique.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to edit (relative or absolute)." }),
			old_text: Type.String({ description: "Exact text to replace. Must occur exactly once in the file." }),
			new_text: Type.String({ description: "Text to replace it with." }),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal) {
			try {
				const { path, old_text: oldText, new_text: newText } = params;
				if (oldText.length === 0) return errorResult("old_text must not be empty.", { path });

				const readRes = await env.readTextFile(path, signal);
				if (!readRes.ok) return errorResult(`could not read ${path}: ${describeErr(readRes.error)}`, { path });
				const content = readRes.value;

				const first = content.indexOf(oldText);
				if (first === -1) return errorResult(`old_text was not found in ${path}.`, { path });
				if (content.indexOf(oldText, first + oldText.length) !== -1) {
					const n = countOccurrences(content, oldText);
					return errorResult(
						`old_text is not unique in ${path} (${n} occurrences). Add more surrounding context.`,
						{ path, occurrences: n },
					);
				}

				const updated = content.slice(0, first) + newText + content.slice(first + oldText.length);
				const writeRes = await env.writeFile(path, updated, signal);
				if (!writeRes.ok) return errorResult(`could not write ${path}: ${describeErr(writeRes.error)}`, { path });

				return textResult(`Edited ${path}: replaced 1 occurrence.\n- ${firstLine(oldText)}\n+ ${firstLine(newText)}`, {
					path,
				});
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const listDirTool = {
		name: "list_dir",
		label: "List directory",
		description:
			"List the direct children of a directory (default: the working directory). Directories show a " +
			"trailing '/'. Does not recurse.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Directory to list. Defaults to '.'." })),
		}),
		executionMode: "parallel",
		async execute(_id, params, signal) {
			try {
				const path = params.path ?? ".";
				const res = await env.listDir(path, signal);
				if (!res.ok) return errorResult(`could not list ${path}: ${describeErr(res.error)}`, { path });
				const entries = res.value
					.slice()
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((info) => (info.kind === "directory" ? `${info.name}/` : info.name));
				return textResult(entries.length ? entries.join("\n") : "(empty directory)", {
					path,
					count: res.value.length,
				});
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};

	const bashTool = {
		name: "bash",
		label: "Run shell command",
		description:
			"Run a shell command in the working directory and return its combined stdout/stderr. A non-zero " +
			"exit code is reported but is not itself a tool failure.",
		parameters: Type.Object({
			command: Type.String({ description: "The shell command line to execute." }),
			timeout_seconds: Type.Optional(Type.Number({ description: "Kill the command after this many seconds." })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal) {
			try {
				const res = await env.exec(params.command, { cwd, timeout: params.timeout_seconds, abortSignal: signal });
				if (!res.ok) return errorResult(`command failed to run: ${describeErr(res.error)}`, { command: params.command });
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

	const evalJsTool = {
		name: "eval_js",
		label: "Evaluate JS in engine",
		description:
			"Run JavaScript in the LIVE bro engine — the context that owns `document`, the global `bro` API, the " +
			"scene graph, canvas, and settings. THIS IS YOUR MAIN LEVER FOR MAKING THINGS: render into the visual " +
			"stage with it. A container element with id 'stage' (also the global `stage`) is on screen for your " +
			"creations — append a <canvas>, build a scene, draw, animate. After you draw, call the `look` tool to " +
			"SEE the result. Runs as a function body: use multiple statements and `return` a value (or a Promise, " +
			"which is awaited) to report it. Anything you console.log is captured; the returned value is shown after `=> `.",
		parameters: Type.Object({
			code: Type.String({ description: "JavaScript to execute in the engine (function body; `return` a value/Promise)." }),
		}),
		executionMode: "sequential",
		async execute(_id, params) {
			const lines = [];
			const methods = ["log", "info", "warn", "error"];
			const saved = {};
			const capture = (...args) => {
				lines.push(args.map(stringifyArg).join(" "));
			};
			try {
				let result;
				try {
					for (const m of methods) {
						saved[m] = console[m];
						console[m] = capture;
					}
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
					for (const m of methods) console[m] = saved[m];
				}
				const logs = lines.length ? lines.join("\n") + "\n" : "";
				return textResult(truncate(logs + "=> " + safeStringify(result), EVAL_MAX_CHARS), { logs: lines });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const stack = err instanceof Error && err.stack ? err.stack : "";
				const logs = lines.length ? lines.join("\n") + "\n" : "";
				return {
					content: [{ type: "text", text: truncate(logs + `Error: ${message}` + (stack ? `\n${stack}` : ""), EVAL_MAX_CHARS) }],
					details: { error: true, message, stack, logs: lines },
				};
			}
		},
	};

	const tools = [readFileTool, writeFileTool, editFileTool, listDirTool, bashTool, evalJsTool];

	if (opts.look) {
		const lookFn = opts.look;
		tools.push({
			name: "look",
			label: "Look at the stage",
			description:
				"Capture the current visual stage — what you have drawn or built — and get a view of it back. Pass " +
				"`instruction` to focus the observation (e.g. 'is the horizon level and is the sun warm-colored?'). " +
				"This is how you SEE your own work: draw with eval_js, then look, then decide what to change. Call it " +
				"after each visible change and let what you see guide the next step.",
			parameters: Type.Object({
				instruction: Type.Optional(
					Type.String({ description: "What to look for or evaluate about the stage. Optional." }),
				),
			}),
			executionMode: "sequential",
			async execute(_id, params) {
				try {
					return await lookFn(params.instruction || "Describe what is currently on the stage in detail.");
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		});
	}

	return tools;
}
