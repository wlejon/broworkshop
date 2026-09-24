// ui.js — BlastGrid's DOM chrome beyond the shell HUD: the contender chips
// with their round-win stars, the round-over banner and the match summary.

import { WINS_TARGET } from "/app/rules.js";

const $ = (id) => document.getElementById(id);

export const rgb = (c) =>
    "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";

/** One chip per contender: colour dot, name, win stars. */
export function buildChips(sim) {
    const bar = $("hud-chips");
    bar.textContent = "";
    for (const e of sim.contenders) {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.id = "chip-" + e.i;
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = rgb(e.color);
        const name = document.createElement("span");
        name.className = "cname";
        name.textContent = e.name;
        const wins = document.createElement("span");
        wins.className = "cwins";
        chip.appendChild(dot);
        chip.appendChild(name);
        chip.appendChild(wins);
        bar.appendChild(chip);
    }
}

/** ★ per round won, · per round still needed; dead bombers greyed out. */
export function refreshChips(sim) {
    for (const e of sim.contenders) {
        const chip = $("chip-" + e.i);
        if (!chip) continue;
        chip.classList.toggle("dead", !e.alive);
        chip.querySelector(".cwins").textContent =
            "★".repeat(e.wins) + "·".repeat(Math.max(0, WINS_TARGET - e.wins));
    }
}

/** The round-over screen: winner in their colour, match target. */
export function fillRoundScreen(sim) {
    const w = sim.winner;
    const title = $("round-title");
    title.textContent = w ? w.name + " WINS THE ROUND" : "DRAW";
    title.style.color = w ? rgb(w.color) : "";
    $("round-sub").textContent = "First to " + WINS_TARGET + "  ·  Round " + sim.round;
}

/** Game-over stats: match winner and every contender's wins. */
export function matchSummary(sim, newBest) {
    const lines = [sim.winner ? sim.winner.name + " WINS THE MATCH" : "MATCH OVER", ""];
    for (const e of sim.contenders) lines.push(e.name + ": " + e.wins + " win" + (e.wins === 1 ? "" : "s"));
    lines.push("", "Your wins: " + sim.human.wins + (newBest ? "  ·  NEW BEST" : ""));
    return lines.join("\n");
}
