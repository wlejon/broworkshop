// entry.js — the maker-agent bundle's public surface. esbuild bundles this (+ pi +
// the seam modules) into ../maker.bundle.js, loaded by the app as /app/maker.bundle.js.
//
// It wires pi's stateful `Agent` to a SWAPPABLE model backend:
//   • openrouter.js — openrouterStreamFn: OpenRouter /chat/completions (native
//                     tool-calling) over brokit fetch. The default/primary backend.
//   • provider.js   — brolmStreamFn: local bro.lm.generate (the offline backend).
// plus the shared seams:
//   • env.js   — BrokitExecutionEnv: pi FileSystem+Shell over brokit require('fs'|…)
//   • tools.js — the maker tool set (files + bash + eval_js) + the `look` tool
//
// The app (main.js) only calls createAgentSession() and reads AgentEvents.

import { Agent } from "@earendil-works/pi-agent-core";
import { brolmStreamFn } from "./provider.js";
import { openrouterStreamFn } from "./openrouter.js";
import { BrokitExecutionEnv } from "./env.js";
import { makeTools } from "./tools.js";

// Test surface: headless verification scripts import these directly.
export { BrokitExecutionEnv } from "./env.js";
export { makeTools } from "./tools.js";
export { brolmStreamFn, createBrolmParser } from "./provider.js";
export { openrouterStreamFn } from "./openrouter.js";

const DEFAULT_SYSTEM_PROMPT = [
	"You are an autonomous MAKER agent running INSIDE the bro engine (an HTML/CSS/JS app runtime).",
	"Your job is to CREATE visual things, LOOK at what you made, and CHANGE them until they are good —",
	"all inside this running app. Your main lever is the eval_js tool: it runs JavaScript in the live",
	"engine, so you render your work into the on-screen stage element (id 'stage', also the global",
	"`stage`) — append a <canvas> and draw, build a bro.scene, animate, whatever the task needs.",
	"After each visible change, call the `look` tool to SEE the stage, then let what you observe guide",
	"your next change. Work in small steps: make a change, look, refine. When the result matches the",
	"request, stop and briefly summarize what you built. You also have file and bash tools if a task",
	"needs them, but prefer eval_js + look for anything visual.",
].join(" ");

// ── backend selection ─────────────────────────────────────────────────────────
//
// backend is one of:
//   { kind: "brolm", brolm }                                — local bro.lm model
//   { kind: "openrouter", openrouter: cfg, visionCapable? } — remote OpenRouter
//
// AgentSessionOptions: { backend, cwd, systemPrompt?, onEvent, approve?, look? }
//   onEvent(event) — every AgentEvent from the loop (drives the transcript UI).
//   approve(name, args) — tool-call gate; return false to block. Omit to auto-approve.
//   look(instruction) — capture the stage + return a view of it for the `look` tool.

function brolmModelDescriptor(brolm) {
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

function openrouterModelDescriptor(cfg, visionCapable) {
	return {
		id: cfg.model,
		name: cfg.model,
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: cfg.baseUrl || "https://openrouter.ai/api/v1",
		reasoning: false,
		input: visionCapable ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 2048,
	};
}

export function createAgentSession(opts) {
	const env = new BrokitExecutionEnv(opts.cwd);
	const tools = makeTools(env, opts.cwd, { look: opts.look });

	const backend = opts.backend;
	const isOR = backend.kind === "openrouter";
	const streamFn = isOR
		? openrouterStreamFn(backend.openrouter, backend.visionCapable ?? false)
		: brolmStreamFn(backend.brolm);
	const model = isOR
		? openrouterModelDescriptor(backend.openrouter, backend.visionCapable ?? false)
		: brolmModelDescriptor(backend.brolm);

	const agent = new Agent({
		initialState: {
			systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
			model,
			tools,
		},
		streamFn,
		beforeToolCall: async (ctx) => {
			if (!opts.approve) return undefined;
			const allowed = await opts.approve(ctx.toolCall.name, ctx.args);
			return allowed ? undefined : { block: true, reason: "Denied by the user." };
		},
	});

	agent.subscribe((event) => opts.onEvent(event));

	return {
		prompt: (text) => agent.prompt(text),
		abort: () => agent.abort(),
		waitForIdle: () => agent.waitForIdle(),
	};
}
