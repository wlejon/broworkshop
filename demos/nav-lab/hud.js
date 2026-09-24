// hud.js — Navigation Lab's controls and readouts. Every button runs the same
// lab / module entry points the tests call.

import { $, h } from "/lib/kit/dom.js";
import { fpsMeter, foldPanels } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { marks, linkMarks } from "/app/level.js";
import { bakeParams, navState, setOverlayVisible, saveMesh, loadMesh, CACHE_PATH } from "/app/navmesh.js";
import { agentState, setSpeed, retargetAll, walkingCount } from "/app/agents.js";
import { obstacleState, obstaclesEnabled, obstaclesPending, obstacleCount, blockCorridor, clearObstacles } from "/app/obstacles.js";
import { crowdState, setAvoidance, clearCrowd, overlapMean, scenarioFunnel, scenarioVip, scenarioFactions, scenarioStacked } from "/app/crowd.js";
import { linkState, activeLinkDefs, linkIsLive, linkSegmentsOf, sendLinkWalkers, resetLinkWalkers, setSealed, comparePartial } from "/app/links.js";
import { gridState, setGridOverlayVisible, walkTheRamp, resetFollowers, followerSpread, setFollowersVisible } from "/app/grid.js";
import { steerState, KERNELS, setSteeringVisible, setLead, simulateShot, agentSpeed, distanceToTarget, HIT_RADIUS } from "/app/steering.js";
import { lab, state, on, refreshPath, rebake, applyMode, afterObstacleChange, setRoute, setShellVisible, refreshOverlay } from "/app/lab.js";

const hint = (id, text, kind) => { const el = $('#' + id); el.className = 'hint' + (kind ? ' ' + kind : ''); el.textContent = text; };
const put = (id, v) => { $('#' + id).textContent = String(v); };
const m = (v, dp = 2) => v.toFixed(dp) + ' m';

let stale = false;   // bake parameters changed since the last bake

export function wireHud() {
    foldPanels('#side');
    wireBake();
    wirePaths();
    wireLinks();
    wireAgents();
    wireCrowd();
    wireObstacles();
    wireSteering();
    wireCache();

    on('bake', () => { readBake(); readMode(); readLinks(); readObstacles(); });
    on('path', readPath);
    on('obstacles', (err) => { readObstacles(); if (err) hint('obsHint', err, 'err'); });
    on('crate', (r) => obstacleMessage(r ? (r.action === 'added'
        ? 'Crate dropped: the overlay hole is a real gap in the baked surface, carved by rebuilding only the tiles it touches.'
        : 'Crate removed; those tiles rebuilt back to their original walkable surface.') : null));
    const fps = fpsMeter();
    lab.vp.onFrame(() => fps.tick());
    on('tick', () => {
        put('fps', fps.fps.toFixed(0));
        readObstacles(); readCrowd(); readLinks(); readFollow(); readSteer(); readAim();
        put('stWalking', `${walkingCount()} / ${agentState.agents.length}`);
    });

    readBake(); readMode(); readPath(state.path); readLinks(); readObstacles(); readCrowd(); readGrid(); readFollow(); readAim();
    $('#status').textContent = 'ready';
}

// --- bake ------------------------------------------------------------------------------

function wireBake() {
    // Sliders set the parameter but do NOT re-bake: baking is seconds-scale on
    // a real level; the explicit button is the honest interaction.
    const param = (id, key, fmt) => bindControl('#' + id, { out: '#' + id + 'V', fmt, onChange: (v) => { bakeParams[key] = v; markStale(); } });
    param('pRadius', 'agentRadius', (v) => m(v));
    param('pHeight', 'agentHeight', (v) => m(v, 1));
    param('pSlope', 'agentMaxSlopeDeg', (v) => v.toFixed(0) + '°');
    param('pClimb', 'agentMaxClimb', (v) => m(v));
    param('pCell', 'cellSize', (v) => v.toFixed(3));
    $('#btnBake').addEventListener('click', () => { stale = false; rebake(); });

    bindControl('#ovStep', { out: '#ovStepV', fmt: (v) => v.toFixed(2), onChange: (v) => { navState.probeStep = v; refreshOverlay(); } });
    bindControl('#ovOn', { onChange: setOverlayVisible });
    bindControl('#shellOn', { onChange: setShellVisible });
    bindControl('#gridOverlayOn', { onChange: (v) => { setGridOverlayVisible(v); readGrid(); } });
    $('#btnModeLinks').addEventListener('click', () => { stale = false; applyMode(false); });
    $('#btnModeTiled').addEventListener('click', () => { stale = false; applyMode(true); });
}

function markStale() {
    stale = true;
    hint('bakeHint', 'Parameters changed: press Re-bake to apply.');
}

function readBake() {
    put('stSamples', navState.walkableSamples);
    put('stQuads', navState.overlayQuads);
    put('stBake', `${navState.bakeMs.toFixed(0)} ms / ${navState.blobBytes} B`);
    if (navState.lastError) hint('bakeHint', 'Bake failed: ' + navState.lastError, 'err');
    else if (!stale) hint('bakeHint', `Baked from ${lab.levelNodes.length} static bodies via fromPhysics.`, 'ok');
    readGrid();
}

function readGrid() {
    put('stGridCells', gridState.cells);
    put('stGridTested', gridState.tested);
}

function readMode() {
    const tiled = !!(navState.mesh && navState.mesh.supportsObstacles);
    $('#btnModeLinks').classList.toggle('active', !tiled);
    $('#btnModeTiled').classList.toggle('active', tiled);
    const bar = $('#modeBar');
    bar.className = tiled ? 'mode tiled' : 'mode';
    bar.textContent = tiled
        ? 'Tiled + obstacles: crates carve the surface at runtime; links dropped, save() throws'
        : `Static + links: ${navState.linksBaked} off-mesh link(s) baked, save() works, no runtime obstacles`;
    hint('modeHint', 'bakeNavMesh throws if asked for links and dynamic obstacles together: a dtTileCache rebuilds tiles and would silently drop bake-time links. Two bakes, one switch (toolbar).');
}

// --- path queries ----------------------------------------------------------------------

function wirePaths() {
    // "Cross floor" is the headline: ground to mezzanine, which a NavGrid cannot express.
    $('#btnSameFloor').addEventListener('click', () => setRoute(marks.hallSW, marks.chamber));
    $('#btnCrossFloor').addEventListener('click', () => setRoute(marks.hallSW, marks.mezzanine));
    $('#btnToRoof').addEventListener('click', () => setRoute(marks.eastRoom, marks.roof));
    bindControl('#reqFull', { onChange: (v) => { state.requireFullPath = v; refreshPath(); } });
    bindControl('#gridOn', { onChange: (v) => { state.showGrid = v; refreshPath(); } });
}

function readPath(p) {
    const segs = linkSegmentsOf(p);
    put('stLinkSegs', p ? segs.length : '—');
    put('stPartial', p ? String(!!p.partial) : '—');
    put('stWp', p ? p.points.length : '—');
    put('stLen', p ? m(p.length) : 'no path');
    put('stRise', p ? m(p.rise) : '—');
    if (!p) {
        hint('pathHint', state.requireFullPath
            ? 'No route. requireFullPath is on, so an unreachable goal returns nothing rather than a clamped path: untick it to see how far the route would have got.'
            : 'No route: an endpoint did not snap onto the baked surface. Re-bake with a smaller agent radius, or pick a point on the mesh.', 'err');
    } else if (segs.length) {
        hint('pathHint', `This route uses ${segs.length} off-mesh link${segs.length === 1 ? '' : 's'}: waypoint ${segs[0].index} is a takeoff, and the segment after it is a jump/drop/climb, not a walk. Detour routed through it with no special-case code in this app.`, 'ok');
    } else if (p.partial) {
        hint('pathHint', 'Partial route: the goal is unreachable, so the path clamps to the closest reachable point (orange marker).', 'err');
    } else if (p.rise > 0.75) {
        hint('pathHint', `Multi-level route: the path climbs ${p.rise.toFixed(1)} m across storeys. A NavGrid has no Y at all and cannot express this.`, 'ok');
    } else {
        hint('pathHint', 'Single-storey route: switch on the NavGrid comparison to see the two agree here, then try "Cross floor".');
    }

    const g = state.gridPath;
    put('stGwp', state.showGrid ? (g ? g.points.length : 'none') : '—');
    put('stGlen', state.showGrid && g ? m(g.length) : '—');
    if (!state.showGrid) return;
    if (!p) hint('gridHint', 'No navmesh route to compare against.');
    else if (p.rise > 0.75) {
        hint('gridHint', g
            ? `The grid returns a ${g.points.length}-waypoint route pinned at y 0: it walks to the goal's XZ shadow on the ground floor and stops ${p.rise.toFixed(1)} m below the actual goal. It has no way to know a mezzanine exists.`
            : 'The grid finds nothing: the goal projects onto a blocked ground-floor cell.', 'err');
    } else {
        hint('gridHint', g
            ? `Same storey, so both agree: navmesh ${p.length.toFixed(1)} m, grid ${g.length.toFixed(1)} m. The grid is fine right up until the level gains height.`
            : 'The grid finds nothing here.');
    }
}

// --- links + partial paths -------------------------------------------------------------

function wireLinks() {
    const send = (to, where) => {
        const n = sendLinkWalkers(to);
        if (!n) hint('linkHint', 'No route: either the links are not in the current bake (check the mode) or the pad is sealed.', 'err');
        else hint('linkHint', `${n} walker(s) routed to ${where}`, 'ok');
    };
    $('#btnLinkJump').addEventListener('click', () => send(linkMarks.padEast, 'the island pad. The 4.5 m gap has no walkable route across it, so every one of these routes goes through the jump link.'));
    $('#btnLinkDrop').addEventListener('click', () => send(linkMarks.hallBelow, 'the hall floor below the mezzanine. The one-way drop is the short way down; walking would mean the whole ramp.'));
    $('#btnLinkLadder').addEventListener('click', () => send(linkMarks.ladderTop, 'the mezzanine, via the ladder at its south-east corner.'));
    $('#btnLinkHome').addEventListener('click', () => { resetLinkWalkers(); readLinks(); });

    $('#btnSeal').addEventListener('click', () => { setSealed(true); stale = false; rebake(); runPartial(); });
    $('#btnUnseal').addEventListener('click', () => { setSealed(false); stale = false; rebake(); runPartial(); });
    $('#btnPartial').addEventListener('click', runPartial);
}

/** Ask for the island twice (loose and strict) and draw the loose answer next to its goal. */
export function runPartial() {
    const from = { ...marks.eastRoom }, to = { ...linkMarks.padEast };
    const r = comparePartial(from, to);
    state.requireFullPath = false;
    $('#reqFull').checked = false;
    setRoute(from, to);
    put('stLoose', r.looseFound ? (r.loosePartial ? 'partial' : 'complete') : 'none');
    put('stStrict', r.strictFound ? 'complete' : 'none');
    put('stShort', isFinite(r.shortfall) ? m(r.shortfall) : '—');
    if (r.loosePartial && !r.strictFound) {
        hint('partialHint', `Sealed. requireFullPath:false walks to the lip of the gap and stops ${r.shortfall.toFixed(1)} m short with partial=true (orange marker); requireFullPath:true returns nothing at all. Same mesh, same query, one flag.`, 'ok');
    } else if (r.looseFound && r.strictFound) {
        hint('partialHint', 'The jump link is in the bake, so the pad is reachable and both flags agree on a complete route. Seal it to see them split.');
    } else {
        hint('partialHint', 'Neither query found a route: the start point did not snap onto the surface.', 'err');
    }
    return r;
}

function readLinks() {
    const defs = activeLinkDefs() || [];
    put('stLinks', navState.linksBaked);
    // No link read-back: "live" is inferred by asking for a route only the link allows.
    put('stLinksLive', `${defs.filter(linkIsLive).length} / ${defs.length}`);
    put('stOnLink', linkState.onLinkNow);
    put('stLastLink', linkState.lastLink);
    put('stTraversals', linkState.traversals);
    put('stCrossed', linkState.crossedGap);
}

// --- walkers + ground follow -----------------------------------------------------------

function wireAgents() {
    bindControl('#aSpeed', { out: '#aSpeedV', fmt: (v) => v.toFixed(1), onChange: setSpeed });
    $('#btnSend').addEventListener('click', () => retargetAll(state.goal));
    $('#btnWalkRamp').addEventListener('click', () => { walkTheRamp(); readFollow(); });
    $('#btnFollowReset').addEventListener('click', () => { resetFollowers(); readFollow(); });
    bindControl('#followOn', { onChange: setFollowersVisible });
}

function readFollow() {
    const fmt = (f) => { const s = followerSpread(f); return s > 0 ? m(s) : '—'; };
    put('stFollowY', fmt(true));
    put('stFlatY', fmt(false));
}

// --- crowd -----------------------------------------------------------------------------

const SCENARIOS = {
    btnFunnel: [scenarioFunnel, 'Both halves are ordered through the 2.6 m doorway at once. Toggle avoidance: off, they walk through each other and the overlapping-pair count sits high; on, they queue and sidestep.'],
    btnVip: [scenarioVip, 'Gold VIP at priority 1.0 and grey control at 0.0 make the same trip into the same oncoming crowd. The pair splits the avoidance effort by priority, so the control is shoved three times as far off its line.'],
    btnFactions: [scenarioFactions, 'Two factions cross one junction. Each masks only its own layer, so it queues against its own kind and walks straight through the other: layers/mask, doing something you can see.'],
    btnStacked: [scenarioStacked, 'The same lane on the hall floor and on the mezzanine 4 m above. Agents carry an elevation and a 2 m avoidance height; the spans do not overlap, so the solver skips every cross-level pair. A flat 2D solver would have them fighting through a floor.'],
};

function wireCrowd() {
    bindControl('#avoidOn', { onChange: (v) => { setAvoidance(v); readCrowd(); } });
    bindControl('#cCount', { out: '#cCountV', fmt: (v) => v.toFixed(0), onChange: (v) => { crowdState.count = v | 0; } });
    for (const id in SCENARIOS) {
        const [fn, blurb] = SCENARIOS[id];
        $('#' + id).addEventListener('click', () => {
            fn(crowdState.count);
            setAvoidance($('#avoidOn').checked);
            hint('crowdHint', blurb);
            readCrowd();
        });
    }
    $('#btnClearCrowd').addEventListener('click', () => { clearCrowd(); readCrowd(); });
}

function readCrowd() {
    put('stScenario', crowdState.scenario);
    put('stCrowd', crowdState.agents.length);
    put('stOverlap', crowdState.overlapNow);
    put('stOverlapMean', overlapMean().toFixed(2));
}

// --- obstacles -------------------------------------------------------------------------

function obstacleMessage(msg) {
    if (!obstaclesEnabled()) {
        hint('obsHint', 'Switch to the tiled bake first (toolbar): a static mesh has no runtime obstacle API.', 'err');
    } else if (obstacleState.lastError) {
        hint('obsHint', obstacleState.lastError, 'err');
    } else if (msg) hint('obsHint', msg, 'ok');
    readObstacles();
}

function wireObstacles() {
    $('#btnBlock').addEventListener('click', () => {
        const r = blockCorridor();
        afterObstacleChange();
        obstacleMessage(r && r.action === 'blocked'
            ? 'Corridor blocked. Every route through the doorway re-planned; the overlay hole is the mesh, not a decal.'
            : 'Corridor reopened: the surface came back exactly as it was.');
    });
    $('#btnClearObs').addEventListener('click', () => {
        const n = clearObstacles();
        afterObstacleChange();
        obstacleMessage(`Removed ${n} obstacle${n === 1 ? '' : 's'}; the walkable surface is restored.`);
    });
}

function readObstacles() {
    const on = obstaclesEnabled();
    put('stGen', navState.mesh ? navState.mesh.generation : '—');
    put('stObs', on ? obstacleCount() : '—');
    put('stPending', on ? (obstaclesPending() ? 'draining' : 'idle') : '—');
    put('stTiles', obstacleState.applyCalls);
    put('stRepath', agentState.repaths);
}

// --- steering + turret -----------------------------------------------------------------

function wireSteering() {
    const legend = $('#steerLegend');
    for (const k of KERNELS) legend.appendChild(h('div', null, h('i', { style: { background: k.color } }), h('span', null, k.label)));
    bindControl('#steerOn', { onChange: setSteeringVisible });
    bindControl('#leadOn', { onChange: (v) => { setLead(v); readAim(); } });
    // Measured off-screen at a fixed launch time, mid-sweep, so the numbers compare.
    $('#btnMeasureAim').addEventListener('click', () => {
        const direct = simulateShot(1.0, false), lead = simulateShot(1.0, true);
        hint('aimHint', `Straight aim passes ${direct.closest.toFixed(2)} m behind the target; computeLeadAim comes within ${lead.closest.toFixed(2)} m (hit radius ${HIT_RADIUS} m). Same turret, same target, same tick.`, 'ok');
    });
}

function readSteer() {
    put('stSeekV', agentSpeed('seek').toFixed(2) + ' m/s');
    put('stArriveV', agentSpeed('arrive').toFixed(2) + ' m/s');
    put('stArriveD', m(distanceToTarget('arrive')));
}

function readAim() {
    put('stShots', steerState.fired);
    put('stHits', `${steerState.hits} / ${steerState.misses}`);
    put('stClosest', steerState.fired ? m(steerState.lastClosest) : '—');
}

// --- save / load -----------------------------------------------------------------------

function wireCache() {
    $('#btnSave').addEventListener('click', () => {
        try { hint('cacheHint', `Saved ${saveMesh()} bytes to ${CACHE_PATH}.`, 'ok'); }
        catch (e) { hint('cacheHint', 'Save failed: ' + (e.message || e), 'err'); }
    });
    $('#btnLoad').addEventListener('click', () => {
        try {
            const r = loadMesh(state.start, state.goal);
            refreshOverlay();
            refreshPath();
            hint('cacheHint', r.identical
                ? `Restored ${r.bytes} bytes; the same query returns the same ${r.waypointsAfter} waypoints.`
                : `Round trip mismatch: ${r.waypointsBefore} waypoints before, ${r.waypointsAfter} after.`, r.identical ? 'ok' : 'err');
        } catch (e) { hint('cacheHint', 'Load failed: ' + (e.message || e), 'err'); }
    });
}
