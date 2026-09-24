// Steam Lab UI — the identity strip, the event log, presence, the lobby and
// voice controls. Without Steam (CI) every call is inert, so this checks the
// lab reports that honestly; with Steam up it checks the live identity and a
// create -> leave lobby roundtrip through the buttons.
//
//   scripts/validate.sh demos/steam-lab
import { check, eq, test, done, frames, pumpUntil, q, text, setValue, clickOn, shot } from "/lib/kit/test.js";

const up = bro.steam.available;
const rows = () => [...q('#log').children].map((r) => r.textContent);
const newest = () => q('#log').firstElementChild.textContent;

frames(5);

test('identity strip mirrors bro.steam', () => {
    eq(text('#availText'), up ? 'available' : 'unavailable');
    check(q('#availPill').classList.contains(up ? 'up' : 'down'), 'pill state');
    eq(text('#reason'), bro.steam.reason);
    eq(text('#appId'), String(bro.steam.appId));
    if (up) check(text('#steamId').length >= 17, 'live steamId');
    shot('boot');
});

test('boot explains itself in the log, newest first', () => {
    if (up) {
        check(/steam\s*available — /.test(rows()[rows().length - 1]), 'available row: ' + rows()[rows().length - 1]);
    } else {
        // (The service may push an empty friends snapshot on top of these.)
        const r = rows(), n = r.length;
        check(/steam\s*unavailable — /.test(r[n - 1]) && q('#log').lastElementChild.classList.contains('warn'), 'reason row, warn: ' + r[n - 1]);
        check(/steam\s*drop steam_api64\.dll/.test(r[n - 2]), 'setup hint above it: ' + r[n - 2]);
    }
});

test('rich presence set and clear are logged', () => {
    setValue('#rpKey', 'status');
    setValue('#rpVal', 'In the lab');
    clickOn('#rpSet');
    check(/presence\s*set status="In the lab"/.test(newest()), newest());
    clickOn('#rpClear');
    check(/presence\s*cleared/.test(newest()), newest());
    const n = rows().length;
    setValue('#rpKey', '  ');
    clickOn('#rpSet');
    eq(rows().length, n, 'an empty key does nothing');
});

test('overlay buttons log the call', () => {
    clickOn('[data-ov="community"]');
    check(/activateOverlay\("community"\)/.test(newest()), newest());
});

test('lobby controls start disabled; leave/data/invite need a lobby', () => {
    for (const id of ['#lobbyLeave', '#ldSet', '#lobbyInvite']) check(q(id).disabled, id + ' disabled');
    eq(text('#lobbyId'), '—');
    check(/not in a lobby/.test(text('#members')), 'members placeholder');
});

test('createLobby: fails cleanly without Steam, round-trips with it', () => {
    setValue('#lobbyType', 'private');
    clickOn('#lobbyCreate');
    check(pumpUntil(() => /created|create failed/.test(newest()), 8000), 'settled: ' + newest());
    if (!up) {
        check(/create failed/.test(newest()) && q('#log').firstElementChild.classList.contains('err'), 'error row');
        check(q('#lobbyLeave').disabled, 'still no lobby');
        return;
    }
    check(/^\d{17,}$/.test(text('#lobbyId')), 'lobby id: ' + text('#lobbyId'));
    check(!q('#lobbyLeave').disabled && !q('#ldSet').disabled, 'lobby controls on');
    eq(text('#lobbyOwner'), bro.steam.steamId, 'I own it');
    clickOn('#lobbyLeave');
    eq(text('#lobbyId'), '—');
    check(q('#lobbyLeave').disabled, 'controls off again');
});

test('requestLobbyList fills the results box', () => {
    clickOn('#lobbyList');
    check(pumpUntil(() => /\d+ lobbies/.test(newest()), 8000), 'settled: ' + newest());
    if (!up) check(/no matching lobbies/.test(text('#lobbyResults')), 'empty result shown');
});

test('joinLobby with an empty id does nothing; a bad id fails', () => {
    const n = rows().length;
    clickOn('#joinBtn');
    eq(rows().length, n, 'empty id ignored');
    setValue('#joinId', '0');
    clickOn('#joinBtn');
    check(pumpUntil(() => /join failed|joined/.test(newest()), 8000), 'settled: ' + newest());
    check(/join failed/.test(newest()), 'lobby 0 does not exist: ' + newest());
});

test('voice toggle reflects the real recording state', () => {
    clickOn('#voiceToggle');
    if (bro.steam.isVoiceRecording) {
        eq(text('#voiceToggle'), 'stop recording');
        check(q('#voiceToggle').classList.contains('active'), 'active');
        clickOn('#voiceToggle');
        check(/recording stopped/.test(newest()), newest());
    } else {
        eq(text('#voiceToggle'), 'start recording', 'not shown as recording');
        check(!q('#voiceToggle').classList.contains('active'), 'not active');
        check(/recording did not start/.test(newest()), newest());
    }
    shot('used');
});

done('steam-lab ui');
