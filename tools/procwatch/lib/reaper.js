// reaper.js — auto-kill of leftover tool processes.
//
// Opt-in, because the default name list is broad on purpose (the unix tools
// agents leave behind). A process is reaped when its name is on the list, it
// is older than the age limit, (with orphans-only) its parent is gone, and it
// is not protected. Runs after every snapshot.

import { world, baseName, isProtected } from "./procs.js";
import { kill } from "./feeds.js";

export const REAP_DEFAULT_NAMES =
    'find,grep,egrep,fgrep,rg,sed,awk,gawk,sort,uniq,xargs,cat,tail,head,tr,wc,cut,sleep,less,yes';

export const REAP_DEFAULTS = {
    reapOn: false,            // opt-in: the list is broad by nature
    reapOrphansOnly: true,    // parent alive -> probably still someone's tool
    reapSecs: 30,
    reapNames: REAP_DEFAULT_NAMES,
};

export const reapLog = [];    // { name, pid } in kill order
const inFlight = new Set();

export const nameSet = (list) => new Set(String(list).split(',').map((s) => baseName(s.trim())).filter(Boolean));

/** The processes cfg would reap now (no side effects). */
export function reapTargets(cfg) {
    if (!cfg.reapOn) return [];
    const names = nameSet(cfg.reapNames);
    const maxAge = Math.max(5, cfg.reapSecs) * 1000;
    return [...world.procs.values()].filter((p) =>
        names.has(baseName(p.name)) && p.start && p.ageMs >= maxAge &&
        (!cfg.reapOrphansOnly || p.orphan) && !isProtected(p) && !inFlight.has(p.pid));
}

/** Kill every target; onReaped(entry) after each kill lands. */
export function reap(cfg, onReaped) {
    for (const p of reapTargets(cfg)) {
        inFlight.add(p.pid);
        kill(p.pid, true, () => {
            inFlight.delete(p.pid);
            const entry = { name: p.name, pid: p.pid };
            reapLog.push(entry);
            if (onReaped) onReaped(entry);
        });
    }
}

/** Add a process name to the list (from a row's "auto-kill" action). Returns the new list. */
export function addName(list, name) {
    const b = baseName(name);
    return nameSet(list).has(b) ? list : list + ',' + b;
}
