// demo.js — scripted transcripts for developing the Pi Agent UI without a model.
//
// The real agent brain needs a ~20 GB local LLM loaded to produce any UI state,
// which makes iterating on the transcript rendering painfully slow. This module
// synthesizes the exact same pi AgentEvent stream the live session emits, so the
// whole UI (markdown, thinking folds, tool cards, diffs, approval palette, the
// context meter, error states) can be exercised from a menu click or a headless
// script.
//
// It talks to main.js only through a small handler bundle so it stays decoupled
// from the live wiring:
//   api.onEvent(event)      — feed a pi AgentEvent to the real renderer
//   api.approve(name, args) — render the real approval palette (returns a Promise)
//   api.addUserRow(text)    — append a "You" row
//   api.setUsage(usage)     — drive the context meter
//   api.reset()             — clear the transcript
//
// Two entry points:
//   runDemoSession(api, {live}) — a full streaming session (live pacing for the
//                                 windowed app; instant when live === false)
//   fillTranscript(api, {turns}) — synchronously stack a big conversation, for
//                                  scroll/click tests that need lots of content
//                                  and nested scrollers (thinking folds, long
//                                  tool results) present up front.

// ── fake payloads ────────────────────────────────────────────────────────────

const REPLY_MD = [
    "## Plan",
    "",
    "I'll explore the project, then add a JSDoc comment to `add()`. Here's the",
    "shape of the change, in **three** steps:",
    "",
    "1. list the directory",
    "2. read `lib/math.js`",
    "3. edit the function and show a diff",
    "",
    "```js",
    "/** Sum two numbers. */",
    "function add(a, b) { return a + b; } // pure, no side effects",
    "```",
    "",
    "> Note: `add` is used by the tokenizer, so keep the signature stable.",
    "",
    "See the [docs](https://example.com/add) for the rationale.",
].join("\n");

const THINK_TEXT = [
    "The user wants a doc comment on add(). Let me first understand the project",
    "layout before touching anything. I'll list the root directory, then read the",
    "file that defines add() so I edit the exact text. A JSDoc /** */ block right",
    "above the function is the least invasive change and won't alter behavior.",
].join(" ");

const LONG_RESULT = Array.from({ length: 22 }, (_, i) =>
    `line ${i + 1}: export const sample${i} = ${i * 7 % 13};`).join("\n");

const OLD_TEXT = "function add(a, b) {\n  return a + b;\n}";
const NEW_TEXT = "/** Sum two numbers. */\nfunction add(a, b) {\n  return a + b;\n}";

// A pi assistant message is { role, content:[blocks] }. Blocks we use:
//   { type:'thinking', thinking }  { type:'text', text }
function msg(blocks) { return { role: "assistant", content: blocks }; }

// ── streaming helpers ─────────────────────────────────────────────────────────

// Split a string into a handful of streaming chunks (word-ish granularity).
function chunk(text, n) {
    const size = Math.max(1, Math.ceil(text.length / n));
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
}

function sleeper(live) {
    return (ms) => (live ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
}

// ── full streaming session ────────────────────────────────────────────────────

export async function runDemoSession(api, opts) {
    opts = opts || {};
    const live = opts.live !== false;
    const wait = sleeper(live);

    api.reset();
    if (api.setStatus) api.setStatus("demo session (simulated)", "running");
    api.addUserRow("Explore this project and add a doc comment to the add() function.");
    api.onEvent({ type: "agent_start" });

    let ctxInput = 1840; // pretend the system prompt + tools already cost this
    const bump = (n) => api.setUsage({ input: (ctxInput += n), output: 0 });
    bump(0);

    // 1) assistant message: thinking fold streams, then the markdown reply.
    api.onEvent({ type: "message_start", message: msg([]) });
    let think = "";
    for (const c of chunk(THINK_TEXT, live ? 24 : 1)) {
        think += c;
        api.onEvent({ type: "message_update", message: msg([{ type: "thinking", thinking: think }]) });
        await wait(35);
    }
    let reply = "";
    for (const c of chunk(REPLY_MD, live ? 40 : 1)) {
        reply += c;
        api.onEvent({
            type: "message_update",
            message: msg([{ type: "thinking", thinking: think }, { type: "text", text: reply }]),
        });
        await wait(30);
    }
    api.onEvent({
        type: "message_end",
        message: msg([{ type: "thinking", thinking: think }, { type: "text", text: reply }]),
    });
    bump(320);
    await wait(250);

    // 2) list_dir — short result.
    api.onEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "list_dir", args: { path: "." } });
    await wait(400);
    api.onEvent({
        type: "tool_execution_end", toolCallId: "t1",
        result: { content: [{ type: "text", text: "lib/\nai/\ndocs/\nREADME.md\nbro.json" }] },
    });
    bump(90);
    await wait(200);

    // 3) read_file — long result auto-collapses.
    api.onEvent({ type: "tool_execution_start", toolCallId: "t2", toolName: "read_file", args: { path: "lib/math.js" } });
    await wait(500);
    api.onEvent({
        type: "tool_execution_end", toolCallId: "t2",
        result: { content: [{ type: "text", text: LONG_RESULT }] },
    });
    bump(640);
    await wait(250);

    // 4) edit_file — renders a red/green diff.
    api.onEvent({
        type: "tool_execution_start", toolCallId: "t3", toolName: "edit_file",
        args: { path: "lib/math.js", old_text: OLD_TEXT, new_text: NEW_TEXT },
    });
    await wait(500);
    api.onEvent({
        type: "tool_execution_end", toolCallId: "t3",
        result: { content: [{ type: "text", text: "edited lib/math.js (+1 line)" }] },
    });
    bump(120);
    await wait(250);

    // 5) the approval palette — non-blocking. Force it to render even when
    //    auto-approve is on, since showing that state is the whole point.
    const chk = document.querySelector("#auto-approve");
    const prevAuto = chk ? chk.checked : false;
    if (chk) chk.checked = false;
    api.approve("bash", { command: "npm test" });
    if (chk) chk.checked = prevAuto;
    await wait(300);

    // 6) an errored tool call — mirrors a model hallucinating a bad tool name
    //    once context pressure sets in.
    api.onEvent({ type: "tool_execution_start", toolCallId: "t4", toolName: "read__file", args: { path: "lib/math.js" } });
    await wait(300);
    api.onEvent({
        type: "tool_execution_end", toolCallId: "t4", isError: true,
        result: { content: [{ type: "text", text: "Tool read__file not found" }] },
    });
    bump(60);

    // 7) closing summary.
    api.onEvent({ type: "message_start", message: msg([]) });
    const done = "Done — added a JSDoc comment to `add()`. The diff above shows the one-line change.";
    api.onEvent({ type: "message_update", message: msg([{ type: "text", text: done }]) });
    api.onEvent({ type: "message_end", message: msg([{ type: "text", text: done }]) });
    api.onEvent({ type: "agent_end" });
    bump(40);
    if (api.setStatus) api.setStatus("demo complete", "ready");
}

// ── synchronous bulk fill (for scroll/click tests) ────────────────────────────
//
// Stacks `turns` complete request→reply→tool cycles instantly so the transcript
// overflows and contains the nested scrollers (an expanded thinking fold, long
// tool results) that stress wheel handling. No awaits — the DOM is fully built
// when this returns.

export function fillTranscript(api, opts) {
    opts = opts || {};
    const turns = opts.turns || 6;
    api.reset();

    for (let i = 0; i < turns; i++) {
        api.addUserRow(`Request #${i + 1}: walk me through part ${i + 1} of the codebase.`);
        api.onEvent({ type: "agent_start" });

        // An assistant message with a thinking fold. The fold + bubble are
        // created on message_update (message_end alone never opens them), so
        // emit an update carrying the full content, then close it.
        const blocks = [
            { type: "thinking", thinking: THINK_TEXT + " (turn " + (i + 1) + ")" },
            { type: "text", text: REPLY_MD },
        ];
        api.onEvent({ type: "message_start", message: msg([]) });
        api.onEvent({ type: "message_update", message: msg(blocks) });
        api.onEvent({ type: "message_end", message: msg(blocks) });

        // A long tool result — auto-collapses, but expandable into a scroller.
        const id = "f" + i;
        api.onEvent({ type: "tool_execution_start", toolCallId: id, toolName: "read_file", args: { path: `part${i + 1}.js` } });
        api.onEvent({ type: "tool_execution_end", toolCallId: id, result: { content: [{ type: "text", text: LONG_RESULT }] } });

        api.onEvent({ type: "agent_end" });
    }

    // Leave one thinking fold expanded so a fits-content nested scroller is
    // present at the top (the case that used to swallow the wheel).
    try {
        const firstFold = document.querySelector(".thinking");
        if (firstFold) firstFold.classList.remove("collapsed");
    } catch (e) { /* headless DOM quirk — ignore */ }
}
