// Net Sync Arena — a two-instance multiplayer demo of bro.net.sync.
// Run two copies: Host in one, Join 127.0.0.1 in the other. The session
// logic is session.js; this file is the lobby and the HUD.
import { boot } from "/lib/kit/app.js";
import { h, clear, ids } from "/lib/kit/dom.js";
import { buildArena } from "/app/arena.js";
import { session } from "/app/session.js";
import { colorOf } from "/app/net-types.js";

// Lobby errors (and uncaught ones) show under the Host / Join buttons.
const app = boot({ status: '#lobbyStatus' });
const el = ids('lobby','hud', 'status', 'scores', 'controls', 'hostBtn', 'joinBtn', 'address');

const vp = buildArena(document.getElementById('stage'));
session.init(vp.scene);

function start(fn) {
    try {
        fn();
    } catch (e) {
        app.status.error(e);
        return;
    }
    el.lobby.hidden = true;
    el.hud.hidden = false;
    el.controls.hidden = false;
}
el.hostBtn.addEventListener('click', () => start(session.host));
el.joinBtn.addEventListener('click', () => start(() => session.join(el.address.value)));
el.address.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.joinBtn.click(); });

// Rebuilt only when something shown changed.
let lastHud = '';
function updateHud() {
    const players = session.players();
    const line = session.describe();
    const key = line + '|' + players.map((p) => p.slot + ':' + p.score + (p === session.me ? '*' : '')).join(',');
    if (key === lastHud) return;
    lastHud = key;
    el.status.textContent = line;
    clear(el.scores);
    for (const p of players) {
        el.scores.appendChild(h('div', { class: 'row' },
            h('span', { class: 'dot', style: { background: colorOf(p.slot) } }),
            h('span', null, 'P' + (p.slot + 1) + (p === session.me ? ' (you)' : '')),
            h('span', { class: 'pts' }, String(p.score))));
    }
}

vp.onFrame((dt) => {
    session.tick(dt);
    if (session.active) updateHud();
});
