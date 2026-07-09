// OpenRouter model catalog + explorer — a reusable, engine-free module.
//
// The OpenRouter /models endpoint is a plain HTTP GET returning every model
// with pricing (per-token strings), context length, input/output modalities,
// and supported_parameters (e.g. "tools"). Everything here is fetch + DOM, so
// any bro app can browse, filter, search, and pick a model with its price in
// view — no C++ binding required.
//
//   import { openModelPicker, fetchModels, filterModels } from "/lib/openrouter.js";
//   const id = await openModelPicker({ key, filter: { tools: true } });
//
// Surface: fetchModels(key) → catalog; priceOf/hasTools/hasVision/inputModalities
// (per-model helpers); formatPrice/formatCtx (display); filterModels(models, opts)
// (free/paid/tools/vision/maxPromptPerM/q); openModelPicker(opts) → Promise<id|null>.
// Each is documented at its definition below.

const OR_BASE = "https://openrouter.ai/api/v1";

// ── data ──────────────────────────────────────────────────────────────────────

// Fetch the full model catalog. `key` is optional (the list is public), but
// passing it returns the same view the account sees. Returns the raw model
// objects (id, name, pricing, context_length, architecture, supported_parameters…).
export async function fetchModels(key) {
    const headers = key ? { Authorization: "Bearer " + key } : {};
    const resp = await fetch(OR_BASE + "/models", { headers });
    if (!resp.ok) throw new Error("OpenRouter /models HTTP " + resp.status);
    const j = await resp.json();
    return (j && j.data) || [];
}

// Pricing normalized to dollars-per-million-tokens (OpenRouter quotes per-token
// strings). isFree is the exact "0"/"0" test the catalog uses for its free tier.
export function priceOf(m) {
    const p = (m && m.pricing) || {};
    const prompt = Number(p.prompt || "0");
    const completion = Number(p.completion || "0");
    return {
        prompt, completion,
        promptPerM: prompt * 1e6,
        completionPerM: completion * 1e6,
        isFree: p.prompt === "0" && p.completion === "0",
    };
}

export function hasTools(m) {
    return ((m && m.supported_parameters) || []).includes("tools");
}
export function inputModalities(m) {
    return (m && m.architecture && m.architecture.input_modalities) || [];
}
export function hasVision(m) {
    return inputModalities(m).includes("image");
}

// "$2.50/M", "$0.0004/M", or "free". perM is dollars per million tokens.
export function formatPrice(perM) {
    if (!perM) return "free";
    if (perM < 0.01) return "$" + perM.toFixed(4) + "/M";
    if (perM < 1) return "$" + perM.toFixed(3) + "/M";
    return "$" + perM.toFixed(2) + "/M";
}

// Compact "8k" / "131k" / "1M" context length.
export function formatCtx(n) {
    if (!n) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "k";
    return String(n);
}

// Filter a catalog. All options are optional and AND together:
//   free    — only $0/$0 models        paid   — only priced models
//   tools   — only tool-callers         vision — only image-input models
//   maxPromptPerM — cap on prompt $/M   q      — substring over id + name
export function filterModels(models, opts = {}) {
    const { free, paid, tools, vision, maxPromptPerM, q } = opts;
    const needle = (q || "").trim().toLowerCase();
    return models.filter((m) => {
        const pr = priceOf(m);
        if (free && !pr.isFree) return false;
        if (paid && pr.isFree) return false;
        if (tools && !hasTools(m)) return false;
        if (vision && !hasVision(m)) return false;
        if (maxPromptPerM != null && pr.promptPerM > maxPromptPerM) return false;
        if (needle) {
            const hay = (m.id + " " + (m.name || "")).toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

// Default sort: free first, then cheapest prompt price, then largest context.
function defaultSort(a, b) {
    const pa = priceOf(a), pb = priceOf(b);
    if (pa.isFree !== pb.isFree) return pa.isFree ? -1 : 1;
    if (pa.promptPerM !== pb.promptPerM) return pa.promptPerM - pb.promptPerM;
    return (b.context_length || 0) - (a.context_length || 0);
}

const SORTS = {
    price: (a, b) => defaultSort(a, b),
    id:    (a, b) => a.id.localeCompare(b.id),
    out:   (a, b) => priceOf(a).completionPerM - priceOf(b).completionPerM,
    ctx:   (a, b) => (a.context_length || 0) - (b.context_length || 0),
};

// ── explorer UI ─────────────────────────────────────────────────────────────

let stylesInstalled = false;
function ensureStyles() {
    if (stylesInstalled) return;
    stylesInstalled = true;
    const css = `
.ormp-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.6);display:flex;
  align-items:center;justify-content:center;z-index:99999;user-select:none;
  font:13px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#e6e9ef;}
.ormp-panel{width:900px;max-width:94vw;height:88vh;max-height:660px;display:flex;flex-direction:column;
  background:#1b1e26;border:1px solid #2c313d;border-radius:10px;overflow:hidden;
  box-shadow:0 12px 48px rgba(0,0,0,.6);}
.ormp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #2c313d;background:#222632;}
.ormp-title{font-weight:650;font-size:14px;}
.ormp-x{margin-left:auto;background:#2c313d;border:1px solid #3a4150;color:#e6e9ef;
  border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:15px;line-height:1;}
.ormp-x:hover{border-color:#6ea8fe;}
.ormp-tools{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #2c313d;flex-wrap:wrap;}
.ormp-search{flex:1 1 220px;min-width:160px;font:inherit;color:#e6e9ef;background:#14161b;
  border:1px solid #2c313d;border-radius:7px;padding:7px 10px;}
.ormp-chip{font:inherit;font-size:12px;color:#9aa3b2;background:#14161b;border:1px solid #2c313d;
  border-radius:14px;padding:5px 11px;cursor:pointer;user-select:none;}
.ormp-chip.on{color:#0e1014;background:#7ee3b8;border-color:#7ee3b8;font-weight:600;}
.ormp-scroll{flex:1 1 auto;overflow:auto;}
.ormp-hrow,.ormp-row{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #23272f;}
.ormp-hrow{position:sticky;top:0;z-index:1;background:#222632;color:#9aa3b2;font-size:11px;
  text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #2c313d;}
.ormp-hcell{cursor:pointer;}
.ormp-c-model{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:7px;}
.ormp-c-num{flex:0 0 92px;text-align:right;font-variant-numeric:tabular-nums;}
.ormp-c-ctx{flex:0 0 66px;text-align:right;}
.ormp-row{cursor:pointer;}
.ormp-row:hover{background:#242a37;}
.ormp-row.sel{background:#2a3550;}
.ormp-id{flex:0 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:12.5px;color:#e6e9ef;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ormp-badges{flex:0 0 auto;white-space:nowrap;}
.ormp-free{color:#7ee3b8;font-weight:600;}
.ormp-badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:9px;margin-left:4px;
  border:1px solid #3a4150;color:#9aa3b2;}
.ormp-badge.t{border-color:#3f5a7a;color:#8fb9ff;}
.ormp-badge.v{border-color:#5a4a7a;color:#c0a8ff;}
.ormp-foot{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #2c313d;background:#222632;}
.ormp-count{font-size:12px;color:#9aa3b2;}
.ormp-btn{margin-left:auto;font:inherit;color:#e6e9ef;background:#2c313d;border:1px solid #3a4150;
  border-radius:6px;padding:7px 14px;cursor:pointer;}
.ormp-btn:hover:not(:disabled){border-color:#6ea8fe;}
.ormp-btn.primary{background:#6ea8fe;color:#0e1014;border-color:#6ea8fe;font-weight:600;}
.ormp-btn:disabled{opacity:.5;cursor:default;}
.ormp-msg{padding:24px;text-align:center;color:#9aa3b2;}
`;
    const s = document.createElement("style");
    s.id = "ormp-styles";
    s.textContent = css;
    document.head.appendChild(s);
}

// Open a modal model explorer. Resolves to the chosen model id, or null if
// cancelled. Options:
//   key      — API key (used to fetch the catalog if `models` isn't given)
//   models   — a pre-fetched catalog (skips the network round-trip)
//   filter   — initial { free, tools, vision } chip state (e.g. {tools:true})
//   initial  — model id to pre-select/highlight
//   title    — panel heading
//   onPick   — optional callback(id) invoked on confirm (also resolved)
export function openModelPicker(opts = {}) {
    const { key, models, filter = {}, initial, title = "OpenRouter models", onPick } = opts;
    ensureStyles();

    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "ormp-overlay";
        overlay.innerHTML = `
<div class="ormp-panel" role="dialog" aria-modal="true">
  <div class="ormp-head">
    <span class="ormp-title"></span>
    <button class="ormp-x" title="Close">×</button>
  </div>
  <div class="ormp-tools">
    <input class="ormp-search" type="text" placeholder="Search id or name…" spellcheck="false">
    <button class="ormp-chip" data-f="free">Free</button>
    <button class="ormp-chip" data-f="tools">Tools</button>
    <button class="ormp-chip" data-f="vision">Vision</button>
  </div>
  <div class="ormp-scroll">
    <div class="ormp-hrow">
      <div class="ormp-c-model ormp-hcell" data-s="id">Model</div>
      <div class="ormp-c-num ormp-hcell" data-s="price">In $/M</div>
      <div class="ormp-c-num ormp-hcell" data-s="out">Out $/M</div>
      <div class="ormp-c-ctx ormp-hcell" data-s="ctx">Context</div>
    </div>
    <div class="ormp-list"></div>
    <div class="ormp-msg" style="display:none"></div>
  </div>
  <div class="ormp-foot">
    <span class="ormp-count"></span>
    <button class="ormp-btn" data-a="cancel">Cancel</button>
    <button class="ormp-btn primary" data-a="use" disabled>Use model</button>
  </div>
</div>`;
        document.body.appendChild(overlay);

        const q = (sel) => overlay.querySelector(sel);
        q(".ormp-title").textContent = title;

        const state = {
            all: models || null,
            q: "",
            free: !!filter.free, tools: !!filter.tools, vision: !!filter.vision,
            sortKey: "price", sortDir: 1,
            selected: initial || null,
        };

        function close(val) {
            overlay.remove();
            document.removeEventListener("keydown", onKey);
            resolve(val);
            if (val && onPick) onPick(val);
        }
        function onKey(e) {
            if (e.key === "Escape") close(null);
            else if (e.key === "Enter" && state.selected) close(state.selected);
        }
        document.addEventListener("keydown", onKey);
        overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
        q('[data-a="cancel"]').addEventListener("click", () => close(null));
        q(".ormp-x").addEventListener("click", () => close(null));
        q('[data-a="use"]').addEventListener("click", () => { if (state.selected) close(state.selected); });

        // Chips
        overlay.querySelectorAll(".ormp-chip").forEach((chip) => {
            const f = chip.dataset.f;
            if (state[f]) chip.classList.add("on");
            chip.addEventListener("click", () => {
                state[f] = !state[f];
                chip.classList.toggle("on", state[f]);
                render();
            });
        });
        // Search
        q(".ormp-search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
        // Sort headers
        overlay.querySelectorAll(".ormp-hcell").forEach((th) => {
            th.addEventListener("click", () => {
                const k = th.dataset.s;
                if (state.sortKey === k) state.sortDir *= -1;
                else { state.sortKey = k; state.sortDir = k === "id" ? 1 : (k === "ctx" ? -1 : 1); }
                render();
            });
        });

        function render() {
            const list = q(".ormp-list");
            const msg = q(".ormp-msg");
            if (!state.all) {
                list.innerHTML = "";
                msg.style.display = ""; msg.textContent = "Loading models…";
                return;
            }
            let rows = filterModels(state.all, {
                free: state.free, tools: state.tools, vision: state.vision, q: state.q,
            });
            const cmp = SORTS[state.sortKey] || SORTS.price;
            rows = rows.slice().sort((a, b) => cmp(a, b) * state.sortDir);

            msg.style.display = rows.length ? "none" : "";
            if (!rows.length) msg.textContent = "No models match these filters.";

            list.innerHTML = "";
            for (const m of rows) {
                const pr = priceOf(m);
                const row = document.createElement("div");
                row.className = "ormp-row" + (m.id === state.selected ? " sel" : "");
                const badges =
                    (hasTools(m) ? '<span class="ormp-badge t">tools</span>' : "") +
                    (hasVision(m) ? '<span class="ormp-badge v">vision</span>' : "");
                const freeCls = pr.isFree ? " ormp-free" : "";
                row.innerHTML =
                    `<div class="ormp-c-model"><span class="ormp-id">${escapeHtml(m.id)}</span>` +
                    `<span class="ormp-badges">${badges}</span></div>` +
                    `<div class="ormp-c-num${freeCls}">${pr.isFree ? "free" : formatPrice(pr.promptPerM)}</div>` +
                    `<div class="ormp-c-num${freeCls}">${pr.isFree ? "free" : formatPrice(pr.completionPerM)}</div>` +
                    `<div class="ormp-c-ctx">${formatCtx(m.context_length)}</div>`;
                row.addEventListener("click", () => {
                    state.selected = m.id;
                    list.querySelectorAll(".ormp-row.sel").forEach((r) => r.classList.remove("sel"));
                    row.classList.add("sel");
                    q('[data-a="use"]').disabled = false;
                });
                row.addEventListener("dblclick", () => close(m.id));
                list.appendChild(row);
            }
            q(".ormp-count").textContent = rows.length + " of " + state.all.length + " models";
            q('[data-a="use"]').disabled = !state.selected;
        }

        render();
        q(".ormp-search").focus();

        // Fetch if not supplied.
        if (!state.all) {
            fetchModels(key)
                .then((list) => { state.all = list; render(); })
                .catch((e) => {
                    const msg = q(".ormp-msg");
                    msg.style.display = ""; msg.textContent = "Failed to load models: " + (e && e.message ? e.message : e);
                });
        }
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
