// Steam Lab — a worked consumer of bro.steam, the Steamworks binding.
//
// bro.steam talks to the Steam redistributable (steam_api64.dll /
// libsteam_api.{so,dylib}) through its stable flat C API, resolved at runtime —
// there is NO Steamworks SDK in the bro build. The binding is therefore always
// present and probes at startup: with the redistributable next to the executable
// and the Steam client running, bro.steam.available is true; otherwise it is
// false and bro.steam.reason says why. Every method below is a safe no-op when
// unavailable, so this lab loads and stays interactive with or without Steam.
//
// Threading: SteamService owns the Steamworks API on its own thread and marshals
// to JS lock-free (mirrors bro.net's NetService). The engine drains queued events
// into these callbacks once per frame — onpulse is the heartbeat proving that
// pump is alive.
//
// What's solo-testable here (one machine, your own account):
//   identity · friends list + avatars · rich presence · overlay activation ·
//   create/join your own lobby · lobby data · voice capture + decode loopback.
// What needs a second client (2nd account + machine + mic):
//   invite *delivery* (onlobbyjoinrequest on the invitee) and positioned voice.
//
// Dev setup: drop steam_api64.dll beside bro.exe and a steam_appid.txt
// containing 480 (Spacewar) next to it, with Steam running and logged in.
// See README.md.

const $ = (s) => document.querySelector(s);

// ── identity / availability strip ────────────────────────────────────────────
const $availPill = $('#availPill'), $availText = $('#availText');
const $reason = $('#reason'), $steamId = $('#steamId'), $persona = $('#persona'), $appId = $('#appId');
const $heart = $('#heart'), $pulse = $('#pulse'), $overlay = $('#overlay');

// ── event log ────────────────────────────────────────────────────────────────
const $log = $('#log');
function log(kind, msg, level) {
  const e = document.createElement('div');
  e.className = 'e' + (level ? ' ' + level : '');
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  e.innerHTML = '<span class="t">' + hh + ':' + mm + ':' + ss + '</span>' +
                '<span class="k"></span> <span class="m"></span>';
  e.querySelector('.k').textContent = kind;
  e.querySelector('.m').textContent = msg;
  $log.insertBefore(e, $log.firstChild);
  while ($log.childElementCount > 250) $log.removeChild($log.lastChild);
}

// ── shared state ─────────────────────────────────────────────────────────────
let myLobby = null;        // current lobby id (string) or null
let recording = false;

// ─────────────────────────────────────────────────────────────────────────────
// Identity + heartbeat
// ─────────────────────────────────────────────────────────────────────────────
function refreshIdentity() {
  const up = bro.steam.available;
  $availPill.className = 'pill ' + (up ? 'up' : 'down');
  $availText.textContent = up ? 'available' : 'unavailable';
  $reason.textContent = bro.steam.reason;
  $steamId.textContent = bro.steam.steamId;
  $persona.textContent = bro.steam.personaName || '—';
  $appId.textContent = String(bro.steam.appId);
  $voiceRate.textContent = String(bro.steam.voiceSampleRate || '—');
}

let pulseCount = 0;
bro.steam.onpulse = (tick) => {
  pulseCount++;
  $pulse.textContent = String(tick);
  // blink the heartbeat dot
  $heart.classList.add('beat');
  setTimeout(() => $heart.classList.remove('beat'), 80);
  // identity fields publish just before available flips true — re-read until set
  if (pulseCount < 30 && bro.steam.available && $steamId.textContent === '0') refreshIdentity();
};

// ─────────────────────────────────────────────────────────────────────────────
// Presence & overlay (M1/M2)
// ─────────────────────────────────────────────────────────────────────────────
$('#rpSet').addEventListener('click', () => {
  const k = $('#rpKey').value.trim(), v = $('#rpVal').value.trim();
  if (!k) return;
  bro.steam.setRichPresence(k, v);
  log('presence', 'set ' + k + '="' + v + '"');
});
$('#rpClear').addEventListener('click', () => {
  bro.steam.clearRichPresence();
  log('presence', 'cleared');
});
document.querySelectorAll('[data-ov]').forEach((b) => {
  b.addEventListener('click', () => {
    bro.steam.activateOverlay(b.dataset.ov);
    log('overlay', 'activateOverlay("' + b.dataset.ov + '")');
  });
});

bro.steam.onoverlay = (active) => {
  $overlay.textContent = active ? 'open' : 'closed';
  $overlay.style.color = active ? '#8be0ae' : '#d7dde6';
  log('overlay', active ? 'opened' : 'closed');
};

// A friend invited us via the overlay/rich-presence "Join Game" — connect string
// is the game's to interpret. For lobby invites we get onlobbyjoinrequest below.
bro.steam.onjoinrequest = (friendId, connect) => {
  log('join', 'friend ' + friendId + ' → "' + connect + '"', 'warn');
};

// ─────────────────────────────────────────────────────────────────────────────
// Friends (M2)
// ─────────────────────────────────────────────────────────────────────────────
const $friends = $('#friends'), $friendsCount = $('#friendsCount');

function paintAvatar(canvas, steamId) {
  // getAvatar resolves null until Steam has the image cached; re-request lazily.
  bro.steam.getAvatar(steamId, 'small').then((av) => {
    if (!av) return;
    canvas.width = av.width; canvas.height = av.height;
    const cx = canvas.getContext('2d');
    cx.putImageData(new ImageData(av.data, av.width, av.height), 0, 0);
  });
}

function renderFriends() {
  const list = bro.steam.getFriends();
  $friendsCount.textContent = list.length + ' friends';
  $friends.innerHTML = '';
  if (!list.length) { $friends.innerHTML = '<span class="empty">no friends loaded</span>'; return; }
  // online first, then by name
  list.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  for (const f of list) {
    const row = document.createElement('div');
    row.className = 'friend';
    const cv = document.createElement('canvas'); cv.width = 28; cv.height = 28;
    const dot = document.createElement('span');
    dot.className = 'sdot' + (f.state === 'online' ? ' online' : f.state === 'busy' ? ' busy'
                    : f.state === 'away' || f.state === 'snooze' ? ' away'
                    : f.state === 'looking-to-play' ? ' play' : '');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.name;
    const st = document.createElement('span'); st.className = 'hint'; st.textContent = f.state;
    row.appendChild(cv); row.appendChild(dot); row.appendChild(nm); row.appendChild(st);
    row.title = 'steamId ' + f.steamId + ' — open profile overlay';
    row.addEventListener('click', () => {
      bro.steam.activateOverlayToUser('steamid', f.steamId);
      // if we're hosting a lobby, also offer a direct invite
      if (myLobby) { bro.steam.inviteUserToLobby(myLobby, f.steamId); log('lobby', 'invited ' + f.name); }
    });
    $friends.appendChild(row);
    paintAvatar(cv, f.steamId);
  }
}

$('#friendsRefresh').addEventListener('click', renderFriends);
// Steam pushes a fresh snapshot whenever a friend's state changes.
bro.steam.onfriends = () => { renderFriends(); log('friends', bro.steam.getFriends().length + ' updated'); };

// ─────────────────────────────────────────────────────────────────────────────
// Lobby (M3)
// ─────────────────────────────────────────────────────────────────────────────
const $lobbyId = $('#lobbyId'), $lobbyOwner = $('#lobbyOwner'), $members = $('#members');
const $lobbyLeave = $('#lobbyLeave'), $ldSet = $('#ldSet'), $lobbyInvite = $('#lobbyInvite');

function setLobbyControls(active) {
  $lobbyLeave.disabled = !active;
  $ldSet.disabled = !active;
  $lobbyInvite.disabled = !active;
}

function renderMembers() {
  if (!myLobby) { $members.innerHTML = '<span class="empty">not in a lobby</span>'; return; }
  const members = bro.steam.getLobbyMembers(myLobby);
  const owner = bro.steam.getLobbyOwner(myLobby);
  $lobbyOwner.textContent = owner;
  if (!members.length) { $members.innerHTML = '<span class="empty">(members loading…)</span>'; return; }
  $members.innerHTML = '';
  for (const m of members) {
    const row = document.createElement('div');
    row.className = 'member';
    const nm = document.createElement('span'); nm.textContent = m.name || m.steamId;
    row.appendChild(nm);
    if (m.steamId === owner) { const o = document.createElement('span'); o.className = 'own'; o.textContent = 'OWNER'; row.appendChild(o); }
    $members.appendChild(row);
  }
}

function enterLobby(id) {
  myLobby = id;
  $lobbyId.textContent = id;
  setLobbyControls(true);
  renderMembers();
}

$('#lobbyCreate').addEventListener('click', async () => {
  const type = $('#lobbyType').value;
  const max = Math.max(2, +$('#lobbyMax').value || 8);
  log('lobby', 'createLobby(' + type + ', ' + max + ')…');
  const id = await bro.steam.createLobby(type, max);
  if (!id) { log('lobby', 'create failed', 'err'); return; }
  enterLobby(id);
  // Make it discoverable + set a couple of demo fields.
  bro.steam.setLobbyJoinable(id, true);
  bro.steam.setLobbyData(id, 'game', 'steam-lab');
  bro.steam.setLobbyData(id, 'host', bro.steam.personaName || 'host');
  log('lobby', 'created ' + id);
});

$('#lobbyLeave').addEventListener('click', () => {
  if (!myLobby) return;
  bro.steam.leaveLobby(myLobby);
  log('lobby', 'left ' + myLobby);
  myLobby = null; $lobbyId.textContent = '—'; $lobbyOwner.textContent = '—';
  setLobbyControls(false); renderMembers();
});

$('#ldSet').addEventListener('click', () => {
  if (!myLobby) return;
  const k = $('#ldKey').value.trim(), v = $('#ldVal').value.trim();
  if (!k) return;
  bro.steam.setLobbyData(myLobby, k, v);
  log('lobby', 'data ' + k + '="' + v + '"');
});

$('#lobbyInvite').addEventListener('click', () => {
  if (!myLobby) return;
  bro.steam.activateInviteDialog(myLobby);  // opens the overlay invite-to-lobby panel
  log('lobby', 'opened invite overlay for ' + myLobby);
});

$('#joinBtn').addEventListener('click', async () => {
  const id = $('#joinId').value.trim();
  if (!id) return;
  log('lobby', 'joinLobby(' + id + ')…');
  const res = await bro.steam.joinLobby(id);
  if (res.success) { enterLobby(res.lobbyId); log('lobby', 'joined ' + res.lobbyId); }
  else log('lobby', 'join failed (response ' + res.response + ')', 'err');
});

$('#lobbyList').addEventListener('click', async () => {
  log('lobby', 'requestLobbyList…');
  const results = await bro.steam.requestLobbyList({ stringFilters: { game: 'steam-lab' }, maxResults: 20 });
  const box = $('#lobbyResults');
  if (!results.length) { box.innerHTML = '<span class="empty">no matching lobbies</span>'; log('lobby', '0 lobbies'); return; }
  box.innerHTML = '';
  for (const lo of results) {
    const row = document.createElement('div');
    row.className = 'member';
    const a = document.createElement('a'); a.href = '#'; a.className = 'mono';
    a.textContent = lo.lobbyId + '  (' + lo.memberCount + '/' + lo.memberLimit + ')';
    a.addEventListener('click', (ev) => { ev.preventDefault(); $('#joinId').value = lo.lobbyId; });
    row.appendChild(a);
    box.appendChild(row);
  }
  log('lobby', results.length + ' lobbies');
});

// Lobby event callbacks.
bro.steam.onlobbyentered = (id, ok) => { if (ok) enterLobby(id); log('lobby', 'entered ' + id + (ok ? '' : ' (failed)'), ok ? null : 'err'); };
bro.steam.onlobbyupdated = (id) => { if (id === myLobby) renderMembers(); log('lobby', 'updated ' + id); };
bro.steam.onlobbyleft = (id) => { if (id === myLobby) { myLobby = null; $lobbyId.textContent = '—'; setLobbyControls(false); renderMembers(); } log('lobby', 'left ' + id); };
bro.steam.onlobbyinvite = (friendId, lobbyId) => log('invite', 'friend ' + friendId + ' → lobby ' + lobbyId, 'warn');
// Invitee side of the golden path: accepting an overlay invite hands us the
// lobby id directly — auto-join it.
bro.steam.onlobbyjoinrequest = async (lobbyId) => {
  log('invite', 'accepted → joining ' + lobbyId, 'warn');
  const res = await bro.steam.joinLobby(lobbyId);
  if (res.success) enterLobby(res.lobbyId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Voice (M4) — capture + local decode loopback
// ─────────────────────────────────────────────────────────────────────────────
const $voiceToggle = $('#voiceToggle'), $voiceRate = $('#voiceRate');
const $voiceFrames = $('#voiceFrames'), $voiceBytes = $('#voiceBytes');
const $voiceDecRate = $('#voiceDecRate'), $voiceMeter = $('#voiceMeter');
let frameCount = 0, byteCount = 0;

$voiceToggle.addEventListener('click', () => {
  if (!recording) {
    bro.steam.startVoiceRecording();
    recording = bro.steam.isVoiceRecording;
    $voiceToggle.textContent = 'stop recording';
    $voiceToggle.classList.add('active');
    $voiceRate.textContent = String(bro.steam.voiceSampleRate || '—');
    log('voice', 'recording started @ ' + bro.steam.voiceSampleRate + ' Hz');
  } else {
    bro.steam.stopVoiceRecording();
    recording = false;
    $voiceToggle.textContent = 'start recording';
    $voiceToggle.classList.remove('active');
    $voiceMeter.style.width = '0%';
    log('voice', 'recording stopped');
  }
});

bro.steam.onvoicecaptured = (compressed) => {
  frameCount++; byteCount += compressed.length;
  $voiceFrames.textContent = String(frameCount);
  $voiceBytes.textContent = String(byteCount);
  // Loopback: decode our own compressed frame locally to prove the codec
  // roundtrip without a second client. (A real game forwards `compressed` to
  // peers and decodes *their* frames here.)
  bro.steam.decodeVoice(compressed).then(({ pcm, sampleRate }) => {
    if (sampleRate) $voiceDecRate.textContent = sampleRate + ' Hz';
    if (!pcm || !pcm.length) return;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / pcm.length);
    $voiceMeter.style.width = Math.min(100, rms * 320).toFixed(0) + '%';
  });
};

// ── boot ─────────────────────────────────────────────────────────────────────
(function boot() {
  refreshIdentity();
  if (bro.steam.available) {
    log('steam', 'available — ' + bro.steam.personaName + ' (' + bro.steam.steamId + ')');
    renderFriends();
  } else {
    log('steam', 'unavailable — ' + bro.steam.reason, 'warn');
    log('steam', 'drop steam_api64.dll + steam_appid.txt (480) beside bro.exe, run Steam, relaunch', 'warn');
  }
})();
