// demos/foundry/tests/audit_motion.js — Standalone Headless Motion-Interaction Auditor.
//
// Sweeps every blueprint in Foundry through its full kinematic motion cycle + live 1 s dyno
// and reports all swept collisions, frame clips, ground strikes, shaft obstructions,
// hard shaft angles, and kinematic stalls!
//
// Run:
//   bro-headless demos/foundry demos/foundry/tests/audit_motion.js

import { createStarterLibrary } from "/lib/foundry/presets.js";
import { compileBlueprint } from "/lib/foundry/compiler.js";
import { auditMachineMotion } from "/lib/foundry/motion_audit.js";

const lib = createStarterLibrary();
let totalErrors = 0;
let totalWarnings = 0;
let cleanCount = 0;

const ids = Object.keys(lib);
console.log(`\n=== FOUNDRY MOTION INTERACTION AUDIT (${ids.length} blueprints) ===`);

for (const id of ids) {
    const bp = lib[id];
    const compiled = compileBlueprint(bp, lib);
    const liveSim = bp.scale !== 'subassembly';
    const rep = auditMachineMotion(compiled, { samples: 12, liveSim });
    totalErrors += rep.counts.errors;
    totalWarnings += rep.counts.warnings;
    if (rep.counts.errors === 0 && rep.counts.warnings === 0) {
        cleanCount++;
    } else {
        const tag = rep.counts.errors > 0 ? 'ERR ' : 'WARN';
        console.log(`[${tag}] ${id} (${bp.name}) — ${rep.counts.errors} errors, ${rep.counts.warnings} warnings:`);
        for (const f of rep.findings) {
            console.log(`       [${f.severity.toUpperCase()}] ${f.text}`);
        }
    }
}

console.log(`\nSUMMARY: ${cleanCount}/${ids.length} completely clean | ${totalErrors} motion errors | ${totalWarnings} warnings`);
bro.quit(totalErrors > 0 ? 1 : 0);
