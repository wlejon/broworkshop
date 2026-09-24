// view/hud.js — the side panels and the damage log.
//
//   roster        one row per unit: HP / MP / dead
//   agent stats   whatever the active planner publishes (Agents.collectStats)
//   observation   bro.ai.game.buildObservation for the focused unit, as bars
//   action mask   bro.ai.game.buildActionMask for the focused unit
//   reward        cumulative per-team reward (createRewardTracker deltas)
//   damage log    one line per hit, drained from world.events by lab.js
//
// Panels self-throttle (Config.*_EVERY) with accumulators on the match state
// so a new match restarts them.
import { h, clear } from "/lib/kit/dom.js";
import { logView } from "/lib/kit/ui.js";
import { Config } from "/app/config.js";
import { Arena } from "/app/sim/arena.js";
import { Agents } from "/app/agents/index.js";

const MASK_CELLS = 13;   // bro.ai.game.buildActionMask width
const BG = "#0d1014", AXIS = "#2a2f36", RED = "#e74c3c", BLUE = "#3498db";

let el = null;
let log = null;
let rosterRows = [];
let maskCells = [];
let reward = { red: [], blue: [] };

export const hud = {
    /** A log line now (app events: recording, rewinds, ...). */
    log: (text, kind) => log.add(text, kind),
    /** A combat line, batched into the log at the roster cadence. */
    queueLog(state, text, kind) { (state.pendingLog || (state.pendingLog = [])).push({ text, kind }); },
    reward: () => reward,
};

function flushLog(state) {
    if (!state.pendingLog || !state.pendingLog.length) return;
    for (const l of state.pendingLog) log.add(l.text, l.kind);
    state.pendingLog.length = 0;
}

export function initHud() {
    el = {
        roster: document.getElementById("roster"),
        stats: document.getElementById("agent-stats"),
        obs: document.getElementById("obs-canvas"),
        mask: document.getElementById("mask-row"),
        rewardNums: document.getElementById("reward-nums"),
        reward: document.getElementById("reward-canvas"),
        focus: document.getElementById("sel-focus"),
    };
    log = logView("#log", { max: Config.LOG_LINES });
    clear(el.mask);
    maskCells = [];
    for (let i = 0; i < MASK_CELLS; i++) maskCells.push(el.mask.appendChild(h("div.mask-cell")));
}

/** New match: roster rows, focus options, empty reward history. Returns the default focus id. */
export function resetHud(roster) {
    clear(el.roster);
    rosterRows = roster.map(() => el.roster.appendChild(h("div.roster-row")));
    clear(el.focus);
    for (const r of roster) {
        el.focus.appendChild(h("option", { value: String(r.id) }, (r.teamId === 0 ? "[R] " : "[B] ") + r.name));
    }
    // Default focus: the first blue unit.
    const first = roster.find((r) => r.teamId === 1) || roster[0];
    el.focus.value = String(first.id);
    reward = { red: [], blue: [] };
    drawReward();
    return first.id;
}

export function setFocusOption(id) { el.focus.value = String(id); }

const PANELS = [
    { id: "roster",  every: Config.ROSTER_EVERY, update: updateRoster },
    { id: "log",     every: Config.ROSTER_EVERY, update: flushLog },
    { id: "obs",     every: Config.OBS_EVERY,    update: updateFocusPanels },
    { id: "reward",  every: Config.REWARD_EVERY, update: updateReward },
    { id: "stats",   every: Config.STATUS_EVERY, update: (s) => updateStats(Agents.collectStats(s)) },
];

/** Per frame: run each panel whose cadence is due. */
export function tickHud(state, dt) {
    const acc = state.hudAccum || (state.hudAccum = {});
    for (const p of PANELS) {
        acc[p.id] = (acc[p.id] || 0) + dt;
        if (acc[p.id] < p.every) continue;
        acc[p.id] = 0;
        p.update(state);
    }
}

function updateRoster(state) {
    state.agents.forEach((a, i) => {
        const row = rosterRows[i];
        if (!row) return;
        const u = a.unit;
        row.textContent = (u.teamId === 0 ? "[R] " : "[B] ") + Arena.nameOf(u.id) +
            "  HP " + Math.max(0, Math.round(u.hp)) + "  MP " + Math.round(u.mana) +
            (u.alive ? "" : "  (DEAD)");
        row.className = "roster-row " + (u.teamId === 0 ? "red" : "blue") + (u.alive ? "" : " dead");
    });
}

function updateFocusPanels(state) {
    const focus = state.byId[state.focusId];
    if (!focus || !focus.unit.alive) return;
    drawObservation(bro.ai.game.buildObservation(focus, state.world));
    const mask = bro.ai.game.buildActionMask(focus, state.world).mask;
    const n = Math.min(maskCells.length, mask.length);
    for (let i = 0; i < n; i++) maskCells[i].className = "mask-cell " + (mask[i] > 0.5 ? "on" : "off");
}

function drawObservation(obs) {
    const c = el.obs, ctx = c.getContext("2d");
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, c.width, c.height);
    if (!obs || !obs.length) return;
    const bw = c.width / obs.length, mid = c.height * 0.5;
    for (let i = 0; i < obs.length; i++) {
        const v = Math.max(-1, Math.min(1, obs[i]));
        const bar = Math.abs(v) * c.height * 0.48;
        ctx.fillStyle = v >= 0 ? "#4a8ad4" : "#d46a4a";
        ctx.fillRect(i * bw, v >= 0 ? mid - bar : mid, bw - 0.5, bar);
    }
    axis(ctx, c);
}

function axis(ctx, c) {
    ctx.strokeStyle = AXIS;
    ctx.beginPath();
    ctx.moveTo(0, c.height * 0.5);
    ctx.lineTo(c.width, c.height * 0.5);
    ctx.stroke();
}

/**
 * Every live frame, before the frame's world.events are cleared (the reward
 * trackers read that event window): add each unit's reward — damage dealt
 * minus taken, ±20 per kill / death — into its team's pending sum.
 */
export function accumulateRewards(state) {
    const acc = state.rewardAcc || (state.rewardAcc = [0, 0]);
    for (const a of state.agents) {
        const tr = state.rewards[a.unit.id];
        if (!tr) continue;
        const d = tr.consume(a, state.world);
        acc[a.unit.teamId] += d.damageDealt - d.damageTaken + d.kills * 20 - d.deaths * 20;
    }
}

function updateReward(state) {
    const acc = state.rewardAcc || [0, 0];
    push(reward.red, acc[0]);
    push(reward.blue, acc[1]);
    state.rewardAcc = [0, 0];
    drawReward();
}

function push(hist, delta) {
    hist.push((hist.length ? hist[hist.length - 1] : 0) + delta);
    while (hist.length > Config.REWARD_HISTORY) hist.shift();
}

function drawReward() {
    const c = el.reward, ctx = c.getContext("2d");
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, c.width, c.height);
    axis(ctx, c);
    const { red, blue } = reward;
    if (!red.length) { el.rewardNums.textContent = "Red 0.0 / Blue 0.0"; return; }
    let maxAbs = 1;
    for (let i = 0; i < red.length; i++) maxAbs = Math.max(maxAbs, Math.abs(red[i]), Math.abs(blue[i]));
    const line = (arr, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let j = 0; j < arr.length; j++) {
            const x = (j / (Config.REWARD_HISTORY - 1)) * c.width;
            const y = c.height * 0.5 - (arr[j] / maxAbs) * (c.height * 0.45);
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };
    line(red, RED);
    line(blue, BLUE);
    el.rewardNums.textContent = "Red " + red[red.length - 1].toFixed(1) + " / Blue " + blue[blue.length - 1].toFixed(1);
}

function updateStats(stats) {
    if (!stats) { el.stats.textContent = "(no planner stats)"; return; }
    const lines = stats.label ? [stats.label] : [];
    for (const k of Object.keys(stats)) if (k !== "label") lines.push(k.padEnd(12) + String(stats[k]));
    el.stats.textContent = lines.join("\n");
}
