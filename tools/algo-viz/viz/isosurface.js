// Isosurface extraction, visualised as the algorithm RUNNING.
//
// LEFT  The 3D mesh from the selected algorithm, shown as a translucent
//       ghost while the sweep wraps it in wire (one ribbon per committed
//       output, stitched across slices), then filled in solid at the end.
// RIGHT One big slice panel animating the algorithm cell by cell. A cursor
//       sweeps the active cells in scan order; at each cell the
//       algorithm's micro-steps unfold and the result accumulates behind it:
//
//   marchingCubes  highlight → classify corners → pulse the matching entry
//                  of the 16-case table → draw the emitted segment(s).
//   surfaceNets    highlight → classify → edge crossings → construction
//                  lines converge on the centroid → dual vertex → threads
//                  to the neighbouring vertices.
//   dualContour    highlight → classify → crossings → gradient normals →
//                  tangent constraint lines → vertex at their least-squares
//                  intersection (the QEF) → threads.
//
// Rotate the view with the gizmo rings (or right-drag), pan with the middle
// button, zoom with the wheel. The animation model lives in
// isosurface/sweep.js, the 2D drawing in isosurface/draw.js.

import { h } from "/lib/kit/dom.js";
import { orbitControls, Camera } from "/lib/kit/viewport3d.js";
import { register } from "./registry.js";
import { controls, button, toggle, overlay, lifetime } from "./ui.js";
import { ALGOS, FIELDS, buildField } from "./isosurface/field.js";
import { Sweep } from "./isosurface/sweep.js";
import { drawSweep, paintField } from "./isosurface/draw.js";
import { wireMesh } from "./isosurface/wire.js";


register({
    id: 'isosurface',
    name: 'Isosurface extraction',
    category: 'Voxels & Geometry',
    subtitle: 'Watch the chosen algorithm run cell by cell on a 2D slice — micro-steps animate, the contour/net assembles behind the cursor. MC: lookup-table emit. SN: centroid + threading. DC: QEF from normal constraints.',

    init({ stage, params }) {
        const life = lifetime();
        const state = { algo: 'marchingCubes', field: 'gyroid', grid: 32, iso: 0, cell: 0.7, seed: 1, autoRotate: false };

        // --- layout -----------------------------------------------------------------
        const canvas = h('canvas.av-fill');
        const left = h('div.av-box.av-grow', null, canvas);
        const meshLabel = overlay(left);

        const bar1 = h('div.k-toolbar.av-bar');
        const speedIn = h('input.av-grow', { type: 'range', min: '0', max: '1', step: '0.001', value: '0' });
        const speedOut = h('span.k-val', null, '1.0x');
        const bar2 = h('div.k-toolbar.av-bar');
        const sliceIn = h('input.av-grow', { type: 'range', min: '0', max: '0', step: '1', value: '0' });
        const sliceOut = h('span.k-val', null, '0 / 0');
        const sliceStats = h('div.av-slicestats');
        const hdrAlgo = h('span.av-hdr-algo'), hdrPhase = h('span.av-hdr-phase'), hdrCell = h('span.dim');
        const animCanvas = h('canvas.av-fill');
        const badge = h('div.av-badge');
        const panel = h('div.av-box.av-grow.av-col', null,
            h('div.av-panelhdr', null, hdrAlgo, hdrPhase, hdrCell),
            h('div.av-grow.av-rel', null, animCanvas, badge));
        const right = h('div.av-col.av-iso-side', null, bar1, bar2,
            h('div.k-toolbar.av-bar', null, h('span.k-cap', null, 'slice'), sliceIn, sliceOut),
            sliceStats, panel);
        stage.appendChild(h('div.av-split', null, left, right));
        const animCtx = animCanvas.getContext('2d');
        const fieldCtx = h('canvas', { width: 1, height: 1 }).getContext('2d');

        // --- scene --------------------------------------------------------------------
        void canvas.offsetWidth;
        const scene = canvas.getContext('scene');
        scene.setToneMap({ mode: 'aces', exposure: 1.0 });
        scene.setAmbient({ color: [0.10, 0.11, 0.13] });
        scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [1.0, 0.96, 0.88], intensity: 3.2, castsShadow: true });
        scene.createLight({ type: 'directional', direction: [0.6, -0.4, 0.5], color: [0.7, 0.82, 1.0], intensity: 1.0 });
        const cam = Camera.createOrbit({ target: [0, 0, 0], dist: 28 });
        const pushCam = () => scene.setCamera(Camera.orbitViewOpts(cam, canvas));
        pushCam();

        let built = null, ghost = null, fieldData = null, triCount = 0;
        const wire = wireMesh(scene);
        const offset = () => -(state.grid - 1) * 0.5 * state.cell;

        function createGhost(alpha) {
            if (ghost) { ghost.destroy(); ghost = null; }
            if (!built) return;
            const o = offset();
            ghost = scene.createMesh({
                data: built, color: [0.55, 0.75, 0.95, alpha], metallic: 0.0, roughness: 0.85,
                twoSided: true, castsShadow: false, x: o, y: o, z: o,
            });
        }

        // --- animation model ------------------------------------------------------------
        let playBtn = null;
        const sw = new Sweep({
            ghost: createGhost,
            slice: (z) => { paintField(fieldCtx, sw.slice); sliceIn.value = String(z); },
            playing: (on) => { if (playBtn) { playBtn.on = on; playBtn.el.textContent = on ? 'Pause' : 'Play'; } },
        });

        function rebuildMesh() {
            built = Mesh[state.algo](fieldData, state.grid, state.grid, state.grid, state.iso, state.cell);
            triCount = !built ? 0 : built.indices ? built.indices.length / 3 : built.positions ? built.positions.length / 9 : 0;
            createGhost(sw.ghostAlpha);
            const n = state.grid;
            meshLabel.set('algo:    ' + state.algo + '\nfield:   ' + state.field
                + '\ngrid:    ' + n + '³ = ' + n * n * n + ' samples'
                + '\niso:     ' + state.iso.toFixed(2) + '\ntris:    ' + (triCount | 0));
        }

        /** Mesh + sweep from scratch (the wire's scale and offset depend on grid and cell). */
        function restart() {
            sw.algo = state.algo;
            sw.setField(fieldData, state.grid, state.iso, state.cell);
            sliceIn.max = String(state.grid - 1);
            rebuildMesh();
            sw.reset();
        }
        function rebuildField() {
            fieldData = buildField(state.field, state.grid, state.seed);
            restart();
        }

        // --- controls: sweep ------------------------------------------------------------
        playBtn = toggle(bar1, 'Play', false, (on) => sw.setPlaying(on));
        button(bar1, 'Step', () => sw.step(), 'Pause and advance one micro-step');
        button(bar1, 'Skip', () => sw.skip(), 'Finish the current cell (or stitch / fill)');
        button(bar1, 'Finish', () => sw.finish(), 'Sweep the rest of this slice');
        button(bar1, 'Reset', () => sw.reset());
        const sweepBtn = toggle(bar2, 'Sweep volume', sw.sweepVolume, (on) => { sw.sweepVolume = on; });
        sweepBtn.el.title = 'Advance through z slices automatically';
        // Slider t in [0, 1] maps exponentially to a target of 1..50x, so the
        // low end moves in small steps and the top scrubs whole slices.
        bar2.append(h('span.k-cap', null, 'speed'), speedIn, speedOut);
        life.listen(speedIn, 'input', () => { sw.speedExp = parseFloat(speedIn.value); });
        // Scrubbing restarts that slice's sweep but keeps the 3D wire.
        life.listen(sliceIn, 'input', () => sw.setSlice(parseInt(sliceIn.value, 10)));

        // --- controls: field --------------------------------------------------------------
        controls(params, state, {
            algo:  { options: ALGOS },
            field: { options: FIELDS },
            iso:   { min: -3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
            grid:  { min: 16, max: 64, step: 4, fmt: (v) => String(v | 0) },
            cell:  { min: 0.2, max: 1.0, step: 0.05, fmt: (v) => v.toFixed(2) },
            seed:  { type: 'number', step: 1 },
        }, (key) => {
            if (key === 'grid') state.grid |= 0;
            if (key === 'seed') { state.seed |= 0; if (state.field !== 'noise') return; }
            if (key === 'field' || key === 'grid' || key === 'seed') rebuildField();
            else restart();
        });
        const rotBtn = toggle(params, 'auto-rotate', state.autoRotate, (on) => { state.autoRotate = on; });
        const stopRotate = () => { state.autoRotate = false; rotBtn.on = false; };

        // --- input ------------------------------------------------------------------------
        const orbit = orbitControls(canvas, cam, {
            minDist: 2, maxDist: 80,
            onChange: () => { if (orbit && orbit.dragging) stopRotate(); pushCam(); },
        });
        // The gizmo's rings orbit the camera about its pivot by the drag's
        // world-space rotation.
        const gizmo = globalThis.bro && bro.gizmo;
        if (gizmo) {
            gizmo.setMode('rotate');
            gizmo.setSpace('world');
            gizmo.setPosition(0, 0, 0);
            gizmo.configure({ size: 80, alwaysOnTop: true });
            gizmo.attach({
                beginDrag: stopRotate,
                rotate: (qx, qy, qz, qw) => {
                    const q = [qx, qy, qz, qw];
                    cam.rot = Camera.quatNorm(Camera.quatMul(q, cam.rot));
                    const off = Camera.quatRotVec(q, [cam.pos[0] - cam.pivot[0], cam.pos[1] - cam.pivot[1], cam.pos[2] - cam.pivot[2]]);
                    cam.pos = [cam.pivot[0] + off[0], cam.pivot[1] + off[1], cam.pivot[2] + off[2]];
                    pushCam();
                },
            });
        }

        // --- frame ------------------------------------------------------------------------
        let lastT = 0, lastWire = 0;
        function renderPanel(now) {
            const r = animCanvas.getBoundingClientRect();
            const W = Math.max(1, r.width | 0), H = Math.max(1, r.height | 0);
            if (animCanvas.width !== W || animCanvas.height !== H) { animCanvas.width = W; animCanvas.height = H; }
            drawSweep(animCtx, W, H, sw, fieldCtx.canvas, now);

            const s = sw.slice, total = sw.cellOrder.length;
            hdrAlgo.textContent = sw.algo;
            if (sw.filling) {
                hdrPhase.textContent = 'phase: fill (' + ((sw.filling.t * 100) | 0) + '%)';
                hdrCell.textContent = 'slices ' + state.grid + ' · α ' + sw.ghostAlpha.toFixed(2);
            } else if (sw.stitching) {
                hdrPhase.textContent = 'phase: stitch ' + (sw.prevSlice ? sw.prevSlice.slice.z : '?') + '→' + s.z;
                hdrCell.textContent = sw.stitching.added + ' / ' + sw.stitching.segs.length + ' connectors';
            } else {
                hdrPhase.textContent = sw.sweptSlice ? 'slice swept' : 'phase: ' + sw.phase.id;
                hdrCell.textContent = 'cell ' + Math.min(sw.cellStep, total) + ' / ' + total;
            }
            const msg = sw.filling ? 'filling surface' : sw.stitching ? 'stitching slices'
                : sw.finished && !sw.playing ? 'mesh complete' : sw.sweptSlice && total > 0 ? 'slice complete' : '';
            badge.textContent = msg;
            badge.style.display = msg ? '' : 'none';
            sliceOut.textContent = s.z + ' / ' + (s.n - 1);
            sliceStats.textContent = 'range ' + s.mn.toFixed(2) + ' .. ' + s.mx.toFixed(2) + '    active cells: ' + total;
            speedOut.textContent = sw.speed.toFixed(sw.speed >= 10 ? 0 : 1) + 'x';
        }

        life.loop((now) => {
            if (state.autoRotate) { Camera.orbitLook(cam, 0.4, 0); pushCam(); }
            if (lastT === 0) lastT = now;
            const dt = Math.min(100, now - lastT);
            lastT = now;
            sw.tick(dt);
            // Rebuilding the wire is an upload of every box so far: at most
            // ~10 Hz, however fast the sweep runs.
            if (sw.wireDirty && now - lastWire > 90) {
                sw.wireDirty = false;
                lastWire = now;
                wire.update(sw.segments3D, state.cell, offset());
            }
            renderPanel(now);
        });

        rebuildField();
        return {
            life, state, sweep: sw, orbit, gizmo,
            get ghost() { return ghost; },
            get wire() { return wire; },
            get triCount() { return triCount; },
            dispose() {
                life.dispose();
                orbit.dispose();
                if (ghost) { ghost.destroy(); ghost = null; }
                wire.dispose();
                if (gizmo) { gizmo.detach(); gizmo.hide(); }
            },
        };
    },

    destroy(handle) { handle.dispose(); },
});
