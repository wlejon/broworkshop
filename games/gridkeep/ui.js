// ui.js — GridKeep's DOM chrome beyond the shell HUD: the tower palette,
// the wave button, the selected-tower panel and the game-over title.

import { TOWER_TYPES, MAX_LEVEL, upgradeCost } from "/app/sim.js";

export const TOWERS = Object.keys(TOWER_TYPES);

const $ = (id) => document.getElementById(id);

/** Write each tower's price and blurb into its palette button (once). */
export function fillPalette() {
    for (const type of TOWERS) {
        const btn = $("btn-" + type);
        if (!btn) continue;
        btn.querySelector(".tb-cost").textContent = TOWER_TYPES[type].cost + "g";
        btn.querySelector(".tb-desc").textContent = TOWER_TYPES[type].desc;
    }
}

/** Armed tower, affordability, wave button, lives flash, tower panel. */
export function refreshChrome(run) {
    const sim = run.sim;
    for (const type of TOWERS) {
        const btn = $("btn-" + type);
        if (!btn) continue;
        btn.classList.toggle("selected", run.placeType === type);
        btn.classList.toggle("poor", sim.gold < TOWER_TYPES[type].cost);
    }
    const wave = $("btn-wave");
    wave.textContent = sim.waveActive ? "WAVE " + sim.wave + " INCOMING"
        : sim.wave >= sim.finalWave ? "ALL WAVES DONE"
        : "START WAVE " + (sim.wave + 1) + "  [Space]";
    wave.classList.toggle("disabled", sim.waveActive || sim.over || sim.wave >= sim.finalWave);
    $("hud-lives-box").classList.toggle("hurt", run.hurtT > 0);
    refreshTowerPanel(run);
}

function refreshTowerPanel(run) {
    const panel = $("tower-panel");
    const t = run.selectedTower;
    panel.hidden = !t;
    if (!t) return;
    const def = TOWER_TYPES[t.type], sim = run.sim;
    $("tp-name").textContent = def.name + " Tower  ·  L" + t.level + (t.elevated ? "  (hilltop +1 range)" : "");
    $("tp-stats").textContent =
        "DMG " + sim.towerDamage(t) +
        "  ·  RANGE " + sim.towerRange(t) +
        "  ·  RATE " + (1 / sim.towerCooldown(t)).toFixed(1) + "/s" +
        (def.splash ? "  ·  SPLASH" : "") + (def.slow ? "  ·  SLOWS" : "");
    const up = $("btn-upgrade");
    if (t.level >= MAX_LEVEL) {
        up.textContent = "MAX LEVEL";
        up.classList.add("disabled");
    } else {
        up.textContent = "UPGRADE  (" + upgradeCost(t) + "g)";
        up.classList.toggle("disabled", sim.gold < upgradeCost(t));
    }
    $("btn-sell").textContent = "SELL  (+" + sim.sellRefund(t) + "g)";
}

/** "VICTORY" / "THE KEEP HAS FALLEN" over the game-over stats. */
export function setGameOverTitle(won) {
    const title = $("gameover-title");
    title.textContent = won ? "VICTORY" : "THE KEEP HAS FALLEN";
    title.className = "overlay-title " + (won ? "victory" : "defeat");
}
