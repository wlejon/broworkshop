# maker-agent bundler

Author-time only. Bundles the [earendil-works/pi](https://github.com/earendil-works/pi)
agent harness (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`) together
with the maker-agent seams in `src/` into a single self-contained ESM file,
`../maker.bundle.js`, which bro's QuickJS module loader serves as `/app/maker.bundle.js`.

`maker.bundle.js` is a **generated artifact and is not committed** — it's git-ignored.
A fresh clone must build it once before the app will run.

## Build

```bash
# 1. pi's source must sit at ../../../../pi relative to this dir — i.e. a sibling
#    of broworkshop:  D:/projects/pi  (build.mjs resolves ../pi/packages there).
#    (The sibling pi-agent app pins the same rev.)
git clone https://github.com/earendil-works/pi ../../../../pi
git -C ../../../../pi checkout 312bc713

# 2. restore the author-time deps and build
cd bundler
npm install
npm run build            # writes ../maker.bundle.js
```

The build stubs every cloud LLM SDK (Anthropic/OpenAI/Google/Mistral/AWS) — they're
only reachable through pi's lazy dynamic-import registrations and never run under our
own streamFns, so they're kept out of the bundle entirely. (`nodePaths` also falls
back to the sibling `pi-agent/bundler/node_modules`, so if that app's deps are already
installed you can skip `npm install` here.)

## Seams (`src/`) — plain JS, not TypeScript

esbuild strips types without type-checking (there is no `tsc` step), so the seams are
written as plain JS to match the rest of broworkshop; the emitted bundle is identical.

| File | Role |
|------|------|
| `entry.js`      | Public surface — `createAgentSession()`; selects the model backend and wires pi's `Agent` to the seams. |
| `openrouter.js` | **Primary backend.** OpenRouter `/chat/completions` → pi's `AssistantMessageEvent` stream, using NATIVE structured tool-calling (no text parsing). 429 backoff. Over brokit `fetch`. |
| `provider.js`   | Local backend. `bro.lm.generate` → pi events; parses Hermes/Qwen `<tool_call>` / `<think>` blocks (the offline path). |
| `env.js`        | `BrokitExecutionEnv` — pi's FileSystem + Shell over brokit `require('fs'\|…)`. |
| `tools.js`      | The tool set: `read_file`/`write_file`/`edit_file`/`list_dir`/`bash` + `eval_js`, plus the **`look`** tool (app-injected stage-capture callback). |

## Third-party licenses

The generated bundle embeds pi (MIT, © 2025 Mario Zechner) and the npm leaf deps
declared in `package.json`: typebox (MIT), yaml (ISC), ignore (MIT), partial-json
(MIT), @opentelemetry/api (Apache-2.0). Their license terms apply to the bundled output.
