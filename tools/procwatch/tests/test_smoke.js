// procwatch smoke: table populates, filters narrow, gauges go live, and the
// auto-reaper kills a planted leftover end-to-end.
//
// Run from the bro repo root:
//   ./build/Release/bro-headless.exe ../broworkshop/tools/procwatch ../broworkshop/tools/procwatch/tests/test_smoke.js
//
// Spawns a real (stdin-blocked, harmless) find.exe as reaper bait — the real
// scanner, PowerShell, typeperf and taskkill all run for real.

const cp = require('child_process');

function waitFor(desc, fn, timeoutMs = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        sleep(400); flush();
        if (fn()) return;
    }
    assert(false, 'timeout waiting for: ' + desc);
}

// -- table populates (our own bro-headless.exe runs from D:, so the default
//    unix/D: buckets are never empty on this repo) ---------------------------
waitFor('first scan to fill the table', () =>
    document.querySelectorAll('#tbody tr').length > 0);
console.log('rows after first scan:', document.querySelectorAll('#tbody tr').length);

// -- "everything else" must widen the view ----------------------------------
const before = document.querySelectorAll('#tbody tr').length;
const other = document.getElementById('f-other');
other.click(); flush();
const after = document.querySelectorAll('#tbody tr').length;
console.log('rows narrow=' + before + ' wide=' + after);
assert(after > before, 'everything-else should add rows (' + before + ' -> ' + after + ')');
other.click(); flush();

// -- search narrows to nothing ----------------------------------------------
const q = document.getElementById('q');
q.value = 'zz-no-such-process-zz';
q.dispatchEvent(new Event('input'));
flush();
assert(document.querySelectorAll('#tbody tr').length === 0, 'search should empty the table');
assert(!document.getElementById('empty').classList.contains('hidden'), 'empty note should show');
q.value = '';
q.dispatchEvent(new Event('input'));
flush();

// -- CPU + RAM gauges live (typeperf stream) --------------------------------
waitFor('cpu gauge value', () =>
    document.getElementById('cpu-val').textContent.includes('%'));
waitFor('ram gauge value', () =>
    document.getElementById('ram-val').textContent.includes('%'));
console.log('cpu:', document.getElementById('cpu-val').textContent,
            'ram:', document.getElementById('ram-val').textContent,
            document.getElementById('ram-sub').textContent);

// -- GPU cards (tolerate machines without nvidia-smi) ------------------------
sleep(1500); flush();
const gpus = document.querySelectorAll('#gpus .gauge').length;
console.log('gpu cards:', gpus);

// -- auto-reaper end-to-end --------------------------------------------------
// Windows' own find.exe with a pattern and no input file blocks reading stdin
// forever — a perfect fake leftover. Name matches the default reap list.
const reapOn = document.getElementById('reap-on');
if (!reapOn.checked) { reapOn.click(); }
const secs = document.getElementById('reap-secs');
secs.value = '5';
secs.dispatchEvent(new Event('change'));
flush();

// Git's sleep.exe is on the default reap list and reliably stays alive
// (Windows find.exe exits instantly unless its pattern arrives pre-quoted).
const bait = cp.spawn('C:\\Program Files\\Git\\usr\\bin\\sleep.exe', ['300']);
console.log('bait sleep.exe pid:', bait.pid);
let baitGone = false;
bait.on('exit', () => { baitGone = true; });

sleep(2000); flush();
assert(!baitGone, 'bait exited on its own — not a valid reaper test');

waitFor('reaper to kill the bait find.exe', () => baitGone, 40000);
waitFor('reap log to record it', () =>
    document.getElementById('reap-log').textContent.includes('sleep'));
console.log('reap log:', document.getElementById('reap-log').textContent);

// Restore the persisted threshold so a test run doesn't leave 5 s behind.
secs.value = '30';
secs.dispatchEvent(new Event('change'));
flush();

screenshot('procwatch.png');
console.log('SMOKE OK');
