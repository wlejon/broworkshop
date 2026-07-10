// openrouter.js — adapt OpenRouter's OpenAI-compatible /chat/completions API into
// a pi-agent StreamFn, using NATIVE structured tool-calling: we send pi's tools as
// the OpenAI `tools` schema and read `tool_calls` straight back off the response,
// so there is NO fragile <tool_call> text parsing (that path lives in provider.js
// for local brolm models). Talks HTTP directly over brokit's global `fetch` — pi's
// bundled OpenAI SDK is stubbed by the bundler and pulls Node bits we don't want.
//
// v1 is NON-streaming: one request per turn, then the full assistant message (text
// + tool_calls) is replayed as a synthetic AssistantMessageEvent sequence. That is
// robust and simple; token-level streaming is a later enhancement (brokit fetch
// exposes response.body.getReader for SSE when we want it).
//
// Free OpenRouter models are intermittently rate-limited upstream (HTTP 429), so
// every request retries with exponential backoff before surfacing an error.

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

// `fetch` / `setTimeout` are brokit runtime globals — left as free references.

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouterConfig: { apiKey, model, baseUrl?, referer?, title?, maxRetries? }

// A monotonic fallback id counter for tool calls the provider didn't id.
let fallbackToolId = 0;

function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function mkUsage(input, output) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

// ---------------------------------------------------------------------------
// pi Context → OpenAI chat-completions request payload
// ---------------------------------------------------------------------------

function toOpenAIToolSchema(tools) {
	if (!tools || !tools.length) return undefined;
	return tools.map((t) => ({
		type: "function",
		function: { name: t.name, description: t.description, parameters: t.parameters },
	}));
}

// A user message's content: plain string, or (for vision) an array of text +
// image_url parts. pi ImageContent carries base64 `data` + `mimeType`.
function userContentToOpenAI(content) {
	if (typeof content === "string") return content;
	return content.map((b) =>
		b.type === "text"
			? { type: "text", text: b.text }
			: { type: "image_url", image_url: { url: `data:${b.mimeType};base64,${b.data}` } },
	);
}

// Assistant text (thinking blocks are not replayed to the model).
function assistantText(content) {
	let out = "";
	for (const b of content) if (b.type === "text") out += b.text;
	return out;
}

function assistantToolCalls(content) {
	const calls = [];
	for (const b of content) {
		if (b.type === "toolCall") {
			calls.push({
				id: b.id,
				type: "function",
				function: { name: b.name, arguments: JSON.stringify(b.arguments ?? {}) },
			});
		}
	}
	return calls.length ? calls : undefined;
}

// Build the OpenAI `messages` array from pi's Context. Tool results become
// {role:"tool"} messages; any images they carry are appended as a following user
// message (OpenAI rejects image parts inside a tool message), matching pi's own
// openai-completions transform.
function buildMessages(context, visionCapable) {
	const out = [];
	const sys = context.systemPrompt;
	if (sys) out.push({ role: "system", content: sys });

	for (const message of context.messages) {
		if (message.role === "user") {
			out.push({ role: "user", content: userContentToOpenAI(message.content) });
		} else if (message.role === "assistant") {
			const text = assistantText(message.content);
			const toolCalls = assistantToolCalls(message.content);
			if (!text && !toolCalls) continue; // some providers reject empty assistant turns
			const m = { role: "assistant", content: text || "" };
			if (toolCalls) m.tool_calls = toolCalls;
			out.push(m);
		} else if (message.role === "toolResult") {
			const tr = message;
			const text = tr.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
			const images = tr.content.filter((b) => b.type === "image");
			const body = text || (images.length ? "(see attached image)" : "(no tool output)");
			out.push({ role: "tool", tool_call_id: tr.toolCallId, content: body });
			// Surface tool-result images to a vision model as a trailing user turn.
			if (images.length && visionCapable) {
				out.push({
					role: "user",
					content: images.map((b) => ({
						type: "image_url",
						image_url: { url: `data:${b.mimeType};base64,${b.data}` },
					})),
				});
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// HTTP with retry/backoff
// ---------------------------------------------------------------------------

function isRetryable(status, body) {
	if (status === 429 || status >= 500) return true;
	const code = body && body.error && body.error.code;
	return code === 429 || (typeof code === "number" && code >= 500);
}

// Free models route to shared upstream providers that rate-limit (429). Honor the
// server's stated wait: the `Retry-After` response header (seconds) and OpenRouter's
// `error.metadata.retry_after_seconds`, so we wait the REAL window instead of a
// too-short exponential backoff. Returns 0 if the server gave no hint.
function serverRetryMs(retryAfterHeader, body) {
	const meta = body && body.error && body.error.metadata;
	const ra = meta && meta.retry_after_seconds;
	if (typeof ra === "number" && ra > 0) return ra * 1000;
	const h = retryAfterHeader != null ? retryAfterHeader : meta && meta.headers && meta.headers["Retry-After"];
	if (h != null) {
		const secs = Number(h);
		if (Number.isFinite(secs) && secs > 0) return secs * 1000;
	}
	return 0;
}

// The wait before the next attempt: the server's Retry-After if given (capped),
// else exponential backoff. Never below 400ms so we don't hammer.
function backoffMs(attempt, body, retryAfterHeader) {
	const server = serverRetryMs(retryAfterHeader, body);
	if (server > 0) return Math.min(server + 300, 30000);
	return Math.max(400, Math.min(800 * Math.pow(2, attempt), 12000));
}

function readRetryAfter(resp) {
	try {
		return resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
	} catch {
		return null;
	}
}

// Abort-aware sleep: a rate-limit backoff can be 30s — Stop must not wait it
// out. Resolves early (and unhooks its listener) when the signal aborts; the
// caller's `signal?.aborted` check then exits the retry loop.
function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		let timer = null;
		const onAbort = () => {
			if (timer != null) clearTimeout(timer);
			resolve();
		};
		timer = setTimeout(() => {
			signal?.removeEventListener?.("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener?.("abort", onAbort);
	});
}

async function postCompletion(cfg, payload, signal) {
	const base = cfg.baseUrl || DEFAULT_BASE_URL;
	const url = base.replace(/\/$/, "") + "/chat/completions";
	const headers = {
		Authorization: "Bearer " + cfg.apiKey,
		"Content-Type": "application/json",
	};
	if (cfg.referer) headers["HTTP-Referer"] = cfg.referer;
	if (cfg.title) headers["X-Title"] = cfg.title;

	const maxRetries = cfg.maxRetries ?? 5;
	let lastErr = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (signal?.aborted) throw new Error("aborted");
		let status = 0;
		let body = null;
		let retryAfter = null;
		try {
			const resp = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal,
			});
			status = resp.status;
			retryAfter = readRetryAfter(resp);
			body = await resp.json();
		} catch (e) {
			lastErr = e;
			if (signal?.aborted) throw new Error("aborted");
			if (attempt < maxRetries) {
				await sleep(backoffMs(attempt, null, null), signal);
				continue;
			}
			throw e;
		}
		if (status >= 200 && status < 300 && body && !body.error) return body;

		lastErr = body && body.error ? body.error : { message: "HTTP " + status };
		if (isRetryable(status, body) && attempt < maxRetries) {
			const wait = backoffMs(attempt, body, retryAfter);
			// Let the app surface the wait (e.g. "rate-limited, retrying in 22s").
			if (typeof cfg.onRateLimit === "function" && status === 429) {
				try { cfg.onRateLimit({ model: cfg.model, waitMs: wait, attempt }); } catch {}
			}
			await sleep(wait, signal);
			continue;
		}
		break;
	}
	const msg = lastErr && lastErr.message ? lastErr.message : String(lastErr);
	throw new Error("OpenRouter request failed: " + msg);
}

// ---------------------------------------------------------------------------
// StreamFn factory
// ---------------------------------------------------------------------------

function makeAssistantMessage(model, content, stopReason, usage, errorMessage) {
	return {
		role: "assistant",
		content,
		api: (model && model.api) || "openai-completions",
		provider: (model && model.provider) || "openrouter",
		model: (model && model.id) || "openrouter",
		usage,
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

// A partial AssistantMessage snapshot for the streaming events.
function partial(blocks) {
	return {
		role: "assistant",
		content: blocks.map((b) => ({ ...b })),
		api: "",
		provider: "",
		model: "",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 0,
	};
}

export function openrouterStreamFn(cfg, visionCapable) {
	return (model, context, options) => {
		const stream = createAssistantMessageEventStream();

		(async () => {
			try {
				const payload = {
					model: cfg.model,
					messages: buildMessages(context, visionCapable),
					max_tokens: options?.maxTokens ?? (model && model.maxTokens) ?? 8192,
					temperature: options?.temperature ?? 0.7,
					stream: false,
				};
				const toolSchema = toOpenAIToolSchema(context.tools);
				if (toolSchema) {
					payload.tools = toolSchema;
					payload.tool_choice = "auto";
				}

				const body = await postCompletion(cfg, payload, options?.signal);
				const choice = (body.choices && body.choices[0]) || {};
				const msg = choice.message || {};
				const finish = choice.finish_reason;
				const u = body.usage || {};
				const usage = mkUsage(u.prompt_tokens || 0, u.completion_tokens || 0);

				// Assemble pi content blocks + replay them as events.
				const blocks = [];
				stream.push({ type: "start", partial: partial(blocks) });

				const text = typeof msg.content === "string" ? msg.content : "";
				if (text) {
					const idx = blocks.length;
					blocks.push({ type: "text", text });
					stream.push({ type: "text_start", contentIndex: idx, partial: partial(blocks) });
					stream.push({ type: "text_delta", contentIndex: idx, delta: text, partial: partial(blocks) });
					stream.push({ type: "text_end", contentIndex: idx, content: text, partial: partial(blocks) });
				}

				let sawTool = false;
				const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
				for (const tc of toolCalls) {
					const fn = tc.function || {};
					// Strict parse, no recovery: truncated/malformed tool JSON must fail
					// the turn visibly (typically finish_reason "length" — the completion
					// ran out of max_tokens mid-call), not turn into a bogus call with
					// empty args that the loop retries forever.
					let args = {};
					try {
						args = fn.arguments ? JSON.parse(fn.arguments) : {};
					} catch {
						throw new Error(
							`tool call '${fn.name || "unknown"}' arguments are not valid JSON` +
							` (finish_reason=${finish || "unknown"}` +
							`${finish === "length" ? ", completion truncated by max_tokens" : ""})`,
						);
					}
					const idx = blocks.length;
					const toolCall = {
						type: "toolCall",
						id: tc.id || "call_" + fallbackToolId++,
						name: fn.name || "unknown",
						arguments: args,
					};
					blocks.push(toolCall);
					sawTool = true;
					stream.push({ type: "toolcall_start", contentIndex: idx, partial: partial(blocks) });
					stream.push({
						type: "toolcall_delta",
						contentIndex: idx,
						delta: fn.arguments || "{}",
						partial: partial(blocks),
					});
					stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: { ...toolCall }, partial: partial(blocks) });
				}

				const reason = sawTool ? "toolUse" : finish === "length" ? "length" : "stop";
				const finalMsg = makeAssistantMessage(model, blocks, reason, usage);
				stream.push({ type: "done", reason, message: finalMsg });
				stream.end(finalMsg);
			} catch (err) {
				const aborted = err && /abort/i.test(err.message || "");
				const message = makeAssistantMessage(
					model,
					[],
					aborted ? "aborted" : "error",
					emptyUsage(),
					(err && err.message) || String(err),
				);
				stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: message });
				stream.end(message);
			}
		})();

		return stream;
	};
}
