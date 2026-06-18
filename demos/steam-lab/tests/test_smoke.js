// Headless acceptance test for bro.steam — the binding surface + inert paths,
// plus a live lobby roundtrip when Steam is actually available.
//
// Run (GPU) against the app dir from the bro repo root:
//   bro-headless ../broworkshop/demos/steam-lab tests/test_smoke.js
//
// With NO Steam (no redistributable / client): asserts bro.steam is present,
// every getter/method/callback exists with the right shape, and every call is a
// safe no-op (no throws, promises settle to empty). This is the "binding is
// always real and inert when Steam is absent" guarantee — runnable in CI.
//
// With Steam running (steam_api64.dll + steam_appid.txt=480 beside bro.exe,
// logged in): additionally asserts live identity, the RunCallbacks heartbeat,
// and a create → setData → read → leave lobby roundtrip.

// Real wall-clock pump + flush(). The Steam service runs on its own thread and
// emits the pulse heartbeat on a real-time cadence, so virtual-time sleep()
// would never see it; wallSleep gives the service real time and flush() drains
// its events (friends/lobby/avatar/voice/pulse) into the JS callbacks.
function pump(ms) { const s = Date.now(); do { flush(); wallSleep(15); } while (Date.now() - s < ms); flush(); }
function pumpUntil(pred, ms) { const s = Date.now(); while (!pred() && (Date.now() - s) < ms) { flush(); wallSleep(15); } flush(); return pred(); }

// ── 1. surface: namespace, getters, methods, callbacks ───────────────────────
assert(typeof bro === 'object' && bro, 'bro global present');
assert(typeof bro.steam === 'object' && bro.steam, 'bro.steam present (always installed)');

const methods = [
  'getFriends', 'getAvatar', 'setRichPresence', 'clearRichPresence',
  'activateOverlay', 'activateOverlayToUser', 'activateInviteDialog',
  'createLobby', 'joinLobby', 'leaveLobby', 'setLobbyData', 'setLobbyMemberData',
  'setLobbyJoinable', 'setLobbyType', 'setLobbyMemberLimit',
  'getLobbyMembers', 'getLobbyOwner', 'getLobbyData', 'requestLobbyList',
  'inviteUserToLobby', 'startVoiceRecording', 'stopVoiceRecording', 'decodeVoice',
];
methods.forEach((m) => assert(typeof bro.steam[m] === 'function', 'method bro.steam.' + m));

const callbacks = [
  'onpulse', 'onfriends', 'onoverlay', 'onjoinrequest', 'onlobbyentered',
  'onlobbyupdated', 'onlobbyleft', 'onlobbyinvite', 'onlobbyjoinrequest', 'onvoicecaptured',
];
callbacks.forEach((c) => { bro.steam[c] = () => {}; });   // must be assignable getters/setters

// ── 2. probe types (precision-safe ids are strings) ──────────────────────────
assert(typeof bro.steam.available === 'boolean', 'available is boolean');
assert(typeof bro.steam.reason === 'string' && bro.steam.reason.length, 'reason is a non-empty string');
assert(typeof bro.steam.steamId === 'string', 'steamId is a string (uint64 precision-safe)');
assert(typeof bro.steam.personaName === 'string', 'personaName is a string');
assert(typeof bro.steam.appId === 'number', 'appId is a number');
assert(typeof bro.steam.isVoiceRecording === 'boolean', 'isVoiceRecording is boolean');
assert(typeof bro.steam.voiceSampleRate === 'number', 'voiceSampleRate is a number');
assert(Array.isArray(bro.steam.getFriends()), 'getFriends() returns an array');

console.log('surface OK — available=' + bro.steam.available + ' reason="' + bro.steam.reason + '"');

// ── 3. inert paths: every no-op-safe call must not throw ─────────────────────
bro.steam.setRichPresence('status', 'smoke');
bro.steam.clearRichPresence();
bro.steam.activateOverlay('friends');
bro.steam.activateOverlayToUser('steamid', '0');
bro.steam.activateInviteDialog('0');
bro.steam.setLobbyData('0', 'k', 'v');
bro.steam.setLobbyMemberData('0', 'k', 'v');
bro.steam.setLobbyJoinable('0', true);
bro.steam.setLobbyType('0', 'public');
bro.steam.setLobbyMemberLimit('0', 8);
bro.steam.leaveLobby('0');
bro.steam.inviteUserToLobby('0', '0');
bro.steam.stopVoiceRecording();
assert(Array.isArray(bro.steam.getLobbyMembers('0')), 'getLobbyMembers("0") → []');
assert(typeof bro.steam.getLobbyOwner('0') === 'string', 'getLobbyOwner("0") → string');
assert(typeof bro.steam.getLobbyData('0', 'k') === 'string', 'getLobbyData("0") → string');

// ── 4. promise-returning calls settle (synchronously empty when unavailable) ──
let avatarOK = false, listOK = false, decodeOK = false;
bro.steam.getAvatar(bro.steam.steamId || '0', 'small').then(() => { avatarOK = true; });
bro.steam.requestLobbyList({ maxResults: 5 }).then((r) => { assert(Array.isArray(r), 'requestLobbyList → array'); listOK = true; });
bro.steam.decodeVoice(new Uint8Array(0)).then((res) => {
  assert(res && res.pcm instanceof Float32Array, 'decodeVoice → { pcm: Float32Array }');
  assert(typeof res.sampleRate === 'number', 'decodeVoice → { sampleRate: number }');
  decodeOK = true;
});
assert(pumpUntil(() => avatarOK && listOK && decodeOK, 5000), 'async calls settled');
console.log('inert paths OK');

// ── 4b. avatar render path — the ImageData global + canvas roundtrip the lab
//        uses to paint getAvatar() pixels. Steam-independent (runs in CI). ──────
const _id = new ImageData(2, 3);
assert(_id.width === 2 && _id.height === 3 && _id.data.length === 24, 'new ImageData(w,h) shape');
const _px = new Uint8ClampedArray(2 * 1 * 4);
_px[0] = 200; _px[3] = 255;                          // opaque red-ish pixel
const _wrap = new ImageData(_px, 2);
assert(_wrap.width === 2 && _wrap.height === 1, 'new ImageData(data,w) infers height');
const _cv = document.createElement('canvas');
_cv.width = 2; _cv.height = 1;
const _cx = _cv.getContext('2d');
_cx.putImageData(new ImageData(_px, 2, 1), 0, 0);
assert(_cx.getImageData(0, 0, 2, 1).data[0] === 200, 'canvas putImageData/getImageData roundtrip');
console.log('avatar render path OK');

// ── 5. live checks (only when Steam is actually up) ──────────────────────────
if (bro.steam.available) {
  assert(bro.steam.steamId !== '0' && bro.steam.steamId.length >= 17, 'live steamId: ' + bro.steam.steamId);
  assert(bro.steam.personaName.length > 0, 'live personaName: ' + bro.steam.personaName);
  assert(bro.steam.appId > 0, 'live appId: ' + bro.steam.appId);

  // RunCallbacks heartbeat — proves the service pump thread is alive. The pulse
  // is ~1 Hz (service loop is 10ms/iter, emits every 100th), so allow >1s.
  let pulses = 0;
  bro.steam.onpulse = () => { pulses++; };
  assert(pumpUntil(() => pulses > 0, 3000), 'pump heartbeat alive (' + pulses + ' pulses)');

  // create → setData → read-back-through-cache → leave
  let lobbyId = null;
  bro.steam.createLobby('private', 4).then((id) => { lobbyId = id; });
  assert(pumpUntil(() => lobbyId !== null, 8000), 'createLobby settled');
  assert(typeof lobbyId === 'string' && lobbyId !== '0', 'created lobby id: ' + lobbyId);

  bro.steam.setLobbyData(lobbyId, 'probe', 'v42');
  let val = '';
  assert(pumpUntil(() => { val = bro.steam.getLobbyData(lobbyId, 'probe'); return val === 'v42'; }, 4000),
         'lobby data roundtrip through cache: ' + val);

  const owner = bro.steam.getLobbyOwner(lobbyId);
  assert(owner === bro.steam.steamId, 'I own the lobby I created (' + owner + ')');

  bro.steam.leaveLobby(lobbyId);

  // A real friend avatar, painted onto a canvas via ImageData — the lab's path.
  pumpUntil(() => bro.steam.getFriends().length > 0, 4000);
  const friends = bro.steam.getFriends();
  if (friends.length) {
    let painted = false;
    bro.steam.getAvatar(friends[0].steamId, 'small').then((av) => {
      if (!av) { painted = true; return; } // friend genuinely has no avatar — still a settled answer
      const c = document.createElement('canvas');
      c.width = av.width; c.height = av.height;
      c.getContext('2d').putImageData(new ImageData(av.data, av.width, av.height), 0, 0);
      painted = true;
    });
    assert(pumpUntil(() => painted, 6000), 'friend avatar resolved + painted (' + friends[0].name + ')');
  }

  console.log('LIVE OK — ' + bro.steam.personaName + ' appId=' + bro.steam.appId +
              ' friends=' + friends.length + ' lobby=' + lobbyId);
} else {
  console.log('Steam unavailable — surface + inert-path checks only (this is expected in CI)');
}

console.log('STEAM-LAB SMOKE OK');
