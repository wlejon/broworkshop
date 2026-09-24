// Steam Lab — a worked consumer of bro.steam, the Steamworks binding.
//
// bro.steam talks to the Steam redistributable (steam_api64.dll /
// libsteam_api.{so,dylib}) through its stable flat C API, resolved at runtime;
// there is NO Steamworks SDK in the bro build. The binding is always present
// and probes at startup: with the redistributable next to the executable and
// the Steam client running, bro.steam.available is true; otherwise it is false
// and bro.steam.reason says why. Every method is a safe no-op when
// unavailable, so this lab loads and stays interactive with or without Steam.
//
// Threading: SteamService owns the Steamworks API on its own thread and
// marshals to JS lock-free (like bro.net's NetService). The engine drains
// queued events into these callbacks once per frame; onpulse is the heartbeat
// proving that pump is alive.
//
// Solo-testable (one machine, your own account): identity, friends + avatars,
// rich presence, overlay, create/join your own lobby, lobby data, voice
// capture + decode loopback. Needs a second client: invite *delivery*
// (onlobbyjoinrequest on the invitee) and positioned voice. See README.md.
import { boot } from "/lib/kit/app.js";
import { h, clear, ids } from "/lib/kit/dom.js";
import { logView, toggleButton, progressBar } from "/lib/kit/ui.js";

const steam = bro.steam;
const app = boot();
const el = ids(
    'availPill', 'availText', 'reason', 'steamId', 'persona', 'appId', 'heart', 'pulse', 'overlay',
    'rpKey', 'rpVal', 'rpSet', 'rpClear',
    'friends', 'friendsCount', 'friendsRefresh',
    'lobbyType', 'lobbyMax', 'lobbyCreate', 'lobbyLeave', 'lobbyId', 'lobbyOwner',
    'ldKey', 'ldVal', 'ldSet', 'lobbyInvite', 'lobbyList', 'joinId', 'joinBtn', 'members', 'lobbyResults',
    'voiceToggle', 'voiceRate', 'voiceFrames', 'voiceBytes', 'voiceDecRate', 'voiceMeter',
    'log');

// --- event log ---------------------------------------------------------------
const events = logView(el.log, { max: 250, newestFirst: true });
/** One event row: a kind tag and the message; level 'warn' | 'err' colours both. */
function log(kind, msg, level) {
    events.add(h('span', null, h('span.k', null, kind), msg), level);
}

const hint = (text) => h('span.hint', null, text);

// --- identity + heartbeat ------------------------------------------------------
function refreshIdentity() {
    const up = steam.available;
    el.availPill.className = 'pill ' + (up ? 'up' : 'down');
    el.availText.textContent = up ? 'available' : 'unavailable';
    el.reason.textContent = steam.reason;
    el.steamId.textContent = steam.steamId;
    el.persona.textContent = steam.personaName || '—';
    el.appId.textContent = String(steam.appId);
    el.voiceRate.textContent = String(steam.voiceSampleRate || '—');
}

let pulseCount = 0;
steam.onpulse = (tick) => {
    pulseCount++;
    el.pulse.textContent = String(tick);
    el.heart.classList.add('beat');
    setTimeout(() => el.heart.classList.remove('beat'), 80);
    // Identity fields publish just before available flips true: re-read until set.
    if (pulseCount < 30 && steam.available && el.steamId.textContent === '0') refreshIdentity();
};

// --- presence + overlay ----------------------------------------------------------
el.rpSet.addEventListener('click', () => {
    const k = el.rpKey.value.trim(), v = el.rpVal.value.trim();
    if (!k) return;
    steam.setRichPresence(k, v);
    log('presence', 'set ' + k + '="' + v + '"');
});
el.rpClear.addEventListener('click', () => {
    steam.clearRichPresence();
    log('presence', 'cleared');
});
for (const b of document.querySelectorAll('[data-ov]')) {
    b.addEventListener('click', () => {
        steam.activateOverlay(b.dataset.ov);
        log('overlay', 'activateOverlay("' + b.dataset.ov + '")');
    });
}
steam.onoverlay = (active) => {
    el.overlay.textContent = active ? 'open' : 'closed';
    el.overlay.classList.toggle('open', !!active);
    log('overlay', active ? 'opened' : 'closed');
};
// A friend used "Join Game" from the overlay / rich presence; the connect
// string is the game's to interpret. Lobby invites arrive as onlobbyjoinrequest.
steam.onjoinrequest = (friendId, connect) => {
    log('join', 'friend ' + friendId + ' → "' + connect + '"', 'warn');
};

// --- friends ---------------------------------------------------------------------
function paintAvatar(canvas, steamId) {
    // getAvatar resolves null until Steam has the image cached.
    steam.getAvatar(steamId, 'small').then((av) => {
        if (!av) return;
        canvas.width = av.width; canvas.height = av.height;
        canvas.getContext('2d').putImageData(new ImageData(av.data, av.width, av.height), 0, 0);
    });
}

const STATE_DOT = { online: 'online', busy: 'busy', away: 'away', snooze: 'away', 'looking-to-play': 'play' };

function renderFriends() {
    const list = steam.getFriends();
    el.friendsCount.textContent = list.length + ' friends';
    clear(el.friends);
    if (!list.length) { el.friends.appendChild(hint('no friends loaded')); return; }
    list.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));   // online first
    for (const f of list) {
        const cv = h('canvas', { width: 28, height: 28 });
        el.friends.appendChild(h('div.friend', {
            title: 'steamId ' + f.steamId + ' — open profile overlay',
            onclick: () => {
                steam.activateOverlayToUser('steamid', f.steamId);
                // In a lobby: also send a direct invite.
                if (lobby) { steam.inviteUserToLobby(lobby, f.steamId); log('lobby', 'invited ' + f.name); }
            },
        }, cv, h('span.sdot', { class: STATE_DOT[f.state] }), h('span.nm', null, f.name), hint(f.state)));
        paintAvatar(cv, f.steamId);
    }
}
el.friendsRefresh.addEventListener('click', renderFriends);
// Steam pushes a fresh snapshot whenever a friend's state changes.
steam.onfriends = () => { renderFriends(); log('friends', steam.getFriends().length + ' updated'); };

// --- lobby -----------------------------------------------------------------------
let lobby = null;   // current lobby id (string) or null

function renderLobby() {
    for (const b of [el.lobbyLeave, el.ldSet, el.lobbyInvite]) b.disabled = !lobby;
    el.lobbyId.textContent = lobby || '—';
    clear(el.members);
    if (!lobby) { el.lobbyOwner.textContent = '—'; el.members.appendChild(hint('not in a lobby')); return; }
    const owner = steam.getLobbyOwner(lobby);
    el.lobbyOwner.textContent = owner;
    const members = steam.getLobbyMembers(lobby);
    if (!members.length) { el.members.appendChild(hint('(members loading…)')); return; }
    for (const m of members) {
        el.members.appendChild(h('div.member', null, h('span', null, m.name || m.steamId),
            m.steamId === owner ? h('span.own', null, 'OWNER') : null));
    }
}
function enterLobby(id) { lobby = id; renderLobby(); }
function leftLobby() { lobby = null; renderLobby(); }

el.lobbyCreate.addEventListener('click', async () => {
    const type = el.lobbyType.value;
    const max = Math.max(2, +el.lobbyMax.value || 8);
    log('lobby', 'createLobby(' + type + ', ' + max + ')…');
    const id = await steam.createLobby(type, max);
    if (!id) { log('lobby', 'create failed', 'err'); return; }
    enterLobby(id);
    // Discoverable, plus a couple of demo fields requestLobbyList filters on.
    steam.setLobbyJoinable(id, true);
    steam.setLobbyData(id, 'game', 'steam-lab');
    steam.setLobbyData(id, 'host', steam.personaName || 'host');
    log('lobby', 'created ' + id);
});
el.lobbyLeave.addEventListener('click', () => {
    if (!lobby) return;
    steam.leaveLobby(lobby);
    log('lobby', 'left ' + lobby);
    leftLobby();
});
el.ldSet.addEventListener('click', () => {
    const k = el.ldKey.value.trim(), v = el.ldVal.value.trim();
    if (!lobby || !k) return;
    steam.setLobbyData(lobby, k, v);
    log('lobby', 'data ' + k + '="' + v + '"');
});
el.lobbyInvite.addEventListener('click', () => {
    if (!lobby) return;
    steam.activateInviteDialog(lobby);   // the overlay's invite-to-lobby panel
    log('lobby', 'opened invite overlay for ' + lobby);
});

async function join(id) {
    const res = await steam.joinLobby(id);
    if (res.success) enterLobby(res.lobbyId);
    return res;
}
el.joinBtn.addEventListener('click', async () => {
    const id = el.joinId.value.trim();
    if (!id) return;
    log('lobby', 'joinLobby(' + id + ')…');
    const res = await join(id);
    if (res.success) log('lobby', 'joined ' + res.lobbyId);
    else log('lobby', 'join failed (response ' + res.response + ')', 'err');
});

el.lobbyList.addEventListener('click', async () => {
    log('lobby', 'requestLobbyList…');
    const results = await steam.requestLobbyList({ stringFilters: { game: 'steam-lab' }, maxResults: 20 });
    clear(el.lobbyResults);
    if (!results.length) el.lobbyResults.appendChild(hint('no matching lobbies'));
    for (const lo of results) {
        el.lobbyResults.appendChild(h('div.member', null, h('a.mono', {
            href: '#', onclick: (ev) => { ev.preventDefault(); el.joinId.value = lo.lobbyId; },
        }, lo.lobbyId + '  (' + lo.memberCount + '/' + lo.memberLimit + ')')));
    }
    log('lobby', results.length + ' lobbies');
});

steam.onlobbyentered = (id, ok) => {
    if (ok) enterLobby(id);
    log('lobby', 'entered ' + id + (ok ? '' : ' (failed)'), ok ? null : 'err');
};
steam.onlobbyupdated = (id) => { if (id === lobby) renderLobby(); log('lobby', 'updated ' + id); };
steam.onlobbyleft = (id) => { if (id === lobby) leftLobby(); log('lobby', 'left ' + id); };
steam.onlobbyinvite = (friendId, lobbyId) => log('invite', 'friend ' + friendId + ' → lobby ' + lobbyId, 'warn');
// Invitee side: accepting an overlay invite hands us the lobby id; join it.
steam.onlobbyjoinrequest = (lobbyId) => {
    log('invite', 'accepted → joining ' + lobbyId, 'warn');
    join(lobbyId);
};

// --- voice: capture + local decode loopback -------------------------------------
const meter = progressBar(el.voiceMeter);
let frameCount = 0, byteCount = 0;

const voice = toggleButton(el.voiceToggle, {
    labels: ['start recording', 'stop recording'],
    onChange(on) {
        if (on) {
            steam.startVoiceRecording();
            // Unavailable Steam (or no mic) leaves it off; say so rather than
            // showing a recording that is not happening.
            voice.on = steam.isVoiceRecording;
            el.voiceRate.textContent = String(steam.voiceSampleRate || '—');
            if (voice.on) log('voice', 'recording started @ ' + steam.voiceSampleRate + ' Hz');
            else log('voice', 'recording did not start (' + (steam.available ? 'no capture device?' : steam.reason) + ')', 'warn');
        } else {
            steam.stopVoiceRecording();
            meter.set(0);
            log('voice', 'recording stopped');
        }
    },
});

steam.onvoicecaptured = (compressed) => {
    frameCount++; byteCount += compressed.length;
    el.voiceFrames.textContent = String(frameCount);
    el.voiceBytes.textContent = String(byteCount);
    // Loopback: decode our own frame locally to prove the codec roundtrip
    // without a second client. (A game forwards `compressed` to peers and
    // decodes *their* frames here.)
    steam.decodeVoice(compressed).then(({ pcm, sampleRate }) => {
        if (sampleRate) el.voiceDecRate.textContent = sampleRate + ' Hz';
        if (!pcm || !pcm.length) return;
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
        meter.set(Math.sqrt(sum / pcm.length) * 3.2);
    });
};

// --- start -------------------------------------------------------------------------
refreshIdentity();
renderLobby();
if (steam.available) {
    log('steam', 'available — ' + steam.personaName + ' (' + steam.steamId + ')');
    app.status.ok('signed in as ' + steam.personaName);
    renderFriends();
} else {
    app.status.warn('Steam unavailable: every call is a safe no-op (setup in README.md)');
    log('steam', 'unavailable — ' + steam.reason, 'warn');
    log('steam', 'drop steam_api64.dll + steam_appid.txt (480) beside bro.exe, run Steam, relaunch', 'warn');
}
