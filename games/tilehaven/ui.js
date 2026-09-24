// ui.js — TileHaven's DOM chrome beyond the shell HUD: the build palette,
// the selected-building panel, toasts and the victory summary.

import { COSTS, BUILD_INFO, HOUSE_CAP, PROD, CART_LOAD } from "/app/sim.js";

export const TOOLS = ["road", "house", "farm", "lumber", "mine", "market", "dozer"];

const $ = (id) => document.getElementById(id);

/** Write each tool's price into its palette button (once). */
export function fillPaletteCosts() {
    for (const t of TOOLS) {
        const cost = COSTS[t];
        const el = $("btn-" + t) && $("btn-" + t).querySelector(".tb-cost");
        if (el && cost) el.textContent = cost.coins + "c" + (cost.wood ? " + " + cost.wood + "w" : "");
    }
}

/** Highlight the armed tool and grey out what the city cannot afford. */
export function refreshPalette(run) {
    const sim = run.sim;
    for (const t of TOOLS) {
        const btn = $("btn-" + t);
        if (!btn) continue;
        btn.classList.toggle("selected", run.tool === t);
        if (COSTS[t]) btn.classList.toggle("poor", sim.coins < COSTS[t].coins || sim.wood < COSTS[t].wood);
    }
}

/** The selected building's name + status line, or hidden with no selection. */
export function refreshInfoPanel(run) {
    const panel = $("info-panel");
    if (!panel) return;
    const b = run.selected;
    panel.hidden = !b;
    if (!b) return;
    $("ip-name").textContent = BUILD_INFO[b.type].name;
    const status = $("ip-status");
    status.textContent = buildingStatus(run.sim, b);
    status.classList.toggle("warn-text", !b.connected || (PROD[b.type] && !b.staffed));
}

function buildingStatus(sim, b) {
    if (b.type === "depot") return "Hub · " + sim.totalHauls + " hauls received";
    if (!b.connected) return "NOT ROAD-CONNECTED — build a road to the depot!";
    if (b.type === "house") return b.pop + "/" + HOUSE_CAP + " residents" + (sim.food < 1 ? " · needs food" : "");
    if (b.type === "market") return "Trading hub — carts deliver here";
    if (!b.staffed) return "NO WORKERS — build houses (" + sim.pop + "/" + sim.jobs() + " jobs filled)";
    return "Producing " + PROD[b.type].res + " · stock " + b.stock + "/" + CART_LOAD +
        (b.cartOut ? " · cart en route" : "");
}

/** The HUD goal chip. */
export function goalText(sim, goal) {
    if (sim.victory) return "GOAL REACHED";
    return "GOAL  " + sim.pop + "/" + goal.pop + " pop · " +
        Math.min(sim.coins, goal.coins) + "/" + goal.coins + " coins";
}

/** One-line city summary (victory + session-over screens). */
export function citySummary(sim, sep) {
    return "Population " + sim.pop + " · " + sim.coins + " coins" + sep +
        sim.totalHauls + " cart hauls · " + sim.totalOreSold + " ore sold";
}

let toastTimer = null;

/** Show `msg` in the toast strip for ~2 s. */
export function toast(msg) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1900);
}
