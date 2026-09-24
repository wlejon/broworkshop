// Turns raw Windows command lines into something a human can read at a glance.
// Pure functions — unit-tested directly by tests/test_smoke.js.

const collapse = s => String(s).replace(/\s+/g, ' ').trim();
const base = p => String(p || '').replace(/["\\/]+$/, '').split(/[\\/]/).pop();

export function argvSplit(cmd) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(String(cmd || '')))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
}

export function shortPath(s) {
    let v = String(s).replace(/^"|"$/g, '');
    v = v.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, '~');
    if (v.length > 48 && /[\\/]/.test(v)) {
        const parts = v.split(/[\\/]+/).filter(Boolean);
        if (parts.length > 3) v = parts[0] + '\\\u2026\\' + parts.slice(-2).join('\\');
    }
    return v;
}

// Claude Code wraps every shell command as:
//   bash.exe -c "source …/shell-snapshots/snapshot-bash-<ts>-<id>.sh … && eval 'real command' < /dev/null && pwd -P >| …"
// The eval payload is the part a human cares about.
function claudeEval(raw) {
    const m = /\beval\s+'([\s\S]*?)'\s*<\s*\/dev\/null/.exec(raw) ||
              /\beval\s+'([\s\S]*)'/.exec(raw);
    return m ? collapse(m[1].replace(/'\\''/g, "'").replace(/\\"/g, '"')) : null;
}

// → { title, tags: [] } — title is the friendly one-liner, tags are chip labels.
export function summarize(name, cmd, path) {
    const n = (name || '').toLowerCase();
    const raw = cmd || path || name || '';
    const args = argvSplit(raw);
    const exe = args[0] || name || '';
    const rest = args.slice(1);

    if (n === 'bash.exe' || /bash(\.exe)?$/i.test(exe)) {
        const snap = /shell-snapshots[\\/]snapshot-bash-\d+-(\w+)\.sh/.exec(raw);
        if (snap) {
            const ev = claudeEval(raw);
            return ev ? { title: ev, tags: ['agent'] }
                      : { title: 'claude code shell \u00b7 ' + snap[1], tags: ['agent'] };
        }
        const ci = rest.indexOf('-c');
        if (ci >= 0) return { title: 'bash -c ' + collapse(rest.slice(ci + 1).join(' ')), tags: [] };
        return { title: collapse('bash ' + rest.map(shortPath).join(' ')), tags: [] };
    }

    const mcp = /@modelcontextprotocol[\\/]server-([\w.-]+)|[\\/]server-([\w.-]+)[\\/]dist[\\/]/.exec(raw);
    if (mcp) {
        const dirs = rest.filter(a => /^[A-Za-z]:[\\/]|^\\\\/.test(a))
                         .filter(a => !/node_modules|npx-cli|\.[cm]?js$/i.test(a));
        return {
            title: 'MCP server-' + (mcp[1] || mcp[2]) +
                   (dirs.length ? ' \u2014 ' + dirs.map(shortPath).join(', ') : ''),
            tags: ['mcp'],
        };
    }
    if (/npx-cli\.js/i.test(raw)) {
        const pkg = rest.filter(a => !a.startsWith('-') && !/npx-cli\.js/i.test(a) && !/node(\.exe)?$/i.test(a))[0];
        return { title: collapse('npx ' + (pkg || '') + ' ' +
            rest.slice(rest.indexOf(pkg) + 1).map(shortPath).join(' ')), tags: ['npx'] };
    }
    if (n === 'node.exe' || /node(\.exe)?$/i.test(exe)) {
        const script = rest.find(a => /\.[cm]?js$/i.test(a));
        const after = script ? rest.slice(rest.indexOf(script) + 1) : rest;
        return { title: collapse('node ' + (script ? base(script) + ' ' : '') +
            after.map(shortPath).join(' ')), tags: [] };
    }
    if (/^(powershell|pwsh)(\.exe)?$/i.test(n) || /powershell(\.exe)?$/i.test(exe)) {
        const ci = rest.findIndex(a => /^-c(ommand)?$/i.test(a));
        if (ci >= 0) return { title: 'powershell \u00b7 ' + collapse(rest.slice(ci + 1).join(' ')), tags: [] };
        const fi = rest.findIndex(a => /^-file$/i.test(a));
        if (fi >= 0) return { title: collapse('powershell ' + base(rest[fi + 1]) + ' ' +
            rest.slice(fi + 2).join(' ')), tags: [] };
        return { title: collapse('powershell ' + rest.join(' ')), tags: [] };
    }
    if (n === 'cmd.exe') {
        const ci = rest.findIndex(a => /^\/[ck]$/i.test(a));
        if (ci >= 0) return { title: 'cmd \u00b7 ' + collapse(rest.slice(ci + 1).join(' ')), tags: [] };
    }

    return {
        title: collapse(base(exe).replace(/\.exe$/i, '') + ' ' + rest.map(shortPath).join(' ')),
        tags: [],
    };
}
