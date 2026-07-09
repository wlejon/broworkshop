// Maker Agent — a chat UI over an autonomous, tool-using agent that CREATES visual
// things on a live stage, LOOKS at them (via a vision model), and CHANGES them until
// they match the request — all inside this running bro app.
//
// The agent brain is the pre-built `maker.bundle.js` harness (createAgentSession),
// which wraps the earendil-works/pi Agent loop. This file: (1) picks a backend —
// OpenRouter (default) or a local brolm model — and hands it to the session,
// (2) renders the pi AgentEvent stream into the transcript, (3) exposes the stage
// canvas as engine globals the agent draws into, and (4) implements the `look` tool
// by capturing the stage and asking a vision model what it sees.

import { installSystemMenu } from "/lib/system-menu.js";
import { createAgentSession } from "/app/maker.bundle.js";
import { renderMarkdown } from "/lib/markdown.js";
import { lineDiff } from "/lib/linediff.js";

const $ = (s) => document.querySelector(s);
const OR_BASE = "https://openrouter.ai/api/v1";

// Persisted (to the OS user-data dir via localStorage — NEVER the repo).
const store = {
    get(k, d) { try { const v = localStorage.getItem("maker." + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("maker." + k, v); } catch (e) {} },
};

let session = null;     // agent session (created lazily on first send)
let running = false;    // a turn is in flight
let brolmHandle = null; // { model, tokenizer } once a local model is loaded
const sessionAllow = new Set(); // tools the user chose to always allow

// ── stage: a 2D canvas the agent draws into, exposed as engine globals ────────
const stageCanvas = $("#stage-canvas");
const stageCtx = stageCanvas.getContext("2d");

// Managed animation: a single rAF loop that draws onto stageCanvas — the surface
// `look` captures — so the agent never needs (and must not create) its own canvas.
// Bumping stageAnimId cancels the running loop; a new stageAnimate() supersedes it.
let stageAnimId = 0;
function stageStop() { stageAnimId++; }

function clearStage() {
    stageStop();
    stageCtx.fillStyle = "#ffffff";
    stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
}
clearStage();

// Run drawFrame(t) every frame onto stageCtx (t = seconds since it started). One
// loop at a time — calling again cancels the previous; stageStop() ends it. The
// first frame draws synchronously so a `look` right after sees output immediately.
function stageAnimate(drawFrame) {
    if (typeof drawFrame !== "function") throw new TypeError("stageAnimate(fn): fn must be a function");
    stageStop();
    const myId = stageAnimId;
    const clock = (typeof performance !== "undefined" && performance.now) ? () => performance.now() : () => Date.now();
    const t0 = clock();
    const frame = () => {
        if (myId !== stageAnimId) return;              // superseded or stopped
        try { drawFrame((clock() - t0) / 1000); }
        catch (e) { console.error("stageAnimate", e); stageStop(); return; }
        raf(frame);
    };
    try { drawFrame(0); }
    catch (e) { console.error("stageAnimate", e); stageStop(); return stageStop; }
    raf(frame);
    return stageStop;
}

// eval_js runs code via `new Function`, i.e. in global scope — so the drawing
// surface and the animation hook must be reachable as globals.
globalThis.stage = $("#stage");
globalThis.stageCanvas = stageCanvas;
globalThis.stageCtx = stageCtx;
globalThis.stageAnimate = stageAnimate;
globalThis.stageStop = stageStop;

const MAKER_SYSTEM_PROMPT = [
    "You are an autonomous MAKER agent running INSIDE the bro engine (an HTML/CSS/JS app runtime).",
    "Your job: CREATE a visual result on the stage, LOOK at it, and CHANGE it until it matches the request.",
    "The stage is a FIXED 640x480 2D canvas already on screen. Draw into it using the engine globals your",
    "eval_js tool can see: `stageCtx` (a CanvasRenderingContext2D) and `stageCanvas`.",
    "CRITICAL: NEVER create or append your own <canvas> or DOM element — the `look` tool can ONLY see",
    "`stageCanvas`, so anything you draw anywhere else is invisible to you and to the user.",
    "For a STILL image, draw straight to stageCtx (fillStyle, fillRect, arc, paths, gradients, text).",
    "For ANIMATION, do NOT call requestAnimationFrame yourself — instead call `stageAnimate(fn)`, where",
    "fn(t) draws exactly ONE frame onto stageCtx (t = seconds since the animation began). It runs every",
    "frame and automatically cancels any previous animation; call `stageStop()` to end it. This keeps the",
    "animation on the canvas that `look` sees.",
    "After each visible change, call the `look` tool to SEE the current stage — a vision model describes it",
    "back to you — then use what you observe to refine. Work in small steps: draw, look, adjust.",
    "When the stage matches the request, stop and briefly say what you made. Keep each eval_js focused.",
].join(" ");

// ── status ────────────────────────────────────────────────────────────────────
function setStatus(text, cls) {
    const el = $("#status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
}

// ── context meter ──────────────────────────────────────────────────────────────
let contextWindow = 131072;
let ctxUsed = 0;
function fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(Math.round(n));
}
function updateContextMeter(usage) {
    if (usage && typeof usage.input === "number") {
        ctxUsed = usage.input + (typeof usage.output === "number" ? usage.output : 0);
    }
    const meter = $("#ctx-meter");
    if (!meter) return;
    meter.style.display = ctxUsed > 0 ? "" : "none";
    const frac = contextWindow > 0 ? Math.min(1, ctxUsed / contextWindow) : 0;
    const fill = meter.querySelector(".ctx-fill");
    if (fill) fill.style.width = Math.round(frac * 100) + "%";
    const nums = meter.querySelector(".ctx-nums");
    if (nums) nums.textContent = fmtTokens(ctxUsed) + " / " + fmtTokens(contextWindow) + " ctx";
    meter.classList.toggle("warn", frac >= 0.75 && frac < 0.9);
    meter.classList.toggle("crit", frac >= 0.9);
}
function resetContextMeter() { ctxUsed = 0; updateContextMeter(null); }

// ── transcript rendering (adapted from pi-agent) ──────────────────────────────
const transcript = () => $("#transcript");
let stuckToBottom = true;
function scrollToBottom() {
    if (!stuckToBottom) return;
    const t = transcript();
    t.scrollTop = t.scrollHeight;
}
function clearHint() {
    const hint = transcript().querySelector(".hint");
    if (hint) hint.remove();
}
function addRow(who, cls, text) {
    clearHint();
    const row = document.createElement("div");
    row.className = "row " + cls;
    const label = document.createElement("span");
    label.className = "who";
    label.textContent = who;
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text || "";
    row.appendChild(label);
    row.appendChild(body);
    transcript().appendChild(row);
    scrollToBottom();
    return row;
}
function assistantText(message) {
    const content = message && message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    let out = "";
    for (const block of content) if (block && block.type === "text" && typeof block.text === "string") out += block.text;
    return out;
}
function thinkingText(message) {
    const content = message && message.content;
    if (!Array.isArray(content)) return "";
    let out = "";
    for (const block of content) if (block && block.type === "thinking" && typeof block.thinking === "string") out += block.thinking;
    return out;
}
function resultText(result) {
    if (result == null) return "";
    if (typeof result === "string") return result;
    const content = result.content;
    if (Array.isArray(content)) {
        let out = "";
        for (const block of content) if (block && block.type === "text" && typeof block.text === "string") out += block.text;
        if (out) return out;
    }
    try { return JSON.stringify(result.details ?? result, null, 2); } catch (e) { return String(result); }
}
function stringifyArgs(args) {
    if (args == null) return "";
    if (typeof args === "string") return args;
    try { return JSON.stringify(args, null, 2); } catch (e) { return String(args); }
}

const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
let mdPending = null, mdScheduled = false;
function renderInto(body, text) {
    mdPending = { body, text };
    if (mdScheduled) return;
    mdScheduled = true;
    raf(() => {
        mdScheduled = false;
        const p = mdPending; mdPending = null;
        if (p && p.body) { p.body.innerHTML = renderMarkdown(p.text); enhanceCodeBlocks(p.body); }
        scrollToBottom();
    });
}
function renderNow(body, text) {
    if (!body) return;
    body.innerHTML = renderMarkdown(text);
    enhanceCodeBlocks(body);
}
function enhanceCodeBlocks(container) {
    let blocks;
    try { blocks = container.querySelectorAll("pre.md-code"); } catch (e) { return; }
    for (let i = 0; i < blocks.length; i++) {
        const pre = blocks[i];
        if (pre.querySelector(".code-copy")) continue;
        const btn = document.createElement("button");
        btn.className = "code-copy";
        btn.textContent = "Copy";
        btn.addEventListener("click", () => {
            const code = pre.querySelector("code");
            try { navigator.clipboard && navigator.clipboard.writeText(code ? code.textContent : ""); } catch (e) {}
            btn.textContent = "Copied";
            setTimeout(() => { btn.textContent = "Copy"; }, 1200);
        });
        pre.appendChild(btn);
    }
}

let curBubble = null, curThinking = null;
const toolCards = new Map();
function ensureBubble() { if (!curBubble) curBubble = addRow("Agent", "agent streaming", ""); return curBubble; }
function finalizeBubble() { if (curBubble) curBubble.classList.remove("streaming"); curBubble = null; curThinking = null; }
function setThinking(row, text) {
    if (!text) return;
    if (!curThinking) {
        const fold = document.createElement("div");
        fold.className = "thinking collapsed";
        const head = document.createElement("div");
        head.className = "thinking-head";
        head.textContent = "💭 Thinking";
        head.addEventListener("click", () => fold.classList.toggle("collapsed"));
        const bodyEl = document.createElement("div");
        bodyEl.className = "thinking-body";
        fold.appendChild(head); fold.appendChild(bodyEl);
        transcript().insertBefore(fold, row);
        curThinking = fold;
    }
    const bodyEl = curThinking.querySelector(".thinking-body");
    if (bodyEl) bodyEl.textContent = text;
}
function setCardCollapsed(card, collapsed) {
    card.classList.toggle("collapsed", collapsed);
    const caret = card.querySelector(".tool-caret");
    if (caret) caret.textContent = collapsed ? "▸" : "▾";
}
function buildDiffEl(oldText, newText) {
    const wrap = document.createElement("div");
    wrap.className = "diff";
    for (const op of lineDiff(oldText, newText)) {
        const ln = document.createElement("div");
        ln.className = "diff-line " + op.type;
        const sign = op.type === "add" ? "+" : op.type === "del" ? "-" : " ";
        ln.textContent = sign + " " + op.text;
        wrap.appendChild(ln);
    }
    return wrap;
}
function addToolCard(toolCallId, toolName, args) {
    clearHint();
    const card = document.createElement("div");
    card.className = "tool-card";
    const head = document.createElement("div");
    head.className = "tool-head";
    const caret = document.createElement("span"); caret.className = "tool-caret"; caret.textContent = "▾";
    const name = document.createElement("span"); name.className = "tool-name"; name.textContent = toolName || "tool";
    const state = document.createElement("span"); state.className = "tool-state"; state.textContent = "running…";
    head.appendChild(caret); head.appendChild(name); head.appendChild(state);
    head.addEventListener("click", () => setCardCollapsed(card, !card.classList.contains("collapsed")));
    const body = document.createElement("div"); body.className = "tool-body";
    if (toolName === "edit_file" && args && typeof args === "object" &&
        (typeof args.old_text === "string" || typeof args.new_text === "string")) {
        if (args.path) { const p = document.createElement("div"); p.className = "tool-path"; p.textContent = args.path; body.appendChild(p); }
        body.appendChild(buildDiffEl(args.old_text || "", args.new_text || ""));
    } else {
        const pre = document.createElement("pre"); pre.className = "tool-args"; pre.textContent = stringifyArgs(args); body.appendChild(pre);
    }
    card.appendChild(head); card.appendChild(body);
    transcript().appendChild(card);
    if (toolCallId != null) toolCards.set(toolCallId, card);
    finalizeBubble();
    scrollToBottom();
    return card;
}
function ensureResultPre(card) {
    let resPre = card.querySelector(".tool-result");
    if (!resPre) { resPre = document.createElement("pre"); resPre.className = "tool-result"; (card.querySelector(".tool-body") || card).appendChild(resPre); }
    return resPre;
}
function finishToolCard(toolCallId, result, isError) {
    const card = toolCallId != null ? toolCards.get(toolCallId) : null;
    if (!card) return;
    card.classList.add(isError ? "error" : "done");
    const state = card.querySelector(".tool-state");
    if (state) state.textContent = isError ? "error" : "done";
    const text = resultText(result);
    ensureResultPre(card).textContent = text;
    const isEdit = card.querySelector(".diff") != null;
    const longResult = text.length > 500 || text.split("\n").length > 8;
    if (!isError && !isEdit && longResult) setCardCollapsed(card, true);
    scrollToBottom();
}

function onEvent(event) {
    if (!event || !event.type) return;
    try {
        switch (event.type) {
            case "agent_start": setStatus("working…", "running"); break;
            case "message_update": {
                const msg = event.message;
                if (!msg || (msg.role && msg.role !== "assistant")) break;
                const row = ensureBubble();
                const body = row.querySelector(".body");
                if (body) renderInto(body, assistantText(msg));
                setThinking(row, thinkingText(msg));
                break;
            }
            case "message_end": {
                const msg = event.message;
                if (msg && (!msg.role || msg.role === "assistant") && Array.isArray(msg.content)) {
                    if (curBubble) { const body = curBubble.querySelector(".body"); if (body) renderNow(body, assistantText(msg)); }
                    finalizeBubble();
                }
                if (msg && msg.usage) updateContextMeter(msg.usage);
                if (msg && msg.stopReason === "error" && msg.errorMessage) setStatus("model error: " + msg.errorMessage, "error");
                break;
            }
            case "tool_execution_start":
                addToolCard(event.toolCallId, event.toolName, event.args);
                setStatus("running " + (event.toolName || "tool") + "…", "running");
                break;
            case "tool_execution_update":
                if (event.partialResult != null) {
                    const card = toolCards.get(event.toolCallId);
                    if (card) { ensureResultPre(card).textContent = resultText(event.partialResult); scrollToBottom(); }
                }
                break;
            case "tool_execution_end": finishToolCard(event.toolCallId, event.result, !!event.isError); break;
            case "turn_end": finalizeBubble(); break;
            case "agent_end": finalizeBubble(); break;
            default: break;
        }
    } catch (e) { console.error("maker-agent render error", e); }
}

// ── tool-approval gate ──────────────────────────────────────────────────────
function approve(toolName, args) {
    if ($("#auto-approve").checked || sessionAllow.has(toolName)) return Promise.resolve(true);
    return new Promise((resolve) => {
        clearHint();
        const card = document.createElement("div");
        card.className = "approve-card";
        const ask = document.createElement("div");
        ask.className = "ask";
        ask.textContent = "Run tool ";
        const code = document.createElement("code"); code.textContent = toolName || "tool";
        ask.appendChild(code); ask.appendChild(document.createTextNode("?"));
        const argsPre = document.createElement("pre"); argsPre.className = "tool-args"; argsPre.style.marginTop = "6px"; argsPre.textContent = stringifyArgs(args);
        const btns = document.createElement("div"); btns.className = "btns";
        const yes = document.createElement("button"); yes.textContent = "Approve";
        const all = document.createElement("button"); all.textContent = "Approve all " + (toolName || "tool");
        const no = document.createElement("button"); no.textContent = "Deny";
        btns.appendChild(yes); btns.appendChild(all); btns.appendChild(no);
        card.appendChild(ask); card.appendChild(argsPre); card.appendChild(btns);
        transcript().appendChild(card); scrollToBottom();
        const settle = (ok, label) => { card.classList.add("resolved"); ask.textContent = label + " "; ask.appendChild(code); resolve(ok); };
        yes.addEventListener("click", () => settle(true, "Approved"));
        all.addEventListener("click", () => { sessionAllow.add(toolName); settle(true, "Approving all"); });
        no.addEventListener("click", () => settle(false, "Denied"));
    });
}

// ── look: capture the stage and ask a vision model what it sees ───────────────
function toBase64(u8) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    let i = 0;
    for (; i + 2 < u8.length; i += 3) {
        const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
    }
    const rem = u8.length - i;
    if (rem === 1) {
        const n = u8[i] << 16;
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
        const n = (u8[i] << 16) | (u8[i + 1] << 8);
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + "=";
    }
    return out;
}
// Capture the stage: returns { dataUri (jpeg, for the vision model), imageData (raw
// RGBA, for the on-screen thumbnail) } or null.
function captureStage() {
    try {
        const w = stageCanvas.width, h = stageCanvas.height;
        const imageData = stageCtx.getImageData(0, 0, w, h);
        if (!(typeof bro !== "undefined" && bro.image && bro.image.encodeJpeg)) throw new Error("bro.image.encodeJpeg unavailable");
        const bytes = bro.image.encodeJpeg(imageData.data, w, h, 4, 82);
        if (!bytes || !bytes.length) throw new Error("jpeg encode failed");
        return { dataUri: "data:image/jpeg;base64," + toBase64(bytes), imageData };
    } catch (e) {
        console.error("captureStage", e);
        return null;
    }
}
// Show what the agent saw as a small canvas thumbnail (a <canvas> holds the pixels
// we already have; JS-created <img> elements are not first-class in bro's DOM).
function addLookShot(imageData) {
    clearHint();
    const c = document.createElement("canvas");
    c.className = "look-shot";
    c.width = imageData.width;
    c.height = imageData.height;
    try { c.getContext("2d").putImageData(imageData, 0, 0); } catch (e) { console.error("thumb", e); }
    transcript().appendChild(c);
    scrollToBottom();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Honor the server's stated rate-limit wait: OpenRouter's retry_after_seconds or the
// Retry-After header (seconds), capped; else exponential backoff, min 400ms.
function retryAfterMs(headerVal, err, attempt) {
    const meta = err && err.metadata;
    const ra = meta && meta.retry_after_seconds;
    if (typeof ra === "number" && ra > 0) return Math.min(ra * 1000 + 300, 30000);
    const h = headerVal != null ? headerVal : (meta && meta.headers && meta.headers["Retry-After"]);
    if (h != null) { const s = Number(h); if (Number.isFinite(s) && s > 0) return Math.min(s * 1000 + 300, 30000); }
    return Math.max(400, Math.min(1000 * Math.pow(2, attempt), 12000));
}

// Free vision models to fall back through when the selected one is throttled — they
// route to DIFFERENT upstream providers, so a different model dodges a 429'd one.
const VISION_FALLBACKS = [
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "google/gemma-4-26b-a4b-it:free",
];

// One vision request to a single model, honoring the upstream's retry_after on 429.
async function orVisionCall(key, model, dataUri, instruction) {
    const payload = {
        model,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: instruction + "\nBe concrete and brief. Focus on what differs from the goal and what to change next." },
                { type: "image_url", image_url: { url: dataUri } },
            ],
        }],
        max_tokens: 320,
    };
    let lastErr = null;
    for (let attempt = 0; attempt <= 4; attempt++) {
        let status = 0, j = null, retryAfter = null;
        try {
            const resp = await fetch(OR_BASE + "/chat/completions", {
                method: "POST",
                headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            status = resp.status;
            try { retryAfter = resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null; } catch (e) {}
            j = await resp.json();
        } catch (e) {
            lastErr = e;
            if (attempt < 4) { await sleep(1000 * (attempt + 1)); continue; }
            throw e;
        }
        if (status >= 200 && status < 300 && j && !j.error) {
            const msg = j.choices && j.choices[0] && j.choices[0].message;
            return (msg && msg.content) || "(vision model returned no text)";
        }
        const err = j && j.error;
        lastErr = err || { message: "HTTP " + status };
        const code = err && err.code;
        const retryable = status === 429 || status >= 500 || code === 429 || (typeof code === "number" && code >= 500);
        if (retryable && attempt < 4) {
            const wait = retryAfterMs(retryAfter, err, attempt);
            if (status === 429) setStatus("look: " + model.replace(/:free$/, "") + " rate-limited — retrying in " + Math.round(wait / 1000) + "s…", "loading");
            await sleep(wait);
            continue;
        }
        break;
    }
    throw new Error((lastErr && lastErr.message) || "vision request failed");
}

// Try the selected vision model, then fall back through the others on failure.
async function visionDescribe(dataUri, instruction) {
    const key = $("#or-key").value.trim();
    if (!key) throw new Error("no OpenRouter key set for the vision model");
    const selected = $("#or-vision").value;
    const tries = [selected, ...VISION_FALLBACKS].filter((m, i, a) => m && a.indexOf(m) === i);
    if (!tries.length) throw new Error("no 'Eyes' vision model selected");
    let lastErr = null;
    for (const model of tries) {
        try { return await orVisionCall(key, model, dataUri, instruction); }
        catch (e) { lastErr = e; console.warn("vision model " + model + " failed: " + (e && e.message ? e.message : e)); }
    }
    throw new Error((lastErr && lastErr.message) || "all vision models failed");
}
async function look(instruction) {
    const cap = captureStage();
    if (!cap) return { content: [{ type: "text", text: "Error: could not capture the stage." }], details: { error: true } };
    addLookShot(cap.imageData);
    try {
        const desc = await visionDescribe(cap.dataUri, instruction);
        return { content: [{ type: "text", text: desc }], details: { looked: true } };
    } catch (e) {
        return { content: [{ type: "text", text: "Error looking at the stage: " + (e && e.message ? e.message : e) }], details: { error: true } };
    }
}

// ── model catalog (OpenRouter /models, filtered to free) ──────────────────────
async function refreshModels() {
    const key = $("#or-key").value.trim();
    setStatus("loading model list…", "loading");
    try {
        const headers = key ? { Authorization: "Bearer " + key } : {};
        const resp = await fetch(OR_BASE + "/models", { headers });
        const j = await resp.json();
        const models = (j && j.data) || [];
        const free = models.filter((m) => m.pricing && m.pricing.prompt === "0" && m.pricing.completion === "0");
        const tools = free.filter((m) => (m.supported_parameters || []).includes("tools"));
        const vision = free.filter((m) => ((m.architecture && m.architecture.input_modalities) || []).includes("image"));
        fillSelect($("#or-brain"), tools, store.get("brain", "nvidia/nemotron-3-super-120b-a12b:free"));
        fillSelect($("#or-vision"), vision, store.get("vision", "google/gemma-4-31b-it:free"));
        setStatus("models loaded — " + tools.length + " tool-callers, " + vision.length + " vision", "ready");
        updateSendEnabled();
    } catch (e) {
        setStatus("model list failed: " + (e && e.message ? e.message : e), "error");
    }
}
function fillSelect(sel, models, preferred) {
    sel.innerHTML = "";
    models.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
    for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.id.replace(/:free$/, "");
        sel.appendChild(opt);
    }
    if (models.some((m) => m.id === preferred)) sel.value = preferred;
    else if (models.length) sel.value = models[0].id;
}

// ── backend / session ─────────────────────────────────────────────────────────
function currentBackend() {
    if ($("#backend").value === "brolm") {
        if (!brolmHandle) return null;
        const { model, tokenizer } = brolmHandle;
        return {
            kind: "brolm",
            brolm: {
                model, tokenizer, family: "qwen3",
                decode: (ids) => tokenizer.decode(Array.from(ids)),
                eosId: tokenizer.imEndId,
            },
        };
    }
    const key = $("#or-key").value.trim();
    const model = $("#or-brain").value;
    if (!key || !model) return null;
    return {
        kind: "openrouter",
        openrouter: {
            apiKey: key, model, referer: "https://bro.dev", title: "Maker Agent",
            // Surface upstream rate-limit waits instead of a silent hang.
            onRateLimit: ({ waitMs }) => setStatus("rate-limited — retrying in " + Math.round(waitMs / 1000) + "s…", "loading"),
        },
        visionCapable: false,
    };
}
function ensureSession() {
    if (session) return session;
    const backend = currentBackend();
    if (!backend) return null;
    if (backend.kind === "openrouter") setContextWindowFor(backend.openrouter.model);
    session = createAgentSession({
        backend,
        cwd: agentCwd(),
        systemPrompt: MAKER_SYSTEM_PROMPT,
        onEvent,
        approve,
        look,
    });
    return session;
}
function setContextWindowFor() { contextWindow = 131072; updateContextMeter(null); }
function agentCwd() { return "D:/projects/broworkshop/ai/maker-agent"; }

// A backend/model change invalidates the running session (new conversation).
function invalidateSession() { session = null; }

// ── local brolm loading ─────────────────────────────────────────────────────
function loadLocal() {
    const path = $("#brolm-path").value.trim();
    if (!path) return;
    $("#btn-load-local").disabled = true;
    setStatus("loading local model…", "loading");
    try {
        bro.lm.loadQwen(path, {
            onReady: ({ model, tokenizer }) => {
                brolmHandle = { model, tokenizer };
                invalidateSession();
                $("#btn-load-local").disabled = false;
                setStatus("local model ready (" + model.numLayers + " layers)", "ready");
                updateSendEnabled();
            },
            onError: (e) => {
                $("#btn-load-local").disabled = false;
                setStatus("local load failed: " + (e && e.message ? e.message : e), "error");
            },
        });
    } catch (e) {
        $("#btn-load-local").disabled = false;
        setStatus("local load failed: " + (e.message || String(e)), "error");
    }
}

// ── send / stop ─────────────────────────────────────────────────────────────
function setRunning(on) {
    running = on;
    $("#btn-send").disabled = on || !canSend();
    $("#btn-stop").disabled = !on;
    $("#prompt").disabled = on;
}
function canSend() { return !!currentBackend(); }
function updateSendEnabled() { if (!running) $("#btn-send").disabled = !canSend(); }

async function send() {
    if (running) return;
    const s = ensureSession();
    if (!s) { setStatus("configure a backend first (key + model, or load a local model)", "error"); return; }
    const text = $("#prompt").value.trim();
    if (!text) return;
    stuckToBottom = true;
    addRow("You", "you", text);
    $("#prompt").value = "";
    setRunning(true);
    setStatus("working…", "running");
    try {
        await s.prompt(text);
    } catch (e) {
        setStatus("error: " + (e && e.message ? e.message : e), "error");
    } finally {
        finalizeBubble();
        setRunning(false);
        if ($("#status").className.indexOf("error") === -1) setStatus("ready", "ready");
    }
}
function stop() { if (session && running) session.abort(); setStatus("stopping…", "loading"); }

// ── wiring ──────────────────────────────────────────────────────────────────
function applyBackendVisibility() {
    const or = $("#backend").value === "openrouter";
    $("#or-controls").style.display = or ? "" : "none";
    $("#brolm-controls").style.display = or ? "none" : "";
    updateSendEnabled();
}

$("#backend").addEventListener("change", () => { store.set("backend", $("#backend").value); invalidateSession(); applyBackendVisibility(); });
$("#or-key").addEventListener("change", () => { store.set("orKey", $("#or-key").value.trim()); invalidateSession(); updateSendEnabled(); });
$("#or-brain").addEventListener("change", () => { store.set("brain", $("#or-brain").value); invalidateSession(); updateSendEnabled(); });
$("#or-vision").addEventListener("change", () => store.set("vision", $("#or-vision").value));
$("#brolm-path").addEventListener("change", () => store.set("brolmPath", $("#brolm-path").value.trim()));
$("#btn-refresh").addEventListener("click", refreshModels);
$("#btn-load-local").addEventListener("click", loadLocal);
$("#btn-send").addEventListener("click", send);
$("#btn-stop").addEventListener("click", stop);
$("#prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

// Debug/automation surface — used by headless verification scripts and the
// console. configure() sets the backend/key/models programmatically; prompt()
// drives a turn through the real session (same path as the Send button).
window.__makerDebug = {
    configure({ key, brain, vision, backend } = {}) {
        if (backend) $("#backend").value = backend;
        if (key != null) $("#or-key").value = key;
        const setSel = (sel, id) => {
            if (!id) return;
            if (!Array.from(sel.querySelectorAll("option")).some((o) => o.value === id)) {
                const o = document.createElement("option");
                o.value = id; o.textContent = id.replace(/:free$/, "");
                sel.appendChild(o);
            }
            sel.value = id;
        };
        setSel($("#or-brain"), brain);
        setSel($("#or-vision"), vision);
        invalidateSession();
        applyBackendVisibility();
    },
    prompt(text) { const s = ensureSession(); if (!s) throw new Error("no backend configured"); return s.prompt(text); },
    look, captureStage, clearStage,
    reset() { stageStop(); invalidateSession(); },
};

(function boot() {
    installSystemMenu({
        view: [{ id: "stage.clear", label: "Clear stage" }],
        handlers: { "stage.clear": () => { clearStage(); } },
    });
    $("#backend").value = store.get("backend", "openrouter");
    $("#or-key").value = store.get("orKey", "");
    $("#brolm-path").value = store.get("brolmPath", "");
    applyBackendVisibility();
    const t = transcript();
    t.addEventListener("scroll", () => { stuckToBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40; });
    // Pre-select saved model ids even before a live list loads.
    if (store.get("brain", "")) { const o = document.createElement("option"); o.value = store.get("brain"); o.textContent = store.get("brain").replace(/:free$/, ""); $("#or-brain").appendChild(o); $("#or-brain").value = store.get("brain"); }
    if (store.get("vision", "")) { const o = document.createElement("option"); o.value = store.get("vision"); o.textContent = store.get("vision").replace(/:free$/, ""); $("#or-vision").appendChild(o); $("#or-vision").value = store.get("vision"); }
    updateSendEnabled();
})();
