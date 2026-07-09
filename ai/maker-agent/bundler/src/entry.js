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
	"Your job is to BUILD a small web app that fulfills the request, LOOK at how it renders, and REFINE",
	"it until it is good — all inside this running app. Author the app in your working directory with the",
	"file tools: write `index.html` (the entry point) plus any `style.css`, `script.js`, or assets it needs.",
	"It opens on a placeholder page you replace by writing `index.html`; you can `look` at any time.",
	"The preview runs standard web only: HTML, CSS, plain JavaScript, and the 2D <canvas> context",
	"(getContext('2d')); drive animation with requestAnimationFrame. It does NOT provide WebGL, the `bro.*`",
	"engine APIs, 3D/scene, physics, or audio — do not call them, they are undefined and the app renders blank.",
	"Use classic scripts (<script src=…>) only — no ES modules, no network. The project renders LIVE in an",
	"on-screen preview. After you write or edit files, call the `look` tool: it reloads the preview from your",
	"files and returns a description of what actually rendered. Use what you see to refine — write, look,",
	"refine, in small steps. When the preview matches the request, stop and briefly summarize what you built.",
	"`eval_js` is only an escape hatch for poking the host engine; anything it draws is NOT part of the preview",
	"the user sees, so prefer real files.",
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
