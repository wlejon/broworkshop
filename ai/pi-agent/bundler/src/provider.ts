// provider.ts — adapt bro's local LLM (bro.lm.generate) into a pi-agent StreamFn.
//
// bro.lm.generate streams plain decoded TEXT (re-decode the whole id array per
// token because byte-level BPE pieces can be partial UTF-8). This module turns
// that text stream into pi's structured AssistantMessageEvent protocol, parsing
// Hermes/Qwen `<tool_call>{...}</tool_call>` blocks out of the token text.
//
// Two pieces:
//   createBrolmParser(emit) — a PURE, model-free state machine (unit-testable
//                             under plain node) that segments growing decoded
//                             text into text / tool_call blocks and emits the
//                             start / *_start / *_delta / *_end events.
//   brolmStreamFn(brolm)    — builds the ChatML prompt from a pi Context, drives
//                             bro.lm.generate, feeds the parser, and terminates
//                             the stream with the final done / error event.

import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	Tool,
	ToolCall,
	ToolResultMessage,
	Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

// `bro` is the ambient engine global; esbuild leaves it as a free reference.
declare const bro: any;

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface Brolm {
	model: any; // a bro.lm loaded model handle
	tokenizer?: any; // present for qwen3/mistral3; undefined for qwen35
	family: "qwen3" | "mistral3" | "qwen35";
	// full-array decode (partial-UTF-8 safe) — re-decode the whole id array.
	decode(ids: number[] | Int32Array): string;
	eosId?: number; // e.g. tokenizer.imEndId; undefined => driver stops itself
}

const OPEN_TAG = "<tool_call>";
const CLOSE_TAG = "</tool_call>";

// A shared, monotonic tool-call id counter. Deliberately NOT crypto/Date/random
// so the pure parser stays deterministic for tests.
let toolCallIdCounter = 0;

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

// ---------------------------------------------------------------------------
// createBrolmParser — the pure tool-call state machine (also used by tests)
// ---------------------------------------------------------------------------
//
// `push(fullDecodedText)` is called with the growing FULL decoded text each
// token. The parser only processes the new suffix (tracked via `pos`) and
// buffers `<tool_call>` regions so malformed JSON can fall back to text without
// leaving a dangling toolcall_start (the protocol has no "cancel" event).
//
// `emit` is the ONLY output path so tests can capture the exact event sequence.
// `brolmStreamFn` passes `ev => stream.push(ev)`; the final done/error is emitted
// by brolmStreamFn, NOT the parser. The parser DOES emit the closing text_end
// for a trailing text block when `finish()` is called at stream end.

type ParserBlock = TextContent | ToolCall;

export function createBrolmParser(emit: (event: AssistantMessageEvent) => void) {
	const blocks: ParserBlock[] = [];

	let started = false;
	let lastFull = "";
	let pos = 0; // how far into lastFull we have consumed
	let mode: "text" | "tool" = "text";
	let toolStart = 0; // offset just past the OPEN tag when mode === "tool"
	let sawTool = false;

	// Current open text block (lazily opened on the first non-empty delta).
	let textOpen = false;
	let textIdx = -1;
	let textBlock: TextContent | null = null;

	function makePartial(): AssistantMessage {
		return {
			role: "assistant",
			content: blocks.map((b) => ({ ...b })) as AssistantMessage["content"],
			api: "",
			provider: "",
			model: "",
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: 0,
		};
	}

	function emitTextDelta(str: string) {
		if (!str) return;
		if (!textOpen) {
			textIdx = blocks.length;
			textBlock = { type: "text", text: "" };
			blocks.push(textBlock);
			textOpen = true;
			emit({ type: "text_start", contentIndex: textIdx, partial: makePartial() });
		}
		textBlock!.text += str;
		emit({ type: "text_delta", contentIndex: textIdx, delta: str, partial: makePartial() });
	}

	function closeText() {
		if (!textOpen) return;
		const content = textBlock!.text;
		const idx = textIdx;
		textOpen = false;
		textBlock = null;
		emit({ type: "text_end", contentIndex: idx, content, partial: makePartial() });
	}

	// Number of chars at the end of `text` (from `from`) that form a proper
	// prefix of `tag` — held back so a partially-arrived open tag is not emitted
	// as text prematurely.
	function partialTagHoldback(text: string, tag: string, from: number): number {
		const max = Math.min(tag.length - 1, text.length - from);
		for (let k = max; k > 0; k--) {
			if (text.endsWith(tag.slice(0, k))) return k;
		}
		return 0;
	}

	function handleToolClose(inner: string) {
		let parsed: any = null;
		try {
			parsed = JSON.parse(inner.trim());
		} catch {
			parsed = null;
		}
		if (parsed && typeof parsed === "object" && typeof parsed.name === "string") {
			const idx = blocks.length;
			const args = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {};
			const toolCall: ToolCall = {
				type: "toolCall",
				id: "call_" + toolCallIdCounter++,
				name: parsed.name,
				arguments: args,
			};
			blocks.push(toolCall);
			sawTool = true;
			emit({ type: "toolcall_start", contentIndex: idx, partial: makePartial() });
			emit({ type: "toolcall_delta", contentIndex: idx, delta: inner, partial: makePartial() });
			emit({ type: "toolcall_end", contentIndex: idx, toolCall: { ...toolCall }, partial: makePartial() });
		} else {
			// Malformed JSON — fall back to treating the whole region as text.
			emitTextDelta(OPEN_TAG + inner + CLOSE_TAG);
		}
	}

	function process() {
		const text = lastFull;
		// Loop until no further progress can be made with the text seen so far.
		// eslint-disable-next-line no-constant-condition
		while (true) {
			if (mode === "tool") {
				const j = text.indexOf(CLOSE_TAG, toolStart);
				if (j === -1) return; // buffer until the close tag arrives
				const inner = text.slice(toolStart, j);
				mode = "text";
				pos = j + CLOSE_TAG.length;
				handleToolClose(inner);
				continue;
			}

			// mode === "text"
			const i = text.indexOf(OPEN_TAG, pos);
			if (i === -1) {
				// No (complete) open tag — emit up to a possible partial tag suffix.
				const k = partialTagHoldback(text, OPEN_TAG, pos);
				const safeEnd = Math.max(pos, text.length - k);
				if (safeEnd > pos) {
					emitTextDelta(text.slice(pos, safeEnd));
					pos = safeEnd;
				}
				return;
			}
			// Flush the normal text before the tag, then open a buffered tool block.
			if (i > pos) emitTextDelta(text.slice(pos, i));
			closeText();
			mode = "tool";
			toolStart = i + OPEN_TAG.length;
			pos = toolStart;
		}
	}

	return {
		push(fullDecodedText: string) {
			lastFull = fullDecodedText;
			if (!started) {
				started = true;
				emit({ type: "start", partial: makePartial() });
			}
			process();
		},
		// Close any dangling block at end of stream. An unterminated tool_call is
		// flushed as text so blocks() never contains a half-open tool call.
		finish() {
			if (mode === "tool") {
				emitTextDelta(OPEN_TAG + lastFull.slice(toolStart));
				mode = "text";
			}
			closeText();
		},
		blocks(): ParserBlock[] {
			return blocks;
		},
		sawToolCall(): boolean {
			return sawTool;
		},
	};
}

// ---------------------------------------------------------------------------
// Prompt construction — manual ChatML (bro's applyChatTemplate drops tools)
// ---------------------------------------------------------------------------

function chatmlTurn(role: string, content: string): string {
	return `<|im_start|>${role}\n${content}<|im_end|>\n`;
}

function userContentToText(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	return content
		.map((b) => (b.type === "text" ? b.text : `[image:${b.mimeType}]`))
		.join("");
}

function assistantContentToText(content: AssistantMessage["content"]): string {
	return content
		.map((b) => {
			if (b.type === "text") return b.text;
			if (b.type === "toolCall") {
				return OPEN_TAG + JSON.stringify({ name: b.name, arguments: b.arguments }) + CLOSE_TAG;
			}
			// thinking blocks are not replayed to the model
			return "";
		})
		.filter((s) => s.length > 0)
		.join("\n");
}

function toolResultToText(message: ToolResultMessage): string {
	return message.content.map((b) => (b.type === "text" ? b.text : `[image:${b.mimeType}]`)).join("\n");
}

function buildSystemContent(context: Context): string {
	let s = context.systemPrompt ? context.systemPrompt : "";
	const tools = context.tools;
	if (tools && tools.length) {
		const schema = tools.map((t: Tool) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.parameters },
		}));
		const block =
			"\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n" +
			"You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n" +
			schema.map((x) => JSON.stringify(x)).join("\n") +
			"\n</tools>\n\n" +
			"To call a function, respond with a JSON object wrapped in <tool_call></tool_call> tags:\n" +
			'<tool_call>{"name": <function-name>, "arguments": <arguments-json-object>}</tool_call>';
		s = s + block;
	}
	return s;
}

function buildChatML(context: Context): string {
	const parts: string[] = [];
	const sys = buildSystemContent(context);
	if (sys) parts.push(chatmlTurn("system", sys));
	for (const message of context.messages as Message[]) {
		if (message.role === "user") {
			parts.push(chatmlTurn("user", userContentToText(message.content)));
		} else if (message.role === "assistant") {
			parts.push(chatmlTurn("assistant", assistantContentToText(message.content)));
		} else if (message.role === "toolResult") {
			parts.push(chatmlTurn("tool", toolResultToText(message)));
		}
	}
	parts.push("<|im_start|>assistant\n");
	return parts.join("");
}

// Returns the prompt in the form bro.lm.generate wants for the family:
// token ids for qwen3/mistral3, a raw ChatML string for qwen35.
function buildPrompt(brolm: Brolm, context: Context): number[] | Int32Array | string {
	const chatml = buildChatML(context);
	if (brolm.family === "qwen35" || !brolm.tokenizer) {
		return chatml; // driver owns the tokenizer and stops itself
	}
	if (brolm.family === "mistral3") {
		// The manual ChatML already carries structure; do not add special tokens.
		return brolm.tokenizer.encode(chatml, /*addSpecial=*/ false);
	}
	return brolm.tokenizer.encode(chatml);
}

// ---------------------------------------------------------------------------
// brolmStreamFn — the StreamFn factory
// ---------------------------------------------------------------------------

function makeAssistantMessage(
	model: Model<any>,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: (model && (model as any).api) || "brolm",
		provider: (model && (model as any).provider) || "brolm",
		model: (model && model.id) || "brolm",
		usage: emptyUsage(),
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

export function brolmStreamFn(brolm: Brolm): StreamFn {
	return (model, _context, options) => {
		const context = _context;
		const stream = createAssistantMessageEventStream();
		const parser = createBrolmParser((ev) => stream.push(ev));

		// Never throw/reject: every failure is encoded as a final error event.
		(async () => {
			try {
				const prompt = buildPrompt(brolm, context);
				const acc: number[] = [];
				let settled = false;

				const decodeFull = (ids: number[] | Int32Array): string => {
					try {
						return brolm.decode(ids);
					} catch {
						return "";
					}
				};

				const finishStream = (event: AssistantMessageEvent, message: AssistantMessage) => {
					if (settled) return;
					settled = true;
					stream.push(event);
					stream.end(message);
				};

				const opts: any = {
					maxNewTokens: options?.maxTokens ?? 1024,
					sampling: { temperature: options?.temperature ?? 0.7 },
					onToken: (id: number) => {
						acc.push(id);
						parser.push(decodeFull(acc));
					},
					onDone: (ids: number[] | Int32Array, info: any) => {
						// Guarantee the parser has seen the final text (and thus emitted
						// at least the `start` event) even for empty / zero-token output.
						const finalIds = ids && (ids as any).length ? ids : acc;
						parser.push(decodeFull(finalIds));
						parser.finish();
						const content = parser.blocks() as AssistantMessage["content"];

						if (info && info.cancelled) {
							const msg = makeAssistantMessage(model, content, "aborted", "Request was aborted");
							finishStream({ type: "error", reason: "aborted", error: msg }, msg);
							return;
						}
						if (info && info.error) {
							const msg = makeAssistantMessage(model, content, "error", String(info.error));
							finishStream({ type: "error", reason: "error", error: msg }, msg);
							return;
						}
						const reason = parser.sawToolCall() ? "toolUse" : "stop";
						const msg = makeAssistantMessage(model, content, reason);
						finishStream({ type: "done", reason, message: msg }, msg);
					},
				};
				if (brolm.eosId !== undefined) opts.eosId = brolm.eosId;

				const handle = bro.lm.generate(brolm.model, prompt, opts);

				// Wire cancellation to the generate handle.
				const signal = options?.signal;
				if (signal) {
					const cancel = () => {
						try {
							handle && handle.cancel && handle.cancel();
						} catch {
							/* ignore */
						}
					};
					if (signal.aborted) cancel();
					else signal.addEventListener("abort", cancel, { once: true });
				}
			} catch (err: any) {
				const message = makeAssistantMessage(
					model,
					parser.blocks() as AssistantMessage["content"],
					"error",
					(err && err.message) || String(err),
				);
				stream.push({ type: "error", reason: "error", error: message });
				stream.end(message);
			}
		})();

		return stream;
	};
}
