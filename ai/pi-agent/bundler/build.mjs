// build.mjs — bundle the earendil-works/pi agent harness + our bro seams into a
// single self-contained ESM file that bro's QuickJS module loader can load as
// /app/pi.bundle.js. Author-time only; run `npm run build` (or `node build.mjs`).
//
// Strategy (see plan): bundle pi from SOURCE so we never run pi's tsgo build, and
// STUB the vendor LLM SDKs — they are reachable only through pi-ai's lazy
// dynamic-import registrations and never execute under our own streamFn, so a
// callable Proxy stub keeps them out of the bundle entirely. Everything Node-ish
// the harness needs at RUNTIME goes through globalThis.require('fs'|...) (brokit),
// never a bundled import.
//
// Two resolver wrinkles handled below:
//   • pi package specifiers (@earendil-works/pi-ai[/subpath]) are mapped to the
//     package's TS source with a plugin (esbuild `alias` can't handle subpaths).
//   • pi's source lives outside this dir and pi has no node_modules, so leaf deps
//     (typebox/yaml/ignore/partial-json/@opentelemetry/api) are resolved via
//     `nodePaths` pointing at THIS bundler's node_modules.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PI = resolve(here, "../../../../pi/packages"); // D:/projects/pi/packages
const AI = resolve(PI, "ai/src");
const AGENT = resolve(PI, "agent/src");

// Map a pi package specifier to its TS source file. Subpaths (e.g. ".../compat",
// ".../providers/faux") append ".ts"; the bare root maps to index.ts.
function mapPi(spec) {
	const roots = [
		["@earendil-works/pi-ai", AI],
		["@earendil-works/pi-agent-core", AGENT],
	];
	for (const [name, root] of roots) {
		if (spec === name) return resolve(root, "index.ts");
		if (spec.startsWith(name + "/")) return resolve(root, spec.slice(name.length + 1) + ".ts");
	}
	return null;
}

const piPlugin = {
	name: "pi-src",
	setup(b) {
		b.onResolve({ filter: /^@earendil-works\/pi-/ }, (args) => {
			const path = mapPi(args.path);
			return path ? { path } : undefined;
		});
	},
};

// Heavy vendor SDKs + proxy agents: never run with our provider → stub them with
// a callable/newable Proxy whose every property is itself (satisfies both
// `import X from "sdk"` and `import { Named } from "sdk"` with no real exports).
const STUB = [
	/^@anthropic-ai\/sdk/,
	/^openai(\/|$)/,
	/^@google\/genai/,
	/^@mistralai\//,
	/^@aws-sdk\//,
	/^@smithy\//,
	/-proxy-agent$/,
];
const stubPlugin = {
	name: "stub-vendor-sdks",
	setup(b) {
		b.onResolve({ filter: /.*/ }, (args) => {
			if (STUB.some((re) => re.test(args.path))) return { path: args.path, namespace: "stub" };
			return undefined;
		});
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents:
				"const s = new Proxy(function(){}, { get: () => s, apply: () => undefined, construct: () => ({}) });\n" +
				"module.exports = s;\n",
			loader: "js",
		}));
	},
};

await build({
	entryPoints: [resolve(here, "src/entry.ts")],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2022",
	outfile: resolve(here, "../pi.bundle.js"),
	nodePaths: [resolve(here, "node_modules")],
	// Node builtins are only ever reached via guarded/variable dynamic import()
	// that never runs in QuickJS. Mark external so the build resolves; nothing
	// eager references them, so no top-level `import "node:*"` is emitted.
	external: ["node:*"],
	plugins: [piPlugin, stubPlugin],
	legalComments: "none",
	logLevel: "info",
});

console.log("wrote ../pi.bundle.js");
