// hud.js — the FPS Arena combat HUD: health bar, kills, kill feed, damage
// flash, death overlay, click-to-play prompt, net line, and the crosshair.
// Static structure lives in index.html; this only updates it.

import { crosshair } from "/lib/crosshair.js";

const FEED_MS = 3500;
const FLASH_MS = 200;

const $ = (id) => document.getElementById(id);

const CROSSHAIR = {
    style: "crossdot", size: 12, thickness: 2, gap: 3, dotSize: 1,
    color: "#ffffff", opacity: 0.8, outline: true,
    outlineThickness: 1, outlineColor: "#000000",
    moveSpread: 8, fireBloom: 6, adsSpread: 1,
    bloomDecay: 30, lerpSpeed: 10,
};
crosshair.configure(CROSSHAIR);

/** Show or hide the reticle (only while playing and connected). */
export function setCrosshair(on) {
    if (on) crosshair.show();
    else crosshair.hide();
}

/** Per-frame reticle spread: movement widens it, firing blooms it. */
export function reticle(moving, firing, dt) {
    crosshair.setMoving(moving);
    if (firing) crosshair.addBloom(dt * 40);
}

function healthColor(h) {
    return h > 60 ? "#2ecc71" : h > 30 ? "#f39c12" : "#e74c3c";
}

/**
 * Redraw the HUD from the session. view: { fps, pointerLocked }.
 */
export function drawHud(session, view) {
    const me = session.me;
    const fill = $("health-fill");
    fill.style.width = me.health + "%";
    fill.style.background = healthColor(me.health);
    $("health-text").textContent = String(me.health);
    $("kills-count").textContent = String(me.kills);
    $("death-screen").hidden = me.alive || !session.connected;
    $("click-prompt").hidden = view.pointerLocked || !session.connected;
    $("connecting").hidden = session.connected;
    $("net-info").textContent =
        "fps " + view.fps + " | tick " + session.clientTick + " | server " + session.serverTick;
}

/** Push a "X killed Y" line that fades after a few seconds. */
export function killFeed(killer, victim) {
    const entry = document.createElement("div");
    entry.className = "kill-entry";
    entry.textContent = killer + " killed " + victim;
    $("kill-feed").appendChild(entry);
    setTimeout(() => entry.remove(), FEED_MS);
}

/** Clear transient HUD state between connections. */
export function resetHud() {
    $("kill-feed").textContent = "";
    $("damage-flash").hidden = true;
}

let flashTimer = 0;
/** Red edge flash when the local player takes a hit. */
export function flashDamage() {
    const el = $("damage-flash");
    el.hidden = false;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; flashTimer = 0; }, FLASH_MS);
}
