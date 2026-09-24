// inspect.js — click a person on the board to open their stat sheet (the
// left-dock #statsheet): needs, attributes, station and what they carry.
//
// People are picked by where their body is DRAWN, not by the ground tile
// under the cursor: each person is a foot→head segment projected to the
// screen, and the click must land within a radius of it (a tall figure draws
// well above its foot tile, so a ground-plane pick would miss it).

import { h, clear } from "/lib/kit/dom.js";
import {
    STAT_KEYS, STAT_LABEL, STAT_MAX_LEVEL, statXpToNext,
    staminaMaxFor, healthMaxFor, ROLE_COLOR, STATIONS,
} from "/app/defs.js";

const STATION_LABEL = {};
for (const s of STATIONS) STATION_LABEL[s.id] = s.label;

const PANEL_STATE = {
    idle: "idle", working: "working", walking: "walking", resting: "resting",
    sleeping: "asleep", eating: "eating", recovering: "recovering", talking: "talking",
    listening: "listening", waiting: "waiting to report", supervising: "supervising",
};
const ROLE_DISPLAY = {
    rancher: "Rancher", gardener: "Gardener", farmhand: "Farmhand", foreman: "Foreman",
};
const FOREMAN_COLOR = "#b5343a";
const MIN_PICK_PX = 18;   // pick radius floor around a person's drawn segment

/**
 * createInspector(world, stage) → { clickAt, select, close, refresh, isOpen,
 * selectedId }. `stage` supplies toScreen (lib/arcade/scene3d.js).
 */
export function createInspector(world, stage) {
    const panel = document.getElementById("statsheet");
    let open = false;

    function people() {
        const out = world.npcs.map((n) => ({ id: n.id, x: n.x, y: n.y }));
        if (world.foreman) out.push({ id: world.foreman.id, x: world.foreman.x, y: world.foreman.y });
        return out;
    }

    /** Id of the person drawn under a client pixel, or null. */
    function personAt(clientX, clientY) {
        let best = null, bestD = Infinity;
        for (const p of people()) {
            const foot = stage.toScreen(p.x, 0.1, p.y);
            const head = stage.toScreen(p.x, 1.5, p.y);
            if (!foot || !head) continue;
            const radius = Math.max(MIN_PICK_PX, 0.5 * Math.hypot(head.x - foot.x, head.y - foot.y));
            const d = distToSeg(clientX, clientY, foot.x, foot.y, head.x, head.y);
            if (d <= radius && d < bestD) { best = p.id; bestD = d; }
        }
        return best;
    }

    /** Board click: open the sheet for the person there, else close it. */
    function clickAt(clientX, clientY) {
        const id = personAt(clientX, clientY);
        if (id) select(id);
        else close();
        return id;
    }

    function select(id) {
        world.inspect = id;
        open = true;
        panel.hidden = false;
        refresh();
    }

    function close() {
        world.inspect = null;
        open = false;
        panel.hidden = true;
    }

    /** Re-render the open sheet from the live world. */
    function refresh() {
        if (!open) return;
        const e = entity(world, world.inspect);
        if (!e) { close(); return; }
        document.getElementById("ss-swatch").style.background = e.color;
        document.getElementById("ss-name").textContent = e.name;
        const role = document.getElementById("ss-role");
        role.textContent = e.roleLabel;
        role.style.color = e.color;
        fill("ss-state", [PANEL_STATE[e.state] || e.state || "",
            e.carrying ? [" · ", h("span.carry", null, "carrying " + e.carrying)] : null]);
        fill("ss-station", e.station
            ? [h("span.st-k", null, "Station ·"), " " + (STATION_LABEL[e.station] || e.station)]
            : e.hasVitals ? [h("span.st-k", null, "Station · unassigned")] : []);
        fill("ss-needs", e.hasVitals
            ? [needRow("Stamina", e.stamina, e.staminaMax, ""),
               needRow("Energy", e.energy, 100, "en"),
               needRow("Water", e.hydration, 100, "wa"),
               needRow("Health", e.health, e.healthMax, "hp")]
            : [h("div.ss-need-row", null, h("span.ss-need-k.ss-note", null, "command post · always on duty"))]);
        fill("ss-stats", e.stats ? STAT_KEYS.map((k) => statRow(k, e.stats[k])) : []);
    }

    close();
    return {
        clickAt, select, close, refresh, personAt,
        isOpen: () => open,
        selectedId: () => world.inspect,
    };
}

// ── Sheet content ───────────────────────────────────────────────────────

function entity(world, id) {
    if (!id) return null;
    if (world.foreman && id === world.foreman.id) {
        const f = world.foreman;
        return {
            id: f.id, name: f.name, roleLabel: ROLE_DISPLAY.foreman, color: FOREMAN_COLOR,
            stats: f.stats, hasVitals: false, state: "supervising", carrying: null, station: null,
        };
    }
    const n = world.npcs.find((x) => x.id === id);
    if (!n) return null;
    return {
        id: n.id, name: n.name, roleLabel: ROLE_DISPLAY[n.role] || n.role,
        color: ROLE_COLOR[n.role] || "#caa", stats: n.stats, hasVitals: true,
        stamina: n.stamina, staminaMax: staminaMaxFor(n), energy: n.energy,
        hydration: n.hydration, health: n.health, healthMax: healthMaxFor(n),
        state: n.state, carrying: n.carrying, station: n.station || null,
    };
}

function needRow(label, val, max, kind) {
    const f = Math.max(0, Math.min(1, val / max));
    const cls = val < max * 0.25 ? "low" : val < max * 0.55 ? "mid" : "ok";
    return h("div.ss-need-row", null,
        h("span.ss-need-k", null, label),
        h("span.ss-need-bar", null,
            h("span.ss-need-fill", { class: kind + " " + cls, style: { width: Math.round(f * 100) + "%" } })),
        h("span.ss-need-v", null, String(Math.round(val))));
}

function statRow(key, s) {
    const maxed = s.level >= STAT_MAX_LEVEL;
    const pct = maxed ? 100 : Math.max(0, Math.min(100, Math.round(100 * s.xp / statXpToNext(s.level))));
    return h("div.ss-stat-row", { class: maxed ? "maxed" : "" },
        h("span.ss-stat-k", null, STAT_LABEL[key]),
        h("span.ss-stat-lvl", null, String(s.level)),
        h("span.ss-stat-xpwrap", null, h("span.ss-stat-xp", { style: { width: pct + "%" } })));
}

// ── helpers ─────────────────────────────────────────────────────────────

function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function fill(id, nodes) {
    const e = clear(document.getElementById(id));
    const add = (n) => {
        if (n == null) return;
        if (Array.isArray(n)) n.forEach(add);
        else e.appendChild(typeof n === "object" ? n : document.createTextNode(String(n)));
    };
    add(nodes);
}
