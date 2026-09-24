// lab.js — Tactical Flow Field: scenarios, tools, pointer input, frame loop.
// hud.js wires the DOM; tests import this directly.
//
//   field.js    terrain + its NavGrid mirror, the flow-field wave, leader A*
//   tactics.js  LOS-gated threat, influence, choke regions, cover
//   units.js    the swarm and its formations
//   render.js   one canvas, batched

import { fixedStep } from "/lib/kit/ui.js";
import { COLS, ROWS, TERRAIN, field, resetTerrain, fillRect, setCell, paint, setGoal, updateField, leaderRoute } from "/app/field.js";
import { tactics, addThreat, removeThreatsNear, clearThreats, projectThreat, analyzeTerrain, updateInfluence } from "/app/tactics.js";
import { swarm, deploy, setFacing, updateSlots, tickUnits, centroid } from "/app/units.js";
import { bindCanvas, resize, draw, toWorld } from "/app/render.js";

export const TOOLS = ['goal', 'wall', 'rough', 'erase', 'threat'];
const PAINT = { wall: TERRAIN.WALL, rough: TERRAIN.ROUGH, erase: TERRAIN.OPEN };
const BRUSH_COLOR = { wall: '#ffaa33', rough: '#d48800', erase: '#ffffff' };

export const lab = {
    canvas: null,
    tool: 'goal',
    brush: 2.4,              // cells
    scenario: 'choke',
    leader: null,            // the NavGrid A* route for one unit (the comparison)
    influenceStamp: 0,
    waves: 0,
    frames: 0,
    pointer: null,           // world point under the mouse
};

const listeners = {};
export function on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); }
function emit(ev, arg) { for (const fn of listeners[ev] || []) fn(arg); }

// --- scenarios ---------------------------------------------------------------------------

export const SCENARIOS = {
    /**
     * A wall across the middle with one 11-cell gap, and a threat past it
     * overlooking the gap's north side: the wave bends the swarm to the south
     * side of the gap, and the wall shades cover cells behind it.
     */
    choke() {
        resetTerrain();
        clearThreats();
        const mid = COLS / 2 | 0, cy = ROWS / 2;
        for (let y = 1; y < ROWS - 1; y++) if (Math.abs(y + 0.5 - cy) > 5.5) fillRect(mid - 1, y, mid + 1, y, TERRAIN.WALL);
        addThreat(COLS * 0.6, ROWS * 0.3, 16, 1.5);
        return { goal: { x: COLS * 0.85, y: cy }, start: { x: 12, y: cy } };
    },
    /** A mud river with two bridges. */
    river() {
        resetTerrain();
        clearThreats();
        const rx = COLS * 0.45 | 0;
        for (let y = 1; y < ROWS - 1; y++) {
            if (Math.abs(y - ROWS * 0.3) < 4 || Math.abs(y - ROWS * 0.7) < 4) continue;
            for (let dx = -4; dx <= 4; dx++) setCell(rx + dx, y, TERRAIN.ROUGH);
        }
        return { goal: { x: COLS * 0.82, y: ROWS * 0.3 }, start: { x: 12, y: ROWS / 2 } };
    },
    /** Open ground. */
    clear() {
        resetTerrain();
        clearThreats();
        return { goal: { x: COLS / 2, y: ROWS / 2 }, start: { x: 12, y: ROWS / 2 } };
    },
};

export function loadScenario(name) {
    const s = SCENARIOS[name]();
    lab.scenario = name;
    deploy(s.start.x, s.start.y);
    placeGoal(s.goal.x, s.goal.y);
    refresh();
    emit('scenario', name);
}

/** Move the goal; the formation faces the approach. */
export function placeGoal(x, y, facing) {
    setGoal(x, y);
    setFacing(facing);
    refresh();
}

/**
 * Bring every derived layer up to date now: terrain analysis, LOS threat,
 * the wave, the leader route. The frame loop calls it too; tools and tests
 * call it to see the result without waiting a frame.
 */
let seenVersion = -1;
export function refresh() {
    if (field.version !== seenVersion) {
        seenVersion = field.version;
        analyzeTerrain();
        if (tactics.threats.length) projectThreat();   // walls moved: shadows moved
    }
    if (updateField()) {
        lab.waves++;
        updateSlots();
        lab.leader = leaderRoute(centroid());
        emit('wave');
    }
}

// --- tools -----------------------------------------------------------------------------

export function setTool(t) { if (TOOLS.includes(t)) lab.tool = t; }

/** Apply the current tool at a world point (drag: true while the button is held). */
export function applyTool(p, drag) {
    const t = lab.tool;
    if (t === 'goal') {
        if (!drag) placeGoal(p.x, p.y);
        else {
            const dx = p.x - field.goal.x, dy = p.y - field.goal.y;
            if (Math.hypot(dx, dy) > 1) { setFacing(Math.atan2(dy, dx)); }
        }
    } else if (t === 'threat') {
        if (!drag) addThreat(p.x, p.y, 14, 1.2);
    } else {
        paint(p.x, p.y, lab.brush, PAINT[t]);
        if (t === 'erase') removeThreatsNear(p.x, p.y, lab.brush + 1);
    }
    refresh();
    emit('edit', t);
}

function bindPointer(c) {
    let down = false;
    const at = (e) => { const r = c.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); };
    const onMap = (p) => p.x >= 0 && p.y >= 0 && p.x < COLS && p.y < ROWS;
    c.addEventListener('mousedown', (e) => {
        const p = at(e);
        if (!onMap(p)) return;
        if (e.button === 2) { placeGoal(p.x, p.y); return; }
        if (e.button !== 0) return;
        down = true;
        applyTool(p, false);
    });
    c.addEventListener('mousemove', (e) => {
        lab.pointer = at(e);
        if (down && onMap(lab.pointer)) applyTool(lab.pointer, true);
    });
    window.addEventListener('mouseup', () => { down = false; });
    c.addEventListener('mouseleave', () => { lab.pointer = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- loop -------------------------------------------------------------------------------

export function startLab(canvas) {
    lab.canvas = canvas;
    bindCanvas(canvas);
    window.addEventListener('resize', resize);
    bindPointer(canvas);
    loadScenario('choke');
    const step = fixedStep(1 / 60);
    let influenceClock = 0, leaderClock = 0, last = performance.now();
    const frame = () => {
        const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        refresh();
        step(dt, (h) => {
            tickUnits(h);
            influenceClock += h; leaderClock += h;
        });
        // The swarm moves: influence and the one-unit comparison follow it.
        if (influenceClock >= 0.5) { influenceClock = 0; updateInfluence(swarm.x, swarm.y, swarm.n); lab.influenceStamp++; }
        if (leaderClock >= 1.0) { leaderClock = 0; lab.leader = leaderRoute(centroid()); }
        if (canvas.clientWidth !== canvas.width || canvas.clientHeight !== canvas.height) resize();
        const brush = lab.pointer && PAINT[lab.tool] != null ? { ...lab.pointer, r: lab.brush, color: BRUSH_COLOR[lab.tool] } : null;
        draw({ leader: lab.leader, brush, waves: lab.waves, influenceStamp: lab.influenceStamp });
        if (++lab.frames % 15 === 0) emit('tick');
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return lab;
}
