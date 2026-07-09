// entry.ts — the bundle's public surface. esbuild bundles this (+ pi + the three
// seam modules) into ../pi.bundle.js, which the app loads as /app/pi.bundle.js.
//
// It wires pi's stateful `Agent` to bro's three seams:
//   • provider.ts — brolmStreamFn: bro.lm.generate → pi's AssistantMessageEvent stream
//   • env.ts      — BrokitExecutionEnv: pi's FileSystem+Shell over brokit require('fs'|'child_process')
//   • tools.ts    — makeTools: read/write/edit/list/bash + eval_js AgentTools
//
// The app (main.js, plain JS) only ever calls createAgentSession() and reads events.

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { brolmStreamFn, type Brolm } from "./provider.ts";
import { BrokitExecutionEnv } from "./env.ts";
import { makeTools } from "./tools.ts";

export type { Brolm } from "./provider.ts";

// Test surface: the headless verification scripts import these directly to
// exercise the seams without a full agent loop. Harmless in production.
export { BrokitExecutionEnv } from "./env.ts";
export { makeTools } from "./tools.ts";
export { brolmStreamFn, createBrolmParser } from "./provider.ts";

const DEFAULT_SYSTEM_PROMPT = [
	"You are an autonomous agent running INSIDE the bro engine (an HTML/CSS/JS app runtime).",
	"You control the running app and the machine through your tools. Work in small steps:",
	"call a tool, read its result, then decide the next step. When the task is done, stop and",
	"summarize what you did. Prefer the file and bash tools for the filesystem, and use eval_js",
	"to inspect or drive the live engine (the DOM, the global `bro` API, the scene, settings).",
].join(" ");

export interface AgentSessionOptions {
	/** A model loaded via bro.lm.* plus how to decode its token ids. */
	brolm: Brolm;
	/** Working directory the file/shell tools resolve against. */
	cwd: string;
	/** Overrides the default agent persona/instructions. */
	systemPrompt?: string;
	/** Every AgentEvent from the loop — drive the transcript UI from this. */
	onEvent: (event: AgentEvent) => void;
	/** Tool-call gate. Return false to block the call. Omit to auto-approve. */
	approve?: (toolName: string, args: unknown) => Promise<boolean> | boolean;
}

export interface AgentSession {
	/** Start (or steer) a turn with a user message. Resolves when the loop goes idle. */
	prompt(text: string): Promise<void>;
	/** Interrupt the in-flight turn (aborts generation within one token). */
	abort(): void;
	/** Resolves once no turn is running. */
	waitForIdle(): Promise<void>;
}

// Minimal descriptor pi requires in state.model. Our streamFn closes over the real
// brolm handle and ignores this, so only maxTokens/contextWindow carry meaning.
function brolmModelDescriptor(brolm: Brolm): Model<string> {
	return {
		id: `brolm-${brolm.family}`,
		name: `brolm ${brolm.family}`,
		api: "brolm",
		provider: "brolm",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 2048,
	};
}

export function createAgentSession(opts: AgentSessionOptions): AgentSession {
	const env = new BrokitExecutionEnv(opts.cwd);
	const tools = makeTools(env, opts.cwd);

	const agent = new Agent({
		initialState: {
			systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
			model: brolmModelDescriptor(opts.brolm),
			tools,
		},
		streamFn: brolmStreamFn(opts.brolm),
		beforeToolCall: async (ctx) => {
			if (!opts.approve) return undefined;
			const allowed = await opts.approve(ctx.toolCall.name, ctx.args);
			return allowed ? undefined : { block: true, reason: "Denied by the user." };
		},
	});

	agent.subscribe((event) => {
		opts.onEvent(event);
	});

	return {
		prompt: (text: string) => agent.prompt(text),
		abort: () => agent.abort(),
		waitForIdle: () => agent.waitForIdle(),
	};
}
