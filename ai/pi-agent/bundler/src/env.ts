// env.ts — BrokitExecutionEnv: pi's FileSystem + Shell (ExecutionEnv) implemented
// over bro's brokit Node-compat layer (require('fs'|'path'|'os'|'child_process')).
//
// Faithful port of pi's reference NodeExecutionEnv
// (pi/packages/agent/src/harness/env/nodejs.ts) from node:fs/promises +
// node:child_process + node:os + node:path to the brokit equivalents.
//
// Invariant (from the FileSystem/Shell contracts): NO method here may throw or
// reject. Every fallible operation returns a Result and encodes failures as
// FileError / ExecutionError. Every body is wrapped in try/catch.

import {
	ExecutionError,
	FileError,
	err,
	ok,
	toError,
	type ExecutionEnv,
	type FileInfo,
	type FileKind,
	type Result,
} from "@earendil-works/pi-agent-core";

// brokit runtime globals. These are provided by bro at runtime; they must NOT be
// bundled by esbuild, so we reach them through the runtime `require`/globals
// rather than static `import`s. brokit installs `require` on the global object
// (brokit api.cpp installRequire), so we fetch it off globalThis — a renamed
// binding esbuild will not mistake for a bundle-time CommonJS require.
declare const process: any;
declare const Buffer: any;

const nodeRequire = (globalThis as any).require as (id: string) => any;

const fs = nodeRequire("fs"); // fs.promises.{readFile,writeFile,appendFile,readdir,lstat,mkdir,rm,realpath}
const path = nodeRequire("path"); // resolve, join, isAbsolute, basename
const os = nodeRequire("os"); // tmpdir()
const cp = nodeRequire("child_process"); // exec

// Temp-name uniqueness WITHOUT Date.now / Math.random (unavailable in some bro
// contexts): a monotonic module-level counter, salted with pid when available.
// Monotonicity guarantees uniqueness within a process; pid separates processes.
let tempCounter = 0;
function uniqueToken(): string {
	tempCounter += 1;
	let pid = 0;
	try {
		if (typeof process !== "undefined" && typeof process.pid === "number") pid = process.pid;
	} catch {
		pid = 0;
	}
	return `${pid}-${tempCounter}`;
}

/** Resolve `p` against `cwd`, mirroring nodejs.ts resolvePath(). */
function resolvePath(cwd: string, p: string): string {
	return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

/**
 * Map a brokit/Node-style error to a FileError, mirroring nodejs.ts toFileError().
 * Primary signal is the errno `code`; when brokit omits `code` we fall back to a
 * message substring probe so `exists()`/not_found detection stays correct.
 */
function toFileError(error: unknown, p?: string): FileError {
	if (error instanceof FileError) return error;
	const cause = toError(error);
	const rawCode =
		error && typeof error === "object" && "code" in (error as any) ? String((error as any).code) : "";
	const message = cause.message || String(error);
	// Prefer the explicit errno code; otherwise probe the message text.
	const probe = rawCode || message;
	const is = (needle: string): boolean => rawCode === needle || probe.includes(needle);

	if (is("ABORT_ERR") || cause.name === "AbortError") return new FileError("aborted", message, p, cause);
	if (is("ENOENT")) return new FileError("not_found", message, p, cause);
	if (is("EACCES") || is("EPERM")) return new FileError("permission_denied", message, p, cause);
	if (is("ENOTDIR")) return new FileError("not_directory", message, p, cause);
	if (is("EISDIR")) return new FileError("is_directory", message, p, cause);
	if (is("EINVAL")) return new FileError("invalid", message, p, cause);
	return new FileError("unknown", message, p, cause);
}

function fileKindFromStats(stats: {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}): FileKind | undefined {
	if (stats.isSymbolicLink()) return "symlink";
	if (stats.isDirectory()) return "directory";
	if (stats.isFile()) return "file";
	return undefined;
}

function fileInfoFromStats(
	p: string,
	stats: {
		isFile(): boolean;
		isDirectory(): boolean;
		isSymbolicLink(): boolean;
		size: number;
		mtimeMs: number;
	},
): Result<FileInfo, FileError> {
	const kind = fileKindFromStats(stats);
	if (!kind) return err(new FileError("invalid", "Unsupported file type", p));
	return ok({
		name: path.basename(p) || p,
		path: p,
		kind,
		size: typeof stats.size === "number" ? stats.size : 0,
		mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : 0,
	});
}

/** Short-circuit helper: returns an aborted Result if the signal already fired. */
function abortResult<TValue>(signal: AbortSignal | undefined, p?: string): Result<TValue, FileError> | undefined {
	return signal?.aborted ? err(new FileError("aborted", "aborted", p)) : undefined;
}

/** Coerce whatever fs.promises.readFile() returns into a Uint8Array. */
function toUint8Array(data: unknown): Uint8Array {
	if (data instanceof Uint8Array) return data; // Buffer is a Uint8Array subclass — covered here.
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (typeof data === "string") {
		const out = new Uint8Array(data.length);
		for (let i = 0; i < data.length; i += 1) out[i] = data.charCodeAt(i) & 0xff;
		return out;
	}
	try {
		return new Uint8Array(data as any);
	} catch {
		return new Uint8Array(0);
	}
}

/** Convert string | Uint8Array content into a value brokit fs.writeFile accepts. */
function toWritable(content: string | Uint8Array): { data: any; encoding?: string } {
	if (typeof content === "string") return { data: content, encoding: "utf-8" };
	if (typeof Buffer !== "undefined" && Buffer.from) return { data: Buffer.from(content) };
	return { data: content };
}

export class BrokitExecutionEnv implements ExecutionEnv {
	cwd: string;
	private tempPaths: string[] = [];

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	// ── Path helpers ──────────────────────────────────────────────────────────

	async absolutePath(p: string): Promise<Result<string, FileError>> {
		try {
			return ok(resolvePath(this.cwd, p));
		} catch (error) {
			return err(toFileError(error, p));
		}
	}

	async joinPath(parts: string[]): Promise<Result<string, FileError>> {
		try {
			return ok(parts.length > 0 ? path.join(...parts) : path.join("."));
		} catch (error) {
			return err(toFileError(error));
		}
	}

	async canonicalPath(p: string): Promise<Result<string, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		try {
			return ok(await fs.promises.realpath(resolved));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	// ── Reads ─────────────────────────────────────────────────────────────────

	async readTextFile(p: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<string>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			return ok(await fs.promises.readFile(resolved, "utf-8"));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async readTextLines(
		p: string,
		options?: { maxLines?: number; abortSignal?: AbortSignal },
	): Promise<Result<string[], FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<string[]>(options?.abortSignal, resolved);
		if (aborted) return aborted;
		if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
		try {
			// brokit has no streaming readline; read whole file and split. maxLines is
			// still honored by truncating (matching nodejs.ts's observable result).
			const text: string = await fs.promises.readFile(resolved, "utf-8");
			const afterRead = abortResult<string[]>(options?.abortSignal, resolved);
			if (afterRead) return afterRead;
			let lines = text.split(/\r?\n/);
			// A trailing newline yields a final empty element; drop it to match a
			// line reader's behavior (readline does not emit a phantom last line).
			if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
			if (options?.maxLines !== undefined && lines.length > options.maxLines) {
				lines = lines.slice(0, options.maxLines);
			}
			return ok(lines);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async readBinaryFile(p: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<Uint8Array>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			const data = await fs.promises.readFile(resolved);
			return ok(toUint8Array(data));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	// ── Writes ────────────────────────────────────────────────────────────────

	async writeFile(
		p: string,
		content: string | Uint8Array,
		abortSignal?: AbortSignal,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<void>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			await fs.promises.mkdir(path.resolve(resolved, ".."), { recursive: true });
			const afterMkdir = abortResult<void>(abortSignal, resolved);
			if (afterMkdir) return afterMkdir;
			const { data, encoding } = toWritable(content);
			await fs.promises.writeFile(resolved, data, encoding);
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async appendFile(p: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		try {
			await fs.promises.mkdir(path.resolve(resolved, ".."), { recursive: true });
			const { data, encoding } = toWritable(content);
			await fs.promises.appendFile(resolved, data, encoding);
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	// ── Metadata / listing ──────────────────────────────────────────────────────

	async fileInfo(p: string): Promise<Result<FileInfo, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		try {
			return fileInfoFromStats(resolved, await fs.promises.lstat(resolved));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async listDir(p: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<FileInfo[]>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
			const infos: FileInfo[] = [];
			for (const entry of entries) {
				const loopAbort = abortResult<FileInfo[]>(abortSignal, resolved);
				if (loopAbort) return loopAbort;
				const entryName = typeof entry === "string" ? entry : entry.name;
				const entryPath = path.resolve(resolved, entryName);
				try {
					const info = fileInfoFromStats(entryPath, await fs.promises.lstat(entryPath));
					if (info.ok) infos.push(info.value);
				} catch (error) {
					return err(toFileError(error, entryPath));
				}
			}
			return ok(infos);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async exists(p: string): Promise<Result<boolean, FileError>> {
		const result = await this.fileInfo(p);
		if (result.ok) return ok(true);
		if (result.error.code === "not_found") return ok(false);
		return err(result.error);
	}

	// ── Directory / removal ───────────────────────────────────────────────────

	async createDir(
		p: string,
		options?: { recursive?: boolean; abortSignal?: AbortSignal },
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<void>(options?.abortSignal, resolved);
		if (aborted) return aborted;
		try {
			await fs.promises.mkdir(resolved, { recursive: options?.recursive ?? true });
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async remove(
		p: string,
		options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, p);
		const aborted = abortResult<void>(options?.abortSignal, resolved);
		if (aborted) return aborted;
		try {
			await fs.promises.rm(resolved, {
				recursive: options?.recursive ?? false,
				force: options?.force ?? false,
			});
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	// ── Temp files/dirs (tracked for cleanup) ─────────────────────────────────

	async createTempDir(prefix: string = "tmp-"): Promise<Result<string, FileError>> {
		try {
			const dir = path.join(os.tmpdir(), `${prefix}${uniqueToken()}`);
			await fs.promises.mkdir(dir, { recursive: true });
			this.tempPaths.push(dir);
			return ok(dir);
		} catch (error) {
			return err(toFileError(error));
		}
	}

	async createTempFile(options?: {
		prefix?: string;
		suffix?: string;
		abortSignal?: AbortSignal;
	}): Promise<Result<string, FileError>> {
		const dir = await this.createTempDir("tmp-");
		if (!dir.ok) return dir;
		const filePath = path.join(dir.value, `${options?.prefix ?? ""}${uniqueToken()}${options?.suffix ?? ""}`);
		try {
			await fs.promises.writeFile(filePath, "", "utf-8");
			this.tempPaths.push(filePath);
			return ok(filePath);
		} catch (error) {
			return err(toFileError(error, filePath));
		}
	}

	// ── Shell ─────────────────────────────────────────────────────────────────

	async exec(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeout?: number;
			abortSignal?: AbortSignal;
			onStdout?: (chunk: string) => void;
			onStderr?: (chunk: string) => void;
		},
	): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
		if (options?.abortSignal?.aborted) return err(new ExecutionError("aborted", "aborted"));

		// Validate the timeout up front (mirrors nodejs.ts resolveTimeoutMs).
		let timeoutMs: number | undefined;
		if (options?.timeout !== undefined) {
			if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
				return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
			}
			timeoutMs = options.timeout * 1000;
		}

		const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;

		// Merge process.env with per-call overrides (nodejs.ts semantics: overrides
		// win, base environment is inherited). process.env is a Proxy — guard the spread.
		let env: Record<string, string> | undefined;
		if (options?.env) {
			let base: Record<string, string> = {};
			try {
				if (typeof process !== "undefined" && process.env) base = { ...process.env };
			} catch {
				base = {};
			}
			env = { ...base, ...options.env };
		}

		return await new Promise((resolvePromise) => {
			const execOptions: any = { cwd };
			if (env) execOptions.env = env;
			if (timeoutMs !== undefined) execOptions.timeout = timeoutMs;
			// Best-effort: brokit may honor these; if not, they are simply ignored.
			if (options?.abortSignal) execOptions.signal = options.abortSignal;

			try {
				cp.exec(command, execOptions, (error: any, stdout: any, stderr: any) => {
					const out = stdout == null ? "" : String(stdout);
					const errOut = stderr == null ? "" : String(stderr);

					// brokit has no streaming spawn: deliver the whole output once.
					try {
						options?.onStdout?.(out);
					} catch {
						/* callback errors must not break exec */
					}
					try {
						options?.onStderr?.(errOut);
					} catch {
						/* callback errors must not break exec */
					}

					if (error) {
						if (options?.abortSignal?.aborted) {
							resolvePromise(err(new ExecutionError("aborted", "aborted")));
							return;
						}
						// Timeout: Node marks the killed child; approximate for brokit.
						if (error.killed && timeoutMs !== undefined) {
							resolvePromise(err(new ExecutionError("timeout", `timeout:${options?.timeout}`)));
							return;
						}
						// A numeric `code` is the process exit code — a real run that
						// exited non-zero, not a spawn failure. Resolve ok with it.
						if (typeof error.code === "number") {
							resolvePromise(ok({ stdout: out, stderr: errOut, exitCode: error.code }));
							return;
						}
						// A string errno (ENOENT, etc.) or no code => the shell/command
						// could not be spawned.
						if (typeof error.code === "string") {
							const cause = toError(error);
							resolvePromise(err(new ExecutionError("spawn_error", cause.message, cause)));
							return;
						}
						// Unknown error object with output present: treat as a failed run.
						resolvePromise(ok({ stdout: out, stderr: errOut, exitCode: 1 }));
						return;
					}

					resolvePromise(ok({ stdout: out, stderr: errOut, exitCode: 0 }));
				});
			} catch (spawnError) {
				const cause = toError(spawnError);
				resolvePromise(err(new ExecutionError("spawn_error", cause.message, cause)));
			}
		});
	}

	// ── Cleanup (FileSystem + Shell) ──────────────────────────────────────────

	async cleanup(): Promise<void> {
		const paths = this.tempPaths;
		this.tempPaths = [];
		for (const p of paths) {
			try {
				await fs.promises.rm(p, { recursive: true, force: true });
			} catch {
				// best-effort: swallow removal errors.
			}
		}
	}
}
