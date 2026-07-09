# pi-agent bundler

Author-time only. Bundles the [earendil-works/pi](https://github.com/earendil-works/pi)
agent harness (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`) together
with the three bro seams in `src/` into a single self-contained ESM file,
`../pi.bundle.js`, which bro's QuickJS module loader serves as `/app/pi.bundle.js`.

`pi.bundle.js` is a **generated artifact and is not committed** — it's git-ignored.
A fresh clone must build it once before the app will run.

## Build

```bash
# 1. pi's source must sit at ../../../../pi relative to this dir — i.e. a sibling
#    of broworkshop:  D:/projects/pi  (build.mjs resolves ../pi/packages there).
git clone https://github.com/earendil-works/pi ../../../../pi
git -C ../../../../pi checkout 312bc713   # pinned; the bundle is built from this rev

# 2. restore the author-time deps and build
cd bundler
npm install
npm run build            # writes ../pi.bundle.js
```

The build stubs every cloud LLM SDK (Anthropic/OpenAI/Google/Mistral/AWS) — they're
only reachable through pi's lazy dynamic-import registrations and never run under
our own brolm `streamFn`, so they're kept out of the bundle entirely.

## Seams (`src/`)

| File | Role |
|------|------|
| `entry.ts` | Public surface — `createAgentSession()`; wires pi's `Agent` to the seams. |
| `provider.ts` | `bro.lm.generate` → pi's `AssistantMessageEvent` stream; parses `<tool_call>` blocks. |
| `env.ts` | `BrokitExecutionEnv` — pi's FileSystem + Shell over brokit `require('fs'\|…)`. |
| `tools.ts` | The tool set: `read_file`/`write_file`/`edit_file`/`list_dir`/`bash` + `eval_js`. |

## Third-party licenses

The generated bundle embeds pi (MIT, © 2025 Mario Zechner) and the npm leaf deps
declared in `package.json`: typebox (MIT), yaml (ISC), ignore (MIT), partial-json
(MIT), @opentelemetry/api (Apache-2.0). Their license terms apply to the bundled
output.
