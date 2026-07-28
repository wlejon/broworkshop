// procwatch smoke: summarizer units, table populates via the event stream,
// filters narrow, row click opens the action panel, gauges go live, and the
// auto-reaper kills a planted leftover end-to-end.
//
// Run from the bro repo root:
//   ./build/Release/bro-headless.exe ../broworkshop/tools/procwatch ../broworkshop/tools/procwatch/tests/test_smoke.js

import { summarize } from "/app/cmdline.js";

const cp = require('child_process');

function waitFor(desc, fn, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        sleep(400); flush();
        if (fn()) return;
    }
    assert(false, 'timeout waiting for: ' + desc);
}

// -- summarizer units --------------------------------------------------------
const claudeCmd = '"C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe" -c "source /c/Users/jonny/.claude/shell-snapshots/snapshot-bash-1785069767309-g7mc4a.sh 2>/dev/null || true && export TEMP=\'x\' && eval \'grep -rn foo src/\' < /dev/null && pwd -P >| /tmp/cwd"';
let s = summarize('bash.exe', claudeCmd, 'C:\\Program Files\\Git\\usr\\bin\\bash.exe');
assert(s.title === 'grep -rn foo src/', 'claude eval extraction, got: ' + s.title);
assert(s.tags.includes('agent'), 'claude wrapper should tag agent');

const idleCmd = '"C:\\Program Files\\Git\\bin\\bash.exe" -c "source /c/Users/jonny/.claude/shell-snapshots/snapshot-bash-1785069767309-g7mc4a.sh 2>/dev/null || true && export TEMP=\'x\'"';
s = summarize('bash.exe', idleCmd, null);
assert(s.title.includes('claude code shell'), 'idle wrapper title, got: ' + s.title);

const mcpCmd = '"C:\\nvm4w\\nodejs\\node.exe" "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" -y @modelcontextprotocol/server-filesystem D:\\projects \\\\wsl.localhost\\Debian\\home\\j\\projects';
s = summarize('node.exe', mcpCmd, 'C:\\nvm4w\\nodejs\\node.exe');
assert(s.title.includes('MCP server-filesystem'), 'MCP title, got: ' + s.title);
assert(s.title.includes('D:\\projects'), 'MCP dirs shown, got: ' + s.title);
assert(s.tags.includes('mcp'), 'MCP tag');

s = summarize('find.exe', '"C:\\Program Files\\Git\\usr\\bin\\find.exe" / -iname cubesphere.h', null);
assert(s.title === 'find / -iname cubesphere.h', 'generic tool title, got: ' + s.title);
console.log('summarizer units OK');

// -- table populates (our own bro-headless.exe runs from D:) -----------------
waitFor('first snapshot to fill the table', () =>
    document.querySelectorAll('#tbody tr[data-pid]').length > 0);
console.log('rows after first snap:', document.querySelectorAll('#tbody tr[data-pid]').length);

// -- "everything else" must widen the view ----------------------------------
const before = document.querySelectorAll('#tbody tr[data-pid]').length;
const other = document.getElementById('f-other');
other.click(); flush();
const after = document.querySelectorAll('#tbody tr[data-pid]').length;
console.log('rows narrow=' + before + ' wide=' + after);
assert(after > before, 'everything-else should add rows (' + before + ' -> ' + after + ')');
other.click(); flush();

// -- search narrows to nothing ----------------------------------------------
const q = document.getElementById('q');
q.value = 'zz-no-such-process-zz';
q.dispatchEvent(new Event('input'));
flush();
assert(document.querySelectorAll('#tbody tr[data-pid]').length === 0, 'search should empty the table');
q.value = '';
q.dispatchEvent(new Event('input'));
flush();

// -- row click opens the detail/action panel --------------------------------
waitFor('self row (needs selfPid detection from a snapshot)', () =>
    document.querySelector('#tbody .dot.self'));
const selfRow = document.querySelector('#tbody .dot.self').closest('tr');
selfRow.click(); flush();
let detail = document.querySelector('#tbody tr.detail');
assert(detail, 'detail row should open on click');
assert(detail.querySelector('[data-action="copy"]'), 'detail should offer copy action');
assert(!detail.querySelector('[data-action="kill"]'), 'self row must not offer kill');
selfRow.click(); flush();
assert(!document.querySelector('#tbody tr.detail'), 'detail row should close on second click');
console.log('row interaction OK');

// -- CPU + RAM gauges live ---------------------------------------------------
waitFor('cpu gauge value', () =>
    document.getElementById('cpu-val').textContent.includes('%'));
waitFor('ram gauge value', () =>
    document.getElementById('ram-val').textContent.includes('%'));
console.log('cpu:', document.getElementById('cpu-val').textContent,
            'ram:', document.getElementById('ram-val').textContent,
            document.getElementById('ram-sub').textContent);
sleep(1500); flush();
console.log('gpu cards:', document.querySelectorAll('#gpus .gauge').length);

// -- auto-reaper end-to-end --------------------------------------------------
// Bait: Git's sleep.exe (on the default reap list, reliably long-lived). Its
// parent (us) stays alive, so orphans-only must be off for this test.
const reapOn = document.getElementById('reap-on');
if (!reapOn.checked) reapOn.click();
const reapOrphans = document.getElementById('reap-orphans');
if (reapOrphans.checked) reapOrphans.click();
const secs = document.getElementById('reap-secs');
secs.value = '5';
secs.dispatchEvent(new Event('change'));
flush();

const bait = cp.spawn('C:\\Program Files\\Git\\usr\\bin\\sleep.exe', ['300']);
console.log('bait sleep.exe pid:', bait.pid);
let baitGone = false;
bait.on('exit', () => { baitGone = true; });

sleep(2000); flush();
assert(!baitGone, 'bait exited on its own — not a valid reaper test');

waitFor('reaper to kill the bait sleep.exe', () => baitGone, 90000);
waitFor('reap log to record it', () =>
    document.getElementById('reap-log').textContent.includes('sleep'));
console.log('reap log:', document.getElementById('reap-log').textContent);

// Restore defaults so a test run doesn't leave aggressive settings behind.
secs.value = '30';
secs.dispatchEvent(new Event('change'));
if (reapOn.checked) reapOn.click();
if (!reapOrphans.checked) reapOrphans.click();
flush();

screenshot('procwatch.png');
console.log('SMOKE OK');
