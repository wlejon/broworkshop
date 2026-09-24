// procwatch: the parsers on their own, then the live page: the table fills
// from the PowerShell stream, filters and search narrow it, a row opens its
// detail, the gauges go live, and the reaper kills a planted process.
//
// The reaper test only ever targets its own bait: a copy of ping.exe under a
// unique name, with the name list set to just that name. (Pointing it at a
// real tool name would kill other people's processes on this machine.)
import { check, eq, test, done, waitFor, clickOn, setValue, text, q, shot, skip } from "/lib/kit/test.js";
import { summarize } from "/app/lib/cmdline.js";
import { parseGpuCsv, cpuColumns, lineSplitter, isWindows } from "/app/lib/feeds.js";
import { fmtAge } from "/app/lib/table.js";
import { nameSet, addName, reapLog } from "/app/lib/reaper.js";
import { prefs, shown } from "/app/lib/app.js";

// ---- parsers -----------------------------------------------------------------

test('command-line summaries', () => {
    const claude = '"C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe" -c "source /c/Users/jonny/.claude/shell-snapshots/snapshot-bash-1785069767309-g7mc4a.sh 2>/dev/null || true && export TEMP=\'x\' && eval \'grep -rn foo src/\' < /dev/null && pwd -P >| /tmp/cwd"';
    let s = summarize('bash.exe', claude, 'C:\\Program Files\\Git\\usr\\bin\\bash.exe');
    eq(s.title, 'grep -rn foo src/', 'claude eval extraction');
    check(s.tags.includes('agent'), 'agent tag');

    s = summarize('bash.exe', '"C:\\Program Files\\Git\\bin\\bash.exe" -c "source /c/Users/jonny/.claude/shell-snapshots/snapshot-bash-1785069767309-g7mc4a.sh 2>/dev/null || true"', null);
    check(s.title.includes('claude code shell'), 'idle wrapper: ' + s.title);

    s = summarize('node.exe', '"C:\\nvm4w\\nodejs\\node.exe" "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" -y @modelcontextprotocol/server-filesystem D:\\projects \\\\wsl.localhost\\Debian\\home\\j\\projects', 'C:\\nvm4w\\nodejs\\node.exe');
    check(s.title.includes('MCP server-filesystem') && s.title.includes('D:\\projects'), 'MCP: ' + s.title);
    check(s.tags.includes('mcp'), 'mcp tag');

    eq(summarize('find.exe', '"C:\\Program Files\\Git\\usr\\bin\\find.exe" / -iname cubesphere.h', null).title,
       'find / -iname cubesphere.h');
    eq(summarize('powershell.exe', 'powershell.exe -NoProfile -Command Get-Date', null).title, 'powershell · Get-Date');
    eq(summarize('cmd.exe', 'cmd.exe /c dir', null).title, 'cmd · dir');
});

test('feed parsers', () => {
    eq(parseGpuCsv('0, NVIDIA GeForce RTX 4090, 37, 1024, 24564, 51\nbad line\n'),
       [{ idx: '0', name: 'NVIDIA GeForce RTX 4090', util: 37, memUsed: 1024, memTotal: 24564, temp: '51' }]);
    eq(cpuColumns(['(PDH-CSV 4.0)', '\\\\PC\\Processor Information(0,_Total)\\% Processor Time',
                   '\\\\PC\\Processor Information(0,3)\\% Processor Time']), [null, { total: true }, { core: 3 }]);
    const lines = [];
    const feed = lineSplitter((l) => lines.push(l));
    feed('{"a":1}\r\n{"b"');
    feed(':2}\n');
    eq(lines, ['{"a":1}', '{"b":2}']);
    eq([fmtAge(0), fmtAge(42000), fmtAge(3 * 3600e3 + 60e3), fmtAge(90000e3)], ['?', '42s', '3h1m', '1d1h']);
});

test('reaper name lists', () => {
    check(nameSet('Sleep.exe, grep ,,cat').has('sleep'), 'normalised');
    eq(addName('grep,cat', 'Tail.EXE'), 'grep,cat,tail');
    eq(addName('grep,cat', 'cat.exe'), 'grep,cat', 'no duplicate');
});

// ---- the live page -------------------------------------------------------------

if (!isWindows) { done('procwatch parsers'); skip('the live feeds need Windows (PowerShell / WMI)'); }

const saved = prefs.snapshot();
const rows = () => document.querySelectorAll('#tbody .row[data-pid]').length;
try {
    test('the stream fills the table', () => {
        waitFor(() => rows() > 0, 'first snapshot', 30000);
        check(/stream live/.test(text('#status')), 'status: ' + text('#status'));
    });

    test('filters and search narrow the table', () => {
        const narrow = rows();
        clickOn('#f-other');
        check(q('#f-other').closest('.k-chip').classList.contains('on'), 'chip shows on');
        check(rows() > narrow, 'everything else widens: ' + narrow + ' -> ' + rows());
        clickOn('#f-other');
        setValue('#q', 'zz-no-such-process-zz');
        eq(rows(), 0, 'search empties the table');
        check(!q('#empty').hidden, 'empty note shown');
        setValue('#q', '');
        check(rows() > 0, 'rows back');
    });

    test('a row opens its detail; this app offers no kill', () => {
        waitFor(() => document.querySelector('#tbody .dot.self'), 'self row (pid from a snapshot)', 30000);
        setValue('#q', document.querySelector('#tbody .dot.self').closest('.row').querySelector('.c-pid').textContent);
        const self = document.querySelector('#tbody .dot.self').closest('.row');   // now the only row, on screen
        clickOn(self.querySelector('.c-cmd'));
        const detail = q('#tbody .detail');
        check(detail.querySelector('[data-action="copy"]'), 'copy action');
        check(!detail.querySelector('[data-action="kill"]'), 'no kill for self');
        check(self.querySelector('button.kill').disabled, 'row kill disabled');
        clickOn(self.querySelector('.c-pid'));
        check(!document.querySelector('#tbody .detail'), 'second click closes it');
        setValue('#q', '');
    });

    test('sorting by name orders the rows', () => {
        clickOn('#thead [data-sort=name]');
        check(q('#thead [data-sort=name]').classList.contains('sorted'), 'header marked');
        const names = shown().map((p) => p.name || '');
        eq(names, names.slice().sort((a, b) => a.localeCompare(b)));
        clickOn('#thead [data-sort=cpu]');
    });

    test('gauges go live', () => {
        waitFor(() => /%/.test(text('#cpu-val')), 'cpu gauge', 30000);
        waitFor(() => /%/.test(text('#ram-val')), 'ram gauge', 30000);
        check(/GB/.test(text('#ram-sub')), 'ram detail: ' + text('#ram-sub'));
    });

    test('the reaper kills its bait and nothing else', () => {
        const fs = require('fs'), cp = require('child_process');
        const dir = process.cwd().replace(/\\/g, '/') + '/tests/out/procwatch-bait';
        const name = 'pwbait' + Date.now().toString(36);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync('C:/Windows/System32/PING.EXE', dir + '/' + name + '.exe');
        const bait = cp.spawn(dir + '/' + name + '.exe', ['-n', '300', '127.0.0.1']);
        let gone = false;
        bait.on('exit', () => { gone = true; });

        setValue('#reap-names', name);
        setValue('#reap-secs', 5);
        if (q('#reap-orphans').checked) clickOn('#reap-orphans');       // its parent (us) is alive
        const before = reapLog.length;
        clickOn('#reap-on');
        check(prefs.data.reapOn && prefs.data.reapNames === name && prefs.data.reapSecs === 5, 'prefs saved');

        waitFor(() => gone, 'bait reaped', 90000);
        waitFor(() => new RegExp(name).test(text('#reap-log')), 'reap log', 10000);
        check(reapLog.slice(before).every((e) => e.name.toLowerCase() === name + '.exe'), 'only the bait was reaped');
        clickOn('#reap-on');
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });

    shot('main');
} finally {
    prefs.restore(saved);
}
done('procwatch');
