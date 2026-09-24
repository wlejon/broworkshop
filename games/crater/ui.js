// ui.js — Crater's DOM: the lobby roster, the match HUD's player list, and
// the toast. Structure lives in index.html; rows are built with h().

import { h } from "/lib/kit/dom.js";
import { C } from "/app/shared.js";

const $ = (id) => document.getElementById(id);
let toastTimer = 0;

export function hpColor(hp) {
    return hp > 50 ? "#3ecf4a" : hp > 20 ? "#f5b940" : "#e55";
}

/** Lobby roster + which host-only menu items are live. */
export function renderLobby(lobby, myId) {
    const list = $("lobby-players");
    list.textContent = "";
    for (const p of lobby.entries) {
        list.appendChild(h("div.lobby-row", null,
            h("span.lobby-swatch", { style: { background: p.color } }),
            h("span", null, p.name + (p.id === myId ? " (you)" : "")),
            p.bot ? h("span.lobby-tag", null, "(bot)") : null,
            p.id === lobby.hostId ? h("span.lobby-tag", null, "(host)") : null,
            h("span.lobby-ready" + (p.ready ? "" : ".not-ready"), null, p.ready ? "READY" : "not ready"),
        ));
    }
    const isHost = lobby.hostId === myId;
    const humansReady = lobby.entries.every((p) => p.bot || p.ready);
    const item = (a) => document.querySelector('#screen-lobby [data-action="' + a + '"]');
    item("start").classList.toggle("disabled", !(isHost && lobby.entries.length >= 2 && humansReady));
    item("bot").classList.toggle("disabled", !isHost);
    const me = lobby.entries.find((p) => p.id === myId);
    item("ready").textContent = me && me.ready ? "Not Ready" : "Ready";
}

/** The HUD's player list: name, HP bar, turn and death marks. */
export function renderPlayers(players, turn, myId) {
    const el = $("hud-players");
    el.textContent = "";
    for (const p of players) {
        const cls = "div.hud-player" + (p.id === turn ? ".active" : "") + (p.alive ? "" : ".dead");
        el.appendChild(h(cls, null,
            h("span", { style: { color: p.color } }, (p.id === myId ? "★ " : "") + p.name),
            h("span.hp-bar", null, h("span.hp-fill", {
                style: { width: Math.max(0, p.hp / C.HP_MAX * 100) + "%", background: hpColor(p.hp) },
            })),
        ));
    }
}

/** A short notice above the HUD hint ("Turn skipped"). */
export function toast(msg) {
    const el = $("crater-toast");
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; toastTimer = 0; }, 1800);
}
