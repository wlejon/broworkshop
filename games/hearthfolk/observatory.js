// The observatory DOM around the scene: village chronicle, conversation
// feed, speech bubbles over heads, the selected villager's mind panel, the
// status chip + speed buttons, and a toast.

import { h, clear } from "/lib/kit/dom.js";
import { PHASE_LABEL } from "/app/defs.js";

const byId = (id) => document.getElementById(id);
const phaseLabel = (p) => PHASE_LABEL[p] || p;

function cssColor(c) {
    const b = (x) => Math.round(Math.min(1, x * 1.8) * 255);
    return "rgb(" + b(c[0]) + "," + b(c[1]) + "," + b(c[2]) + ")";
}

/** Mirror sim.chronicle into #chronicle-list, now and as entries arrive. */
export function wireChronicle(sim) {
    const list = byId("chronicle-list");
    sim.onChronicle = (e) => {
        list.appendChild(h("div", { className: "chron-entry " + e.kind },
            h("span.chron-stamp", { text: "D" + e.day + " " + phaseLabel(e.phase) }), " " + e.text));
        while (list.children.length > 120) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
    };
    clear(list);
    for (const e of sim.chronicle) sim.onChronicle(e);
}

/** One spoken line in the conversation feed (last seven kept). */
export function addFeed(v, text) {
    const feed = byId("feed");
    feed.appendChild(h("div.feed-line", null, h("b", { text: v.name, style: { color: cssColor(v.color) } }), ": " + text));
    while (feed.children.length > 7) feed.removeChild(feed.firstChild);
}

/**
 * Speech bubbles that follow the speakers. `project(v)` gives a villager's
 * client-pixel head position. Returns { sync(sim), clear() }.
 */
export function createBubbles(project) {
    const divs = new Map();
    return {
        sync(sim) {
            const layer = byId("bubbles");
            for (const v of sim.villagers) {
                let div = divs.get(v.id);
                if (!v.say) {
                    if (div) { div.remove(); divs.delete(v.id); }
                    continue;
                }
                if (!div) {
                    div = layer.appendChild(h("div.bubble"));
                    divs.set(v.id, div);
                }
                if (div.textContent !== v.say.text) div.textContent = v.say.text;
                const p = project(v);
                if (!p) continue;
                div.style.left = Math.round(p.x) + "px";
                div.style.top = Math.round(p.y) + "px";
            }
        },
        clear() {
            for (const div of divs.values()) div.remove();
            divs.clear();
        },
    };
}

function needBar(id, val) {
    const el = byId(id);
    el.style.width = Math.round(Math.min(1, Math.max(0, val)) * 100) + "%";
    el.className = "bar-fill" + (val > 0.66 ? " hot" : val > 0.4 ? " warm" : "");
}

function renderMindPanel(v, voiced) {
    const panel = byId("mind-panel");
    panel.style.display = v ? "" : "none";
    if (!v) return;
    byId("mp-name").textContent = v.name;
    byId("mp-sub").textContent = v.temperament + " " + v.role + " · " + v.activity +
        (voiced ? " · voice " + v.voice : "");
    byId("mp-goal").textContent = v.goal || "—";
    needBar("bar-hunger", v.needs.hunger);
    needBar("bar-energy", v.needs.energy);
    needBar("bar-social", v.needs.social);
    needBar("bar-warmth", v.needs.warmth);
    byId("mp-think").textContent = !v.lastThink ? "no thoughts yet — tier-0 instinct"
        : v.lastThink.discarded ? "(discarded)\n" + String(v.lastThink.raw).slice(0, 300)
        : JSON.stringify(v.lastThink.parsed, null, 1);
    const mem = byId("mp-memories");
    const sig = v.memories.join("\u0001");
    if (mem.dataset.sig !== sig) {
        mem.dataset.sig = sig;
        clear(mem);
        if (!v.memories.length) mem.appendChild(h("li.empty", { text: "no memories yet" }));
        for (const m of v.memories) mem.appendChild(h("li", { text: m }));
    }
}

/** Status chip, speed buttons and the mind panel. */
export function renderPanels(sim, selected, voiced) {
    const m = sim.mind;
    const chip = byId("mind-chip");
    chip.textContent = typeof globalThis.__hearthmindGenerate === "function" ? "minds: test harness" : m.statusText;
    chip.className = "chip " + (m.status === "ready" ? "on" : m.status === "loading" ? "loading" : "off");
    for (const [id, sp] of [["btn-pause", 0], ["btn-1x", 1], ["btn-4x", 4]])
        byId(id).classList.toggle("selected", sim.speed === sp);
    renderMindPanel(selected, voiced);
}

let toastTimer = null;

/** A short message bottom-centre for ~2 s. */
export function toast(msg) {
    const t = byId("toast");
    t.textContent = msg;
    t.style.display = "";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = "none"; }, 1900);
}
