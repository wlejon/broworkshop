// Reusable Engine Proof panel controller for sci-atlas demos.
// Displays dataset provenance (REAL DATA mmap vs DEMO SAMPLE), off-heap memory stats,
// and query execution telemetry (explain strategy, AVX2 simdWidth, latency, throughput).

import { h } from "/lib/kit/dom.js";
import { readout } from "/lib/kit/ui.js";
import { fmtInt, fmtBytes, fmtMs } from "/lib/sci-atlas/data-paths.js";

export function createEngineProofPanel(containerEl) {
    containerEl.innerHTML = '';

    const headerRow = h('div.k-row', { style: 'justify-content: space-between; align-items: center; margin-bottom: 6px;' });
    const modeBadge = h('span.k-badge.warn', 'SAMPLE MODE');
    headerRow.appendChild(modeBadge);
    containerEl.appendChild(headerRow);

    const kvHost = h('div');
    containerEl.appendChild(kvHost);
    const kv = readout(kvHost, {
        rows: 'rows',
        storage: 'storage',
        mem: 'off-heap mem',
        strategy: 'plan strategy',
        simd: 'SIMD width',
        queryMs: 'query latency',
        rate: 'throughput',
    });

    const ingestNote = h('div.k-note', { style: 'margin-top: 8px; display: none;' });
    containerEl.appendChild(ingestNote);

    return {
        setProvenance(isReal, stats, ingestCmd) {
            modeBadge.className = 'k-badge ' + (isReal ? 'ok' : 'warn');
            modeBadge.textContent = isReal ? 'REAL DATA (OS mmap)' : 'SYNTHETIC SAMPLE';
            if (!isReal && ingestCmd) {
                ingestNote.style.display = 'block';
                ingestNote.textContent = 'Full dataset: ' + ingestCmd;
            } else {
                ingestNote.style.display = 'none';
            }
            if (stats) {
                kv.set({
                    rows: fmtInt(stats.rowCount) + ' (' + stats.chunkCount + ' ch)',
                    storage: isReal ? '.brotable v2 mmap' : 'off-heap Table',
                    mem: fmtBytes(stats.totalBytes || stats.fixedBytes || 0),
                });
            }
        },
        setQueryStats(ms, rowsScanned, execStats) {
            const rate = ms > 0 ? (rowsScanned / (ms * 1000)).toFixed(1) + ' M/s' : '—';
            const width = execStats && execStats.simdWidth ? (execStats.simdWidth + '-bit AVX2') : 'scalar/idx';
            kv.set({
                strategy: (execStats && (execStats.strategy || (execStats.usedSimd ? 'jit_simd' : 'indexed'))) || 'jit',
                simd: width,
                queryMs: fmtMs(ms),
                rate,
            });
        },
        kv,
    };
}
