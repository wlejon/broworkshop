// Reusable "Living Table Engine Vitals" HUD panel for closed-loop bro.table demos.
// Renders live table versions, tombstone ratio, GPU->Table writeback cadence, ReactiveQuery
// incremental chunk reuse, relational join/JIT query plans, COW snapshots, & v3 mmap indexes.

import { h } from "/lib/kit/dom.js";
import { readout } from "/lib/kit/ui.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";

export function createLivingVitalsPanel(containerEl) {
    containerEl.innerHTML = '';

    const badgesRow = h('div.living-badge-row');
    const bWriteback = h('span.k-badge.ok', 'gpu writeback');
    const bReactive = h('span.k-badge.ok', 'reactive chunks');
    const bJoin = h('span.k-badge.info', 'relational join');
    const bMmap = h('span.k-badge.warn', 'v3 mmap idx: —');
    badgesRow.append(bWriteback, bReactive, bJoin, bMmap);
    containerEl.appendChild(badgesRow);

    const kvHost = h('div');
    containerEl.appendChild(kvHost);
    const kv = readout(kvHost, {
        version: 'table v / struct',
        rows: 'alive (tomb %)',
        reactiveReuse: 'reactive chunks',
        gpuWriteback: 'gpu -> table',
        workerPlan: 'worker join / jit',
        snapshots: 'cow snapshots',
        checkpoint: 'v3 mmap audit',
    });

    const barLabel = h('div.living-bar-caption', 'Reactive incremental chunk reuse');
    const barTrack = h('div.living-bar-track');
    const barFill = h('div.living-bar-fill');
    barTrack.appendChild(barFill);
    containerEl.append(barLabel, barTrack);

    return {
        update(info) {
            if (info.tableStats) {
                const st = info.tableStats;
                const pct = ((st.tombstoneRatio || 0) * 100).toFixed(1);
                kv.set({
                    version: `v${info.version | 0} / s${info.structureVersion | 0}`,
                    rows: `${fmtInt(st.rowCount)} (${pct}% dead)`,
                });
            }
            if (info.reactive) {
                const rc = info.reactive;
                const tot = Math.max(1, (rc.recomputedChunks | 0) + (rc.reusedChunks | 0));
                const skipPct = Math.round(((rc.reusedChunks | 0) / tot) * 100);
                kv.set({
                    reactiveReuse: `${rc.recomputedChunks | 0} dirty / ${rc.reusedChunks | 0} reused`,
                });
                barFill.style.width = `${skipPct}%`;
                barLabel.textContent = `Reactive reuse: ${rc.reusedChunks | 0}/${tot} chunks skipped (${skipPct}%)`;
                bReactive.className = 'k-badge ' + (rc.reusedChunks > 0 ? 'ok' : 'warn');
            }
            if (info.gpuWriteback != null) {
                kv.set({ gpuWriteback: info.gpuWriteback });
            }
            if (info.workerPlan) {
                const wp = info.workerPlan;
                const wTag = wp.simdWidth ? `${wp.simdWidth}-bit` : 'idx';
                kv.set({ workerPlan: `${wp.strategy || 'jit'} · ${wTag} · ${fmtMs(wp.ms || 0)}` });
            }
            if (info.snapshotsShipped != null) {
                kv.set({ snapshots: `${fmtInt(info.snapshotsShipped)} sent (O(1) COW)` });
            }
            if (info.checkpoint) {
                const cp = info.checkpoint;
                bMmap.className = 'k-badge ' + (cp.mappedIndexes > 0 ? 'ok' : 'warn');
                bMmap.textContent = `v3 mmap idx: ${cp.mappedIndexes}`;
                kv.set({
                    checkpoint: `${cp.mappedIndexes} idx mmapped (${fmtMs(cp.ms || 0)})`,
                });
            }
        },
    };
}
