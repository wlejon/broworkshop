// build.mjs — bundle the earendil-works/pi agent harness + the maker-agent seams
// into a single self-contained ESM file bro's QuickJS loads as /app/maker.bundle.js.
// Author-time only; run `npm run build` (or `node build.mjs`).
//
// Same strategy as pi-agent/bundler: bundle pi from SOURCE and STUB the vendor LLM
// SDKs (reachable only through pi-ai's lazy dynamic-import registrations, never run
// under our streamFns). Everything Node-ish the harness needs at RUNTIME goes
// through globalThis.require('fs'|...) (brokit) / global fetch, never a bundled import.
//
// nodePaths resolves the leaf deps (typebox/yaml/ignore/partial-json/@opentelemetry)
// from this bundler's node_modules, falling back to the sibling pi-agent bundler's
// so a fresh checkout that only installed one of the two still builds.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PI = resolve(here, "../../../../pi/packages"); // D:/projects/pi/packages
const AI = resolve(PI, "ai/src");
const AGENT = resolve(PI, "agent/src");

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
	entryPoints: [resolve(here, "src/entry.js")],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2022",
	outfile: resolve(here, "../maker.bundle.js"),
	nodePaths: [resolve(here, "node_modules"), resolve(here, "../../pi-agent/bundler/node_modules")],
	external: ["node:*"],
	plugins: [piPlugin, stubPlugin],
	legalComments: "none",
	logLevel: "info",
});

console.log("wrote ../maker.bundle.js");
