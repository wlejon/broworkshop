// hud.js — the right-dock farm HUD: clock, weather, resources, market,
// objective, workers, alerts and the chatter log. Static structure lives in
// index.html; the panels here are data-driven, rebuilt from world.observe()
// a few times a second (game.js throttles).

import { h, clear } from "/lib/kit/dom.js";
import { STATIONS } from "/app/defs.js";

const STATION_LABEL = {};
for (const s of STATIONS) STATION_LABEL[s.id] = s.label;
const STATION_SHORT = { pasture: "Pasture", coop: "Coop", meadow: "Meadow", garden: "Garden" };

const STATE_LABEL = {
    idle: "idle", working: "working", resting: "resting", sleeping: "asleep",
    eating: "eating", recovering: "recovering", waiting: "in line",
    talking: "talking", listening: "listening",
};
const GOOD_LABEL = { eggs: "Eggs", milk: "Milk", wool: "Wool", crops: "Crop", feed: "Feed" };
const MARKET_ORDER = ["eggs", "milk", "wool", "crops", "feed"];
const WEATHER_LABEL = {
    clear: "☀ Clear", rain: "🌧 Rain", drought: "🔥 Drought",
    frost: "❄ Frost", storm: "⛈ Storm",
};
const ALERT_MAX = 9;
const DIALOG_MAX = 8;

export function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Day 3 · 14:05" from world.clock (or observe().clock). */
export function clockText(clock) {
    const pad = (n) => String(n).padStart(2, "0");
    return "Day " + clock.day + " · " + pad(clock.hour) + ":" + pad(clock.minute);
}

/** Rebuild every panel from one observe() snapshot. */
export function renderHud(world, o) {
    el("hud-clock").textContent = clockText(o.clock);
    fill("hud-env", envChips(o.env));
    fill("hud-resources", resourceChips(o.resources));
    fill("hud-market", marketChips(o));
    fill("hud-objective", objective(o.objective));
    fill("hud-workers", o.npcs.map(workerRow));
    fill("hud-alerts", alerts(o.alerts));
    fill("hud-dialog", dialog(world));
}

// ── Panels ──────────────────────────────────────────────────────────────

function envChips(e) {
    return [
        h("span.env-chip.season-" + e.season, null, cap(e.season)),
        h("span.env-chip.wx-" + e.weather, null, WEATHER_LABEL[e.weather] || cap(e.weather)),
        h("span.env-chip.temp", null, e.temperature + "°"),
        h("span.env-chip.phase", null, cap(e.dayPhase)),
    ];
}

function chip(label, value, cls) {
    return h("div.res-chip", { class: cls },
        h("span.res-k", null, label),
        h("span.res-v", null, String(value)));
}

function resourceChips(r) {
    return [
        chip("Gold", r.gold, "gold"),
        chip("Feed", r.feed, r.feed < 40 ? "low" : ""),
        chip("Water", r.water, r.water < 40 ? "low" : ""),
        chip("Eggs", r.eggs),
        chip("Milk", r.milk),
        chip("Wool", r.wool),
        chip("Crops", r.crops),
    ];
}

function marketChips(o) {
    const m = o.market;
    return MARKET_ORDER.map((g) =>
        h("div.price-chip", { class: m.level[g] },
            h("span.price-k", null, GOOD_LABEL[g] || g),
            h("span.price-v", null, m.prices[g].toFixed(1) + "g")))
        .concat([
            chip("Barn", o.barnFeed, o.barnFeed < 220 ? "low" : ""),
            chip("Well", o.well.level),
        ]);
}

function objective(obj) {
    const pct = Math.max(0, Math.min(100, Math.round(100 * obj.progress / obj.target)));
    const met = obj.met ? "met" : "";
    return [
        h("div.obj-row", null,
            h("span", null, "Reach " + obj.target + "g by Day " + obj.deadlineDay),
            h("span.obj-num", { class: met }, obj.progress + " / " + obj.target + "g")),
        h("div.obj-bar", null, h("div.obj-fill", { class: met, style: { width: pct + "%" } })),
    ];
}

function level(v, lowAt, midAt) {
    return v < lowAt ? "low" : v < midAt ? "mid" : "ok";
}

function bar(kind, pct, cls) {
    return h("span.wk-bar", null,
        h("span.wk-fill", { class: (kind ? kind + " " : "") + cls, style: { width: Math.round(pct) + "%" } }));
}

function workerRow(n) {
    const healthMax = n.healthMax || 100;
    const crit = n.stamina < 15 || n.energy < 20 || n.hydration < 22 || n.health < 30;
    const station = n.station ? (STATION_SHORT[n.station] || n.station) : "";
    return h("div.wk-row", { class: crit ? "crit" : "" },
        h("span.wk-name.role-" + n.role, null, n.name,
            crit ? h("span.wk-crit", { title: "needs care" }, "!") : null),
        h("span.wk-state", null, STATE_LABEL[n.state] || n.state),
        h("span.wk-bars", null,
            bar("", 100 * n.stamina / (n.staminaMax || 100), level(n.stamina, 25, 55)),
            bar("en", n.energy, level(n.energy, 30, 55)),
            bar("wa", n.hydration, level(n.hydration, 22, 50)),
            bar("hp", 100 * n.health / healthMax, level(n.health, healthMax * 0.30, healthMax * 0.55))),
        h("span.wk-station", { title: station ? (STATION_LABEL[n.station] || station) : "" }, station));
}

function alerts(list) {
    if (list.length === 0) return [h("div.alert.ok", null, "All calm")];
    return list.slice(0, ALERT_MAX).map((a) => h("div.alert." + a.level, null, a.msg));
}

function speakerName(world, id) {
    const n = world.npcs.find((x) => x.id === id);
    return n ? n.name : id;
}

const SPEAKER_CLASS = { Foreman: "foreman", You: "you", Farm: "farm" };

function dialog(world) {
    if (world.dialog.length === 0) return [h("div.line.muted", null, "…")];
    return world.dialog.slice(0, DIALOG_MAX).map((d) =>
        h("div.line", { class: SPEAKER_CLASS[d.speaker] || "" },
            h("span.who", null, speakerName(world, d.speaker) + ":"), " " + d.text));
}

// ── helpers ─────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

function fill(id, nodes) {
    const e = clear(el(id));
    for (const n of nodes) e.appendChild(n);
}
