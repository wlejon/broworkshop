// The isosurface animation as a state machine, with no DOM or scene in it,
// so a test can drive it with plain dt steps.
//
// Three modes run on top of each other:
//   1. cell sweep  phase by phase through each active cell of the current
//                  z slice, committing the cell's output when its last
//                  phase ends (2D history + 3D wire segments at that z).
//   2. stitch      between the previous non-empty slice and this one, fold
//                  in the connectors that turn stacked 2D contours into a
//                  closed surface (MC: shared edge crossings of the same
//                  cell column; SN/DC: dual vertices of the same column).
//   3. fill        after the last stitched slice, ramp the ghost mesh from
//                  translucent to nearly solid in discrete steps, so the
//                  wireframe visibly resolves into the real surface.
//
// hooks: ghost(alpha) recreate the ghost mesh at that opacity;
//        slice(z)     the current slice changed;
//        playing(on)  the play state changed.

import { PHASES, MSQ_TABLE, CASE_RGB, DUAL_RGB, analyseSlice, edgePoints, solveVertex } from "./field.js";

export const SPEED_MAX = 50;
export const GHOST_ALPHA = 0.18;
export const FILL_ALPHA = 0.85;

export class Sweep {
    constructor(hooks) {
        this.hooks = hooks || {};
        this.algo = 'marchingCubes';
        this.field = null; this.n = 0; this.iso = 0; this.cellSize = 0.7;
        this.slice = null;
        this.sweepVolume = true;       // auto-advance z when a slice completes
        this.playing = false;
        this.speedExp = 0;             // slider position: target speed = SPEED_MAX^speedExp
        this.speed = 1;
        // Effective speed ramps from 1x to the target over rampMs of play, so
        // the first cells crawl (readable) and the bulk goes by quickly.
        this.rampMs = 6000;
        this.playTimeMs = 0;
        this.segments3D = [];          // {x0,y0,z0,x1,y1,z1,r,g,b}, accumulated across slices
        this.wireDirty = false;
        this.ghostAlpha = GHOST_ALPHA;
        this.clearSlice();
        this.prevSlice = null;         // {slice, vertices} of the last finished non-empty slice
        this.stitching = null;         // {t, ms, segs, added}
        this.filling = null;           // {t, ms, steps, lastStep, fromA, toA}
        this.finished = false;
    }

    /** Point at a field (n³, already built). Does not reset the animation. */
    setField(field, n, iso, cellSize) {
        this.field = field; this.n = n; this.iso = iso; this.cellSize = cellSize;
    }

    get phases() { return PHASES[this.algo]; }
    get phase() { return this.phases[this.phaseIdx]; }
    get cellOrder() { return this.slice ? this.slice.order : []; }
    /** Index of the cell under the cursor, or -1 once the slice is swept. */
    get currentCell() { return this.cellStep < this.cellOrder.length ? this.cellOrder[this.cellStep] : -1; }
    get sweptSlice() { return this.cellStep >= this.cellOrder.length; }

    loadSlice(z) {
        z = Math.max(0, Math.min(this.n - 1, z | 0));
        this.slice = analyseSlice(this.field, this.n, z, this.iso);
        if (this.hooks.slice) this.hooks.slice(z);
    }

    clearSlice() {
        this.cellStep = 0; this.phaseIdx = 0; this.phaseT = 0;
        this.emittedMC = [];           // [{cellIdx, cx, cy, code}]
        this.vertices = {};            // cellIdx -> {u, v}
        this.threads = [];             // [{a, b}] dual edges
    }

    /** Scrub to slice z: restart its sweep, keep the 3D wire. */
    setSlice(z) {
        this.loadSlice(z);
        this.clearSlice();
        this.stitching = null;
    }

    /** Back to slice 0 with nothing built, playing. */
    reset() {
        this.clearSlice();
        this.segments3D.length = 0;
        this.wireDirty = true;
        this.prevSlice = null; this.stitching = null; this.filling = null;
        this.finished = false;
        this.setGhost(GHOST_ALPHA);
        this.playTimeMs = 0;
        this.speed = 1;
        this.loadSlice(0);
        this.setPlaying(true);
    }

    setPlaying(on) {
        this.playing = !!on;
        if (this.hooks.playing) this.hooks.playing(this.playing);
    }

    setGhost(alpha) {
        this.ghostAlpha = alpha;
        if (this.hooks.ghost) this.hooks.ghost(alpha);
    }

    // --- committing -----------------------------------------------------------

    /** Neighbour cells (4-connected) that share a sign-changing edge and already have a vertex. */
    activeNeighbors(cellIdx) {
        const s = this.slice, n = s.n, sg = s.signed;
        const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
        const out = [];
        const edge = (ia, ib, other) => {
            if ((sg[ia] < 0) !== (sg[ib] < 0) && this.vertices[other]) out.push(other);
        };
        if (cx < n - 2) edge(cy * n + cx + 1, (cy + 1) * n + cx + 1, cellIdx + 1);
        if (cy < n - 2) edge((cy + 1) * n + cx, (cy + 1) * n + cx + 1, cellIdx + (n - 1));
        if (cx > 0) edge(cy * n + cx, (cy + 1) * n + cx, cellIdx - 1);
        if (cy > 0) edge(cy * n + cx, cy * n + cx + 1, cellIdx - (n - 1));
        return out;
    }

    /** Fold a finished cell into the 2D history and the 3D wire at this z. */
    commitCell(cellIdx) {
        const s = this.slice, n = s.n, cs = this.cellSize, zW = s.z * cs;
        if (!s.cellPts[cellIdx]) return;
        const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
        if (this.algo === 'marchingCubes') {
            const code = s.cases[cellIdx];
            this.emittedMC.push({ cellIdx, cx, cy, code });
            const segs = MSQ_TABLE[code], ex = edgePoints(s, cx, cy), col = CASE_RGB[code];
            for (let k = 0; k < segs.length; k += 2) {
                const a = segs[k], b = segs[k + 1];
                this.segments3D.push({
                    x0: ex[a * 2] * cs, y0: ex[a * 2 + 1] * cs, z0: zW,
                    x1: ex[b * 2] * cs, y1: ex[b * 2 + 1] * cs, z1: zW,
                    r: col[0], g: col[1], b: col[2],
                });
            }
        } else {
            const v = solveVertex(this.algo, s.cellPts[cellIdx]);
            if (!v) return;
            const neighbors = this.activeNeighbors(cellIdx);
            this.vertices[cellIdx] = v;
            const col = DUAL_RGB[this.algo];
            for (const other of neighbors) {
                this.threads.push({ a: cellIdx, b: other });
                const ov = this.vertices[other];
                const ocx = other % (n - 1), ocy = (other / (n - 1)) | 0;
                this.segments3D.push({
                    x0: (cx + v.u) * cs, y0: (cy + v.v) * cs, z0: zW,
                    x1: (ocx + ov.u) * cs, y1: (ocy + ov.v) * cs, z1: zW,
                    r: col[0], g: col[1], b: col[2],
                });
            }
        }
        this.wireDirty = true;
    }

    commitNext() {
        this.commitCell(this.cellOrder[this.cellStep]);
        this.cellStep++;
        this.phaseIdx = 0;
    }

    /** Step button: forward `count` phases (committing cells they finish). */
    advancePhase(count) {
        for (let k = 0; k < count && !this.sweptSlice; k++) {
            if (this.phaseIdx + 1 >= this.phases.length) this.commitNext();
            else this.phaseIdx++;
            this.phaseT = 0;
        }
    }

    completeCurrentCell() {
        if (this.sweptSlice) return;
        this.commitNext();
        this.phaseT = 0;
    }

    finishSlice() {
        while (!this.sweptSlice) this.commitNext();
        this.phaseT = 0;
    }

    // --- stitching and fill -----------------------------------------------------

    snapshot() {
        this.prevSlice = { slice: this.slice, vertices: Object.assign({}, this.vertices) };
    }

    /** Connectors between prevSlice and the current slice (see the header). */
    stitchSegments() {
        const prev = this.prevSlice, s = this.slice;
        if (!prev || prev.slice.n !== s.n) return [];
        const n = s.n, cs = this.cellSize, zP = prev.slice.z * cs, zC = s.z * cs;
        const segs = [];
        for (let y = 0; y < n - 1; y++) {
            for (let x = 0; x < n - 1; x++) {
                const idx = y * (n - 1) + x;
                if (this.algo === 'marchingCubes') {
                    const pP = prev.slice.cellPts[idx], pC = s.cellPts[idx];
                    if (!pP || !pC) continue;
                    const byEdge = [-1, -1, -1, -1];
                    for (let i = 0; i < pP.length; i += 5) byEdge[pP[i + 4]] = i;
                    const col = CASE_RGB[s.cases[idx]];
                    for (let i = 0; i < pC.length; i += 5) {
                        const j = byEdge[pC[i + 4]];
                        if (j < 0) continue;
                        segs.push({
                            x0: (x + pP[j]) * cs, y0: (y + pP[j + 1]) * cs, z0: zP,
                            x1: (x + pC[i]) * cs, y1: (y + pC[i + 1]) * cs, z1: zC,
                            r: col[0], g: col[1], b: col[2],
                        });
                    }
                } else {
                    const vp = prev.vertices[idx], vc = this.vertices[idx];
                    if (!vp || !vc) continue;
                    const col = DUAL_RGB[this.algo];
                    segs.push({
                        x0: (x + vp.u) * cs, y0: (y + vp.v) * cs, z0: zP,
                        x1: (x + vc.u) * cs, y1: (y + vc.v) * cs, z1: zC,
                        r: col[0], g: col[1], b: col[2],
                    });
                }
            }
        }
        return segs;
    }

    /** True if a stitch started (there were connectors to add). */
    startStitch() {
        const segs = this.stitchSegments();
        if (!segs.length) return false;
        this.stitching = { t: 0, ms: 600, segs, added: 0 };
        return true;
    }

    flushStitch() {
        const st = this.stitching;
        if (!st) return;
        while (st.added < st.segs.length) this.segments3D.push(st.segs[st.added++]);
        this.wireDirty = true;
    }

    startFill() {
        this.filling = { t: 0, ms: 1500, steps: 6, lastStep: -1, fromA: this.ghostAlpha, toA: FILL_ALPHA };
    }

    triggerFillOrEnd() {
        if (!this.finished && this.prevSlice) { this.finished = true; this.startFill(); }
        else this.setPlaying(false);
    }

    /** The current slice's sweep ran out: stitch, advance, fill, or stop. */
    onSliceComplete() {
        const hasFeatures = this.cellOrder.length > 0;
        const hasPrev = this.prevSlice != null;
        if (hasFeatures && hasPrev && this.startStitch()) return;
        if (hasFeatures) this.snapshot();
        if (!this.sweepVolume) { this.setPlaying(false); return; }
        // Leaving a non-empty run into emptiness is the cue to fill.
        if (!hasFeatures && hasPrev) { this.triggerFillOrEnd(); return; }
        // Walk forward through leading (or interior) empty slices.
        while (this.slice.z < this.n - 1) {
            this.advanceSlice();
            if (this.cellOrder.length > 0) return;
            if (hasPrev) { this.triggerFillOrEnd(); return; }
        }
        this.triggerFillOrEnd();
    }

    advanceSlice() {
        if (this.slice.z >= this.n - 1) return false;
        this.setSlice(this.slice.z + 1);
        return true;
    }

    // --- time -----------------------------------------------------------------------

    stepCellSweep(dt) {
        this.phaseT += dt / Math.max(1, this.phase.ms / this.speed);
        while (this.phaseT >= 1) {
            this.phaseT -= 1;
            if (this.phaseIdx + 1 < this.phases.length) { this.phaseIdx++; continue; }
            this.commitNext();
            if (this.sweptSlice) { this.phaseT = 0; return; }
        }
    }

    stepStitch(dt) {
        const st = this.stitching;
        st.t = Math.min(1, st.t + dt / Math.max(1, st.ms / this.speed));
        const target = Math.floor(st.t * st.segs.length);
        while (st.added < target) this.segments3D.push(st.segs[st.added++]);
        if (st.added > 0) this.wireDirty = true;
        if (st.t < 1) return;
        this.flushStitch();
        this.stitching = null;
        this.snapshot();               // the next non-empty slice chains to this one
        if (!this.sweepVolume) this.setPlaying(false);
        else if (!this.advanceSlice()) this.triggerFillOrEnd();
    }

    stepFill(dt) {
        const f = this.filling;
        f.t = Math.min(1, f.t + dt / Math.max(1, f.ms / this.speed));
        const step = Math.min(f.steps, Math.floor(f.t * (f.steps + 1)));
        if (step !== f.lastStep) {
            f.lastStep = step;
            this.setGhost(f.fromA + (f.toA - f.fromA) * (f.steps > 0 ? step / f.steps : 1));
        }
        if (f.t < 1) return;
        if (this.ghostAlpha !== f.toA) this.setGhost(f.toA);
        this.filling = null;
        this.setPlaying(false);
    }

    /** Advance by dt milliseconds of play (no-op while paused). */
    tick(dt) {
        if (!this.playing) return;
        this.playTimeMs += dt;
        const target = Math.pow(SPEED_MAX, this.speedExp);
        this.speed = 1 + (target - 1) * Math.min(1, this.playTimeMs / this.rampMs);
        if (this.filling) this.stepFill(dt);
        else if (this.stitching) this.stepStitch(dt);
        else if (!this.sweptSlice) this.stepCellSweep(dt);
        else this.onSliceComplete();
    }

    /** Skip: flush whichever mode is in flight (fill, stitch, or the current cell). */
    skip() {
        this.setPlaying(false);
        if (this.filling) { this.setGhost(this.filling.toA); this.filling = null; }
        else if (this.stitching) { this.flushStitch(); this.stitching = null; this.snapshot(); }
        else this.completeCurrentCell();
    }

    /** Finish: like skip, but sweeps the rest of the slice. */
    finish() {
        this.setPlaying(false);
        if (this.filling) { this.setGhost(this.filling.toA); this.filling = null; }
        else if (this.stitching) { this.flushStitch(); this.stitching = null; this.snapshot(); }
        else this.finishSlice();
    }

    /** Step: pause and advance one phase. */
    step() {
        this.setPlaying(false);
        this.advancePhase(1);
    }
}
