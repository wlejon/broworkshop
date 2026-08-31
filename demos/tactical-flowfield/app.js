// app.js — Main entry point for Tactical Flow Field demo.

import { installSystemMenu } from "/lib/system-menu.js";
import { FlowField, TERRAIN } from "./flowfield.js";
import { InfluenceMap } from "./influence.js";
import { UnitManager, FORMATIONS } from "./units.js";
import { TacticalUI, TOOLS } from "./ui.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const WIDTH = 1280;
const HEIGHT = 720;
const CELL_SIZE = 10;
const COLS = WIDTH / CELL_SIZE; // 128
const ROWS = HEIGHT / CELL_SIZE; // 72

// Instantiate Core Systems
const flowField = new FlowField(COLS, ROWS, CELL_SIZE);
const influenceMap = new InfluenceMap(COLS, ROWS, CELL_SIZE);
const unitManager = new UnitManager(5000, { width: WIDTH, height: HEIGHT });
const ui = new TacticalUI(canvas, flowField, influenceMap, unitManager);

// Set Initial Goal
const initialGoalX = WIDTH * 0.75;
const initialGoalY = HEIGHT * 0.5;
ui.placeGoalAnchor(initialGoalX, initialGoalY);

// --- Presets ---
function loadScenarioChoke() {
    flowField.initDefaultCost();
    influenceMap.clearThreats();

    // Vertical wall with a narrow choke point in the center
    const midX = (COLS * 0.5) | 0;
    const gapSize = 5;
    for (let y = 1; y < ROWS - 1; y++) {
        if (Math.abs(y - ROWS / 2) > gapSize) {
            flowField.setCost(midX - 1, y, TERRAIN.IMPASSABLE);
            flowField.setCost(midX, y, TERRAIN.IMPASSABLE);
            flowField.setCost(midX + 1, y, TERRAIN.IMPASSABLE);
        }
    }

    // Place enemy threat behind choke point
    influenceMap.addThreat(WIDTH * 0.7, HEIGHT * 0.5, 160, 1.5);

    // Goal at far right
    ui.placeGoalAnchor(WIDTH * 0.85, HEIGHT * 0.5);
    unitManager.initUnits();
}

function loadScenarioRiver() {
    flowField.initDefaultCost();
    influenceMap.clearThreats();

    // River across map (rough water) with two narrow bridge passes
    const riverX = (COLS * 0.45) | 0;
    for (let y = 1; y < ROWS - 1; y++) {
        for (let dx = -4; dx <= 4; dx++) {
            const isBridge1 = Math.abs(y - ROWS * 0.3) < 4;
            const isBridge2 = Math.abs(y - ROWS * 0.7) < 4;
            if (!isBridge1 && !isBridge2) {
                flowField.setCost(riverX + dx, y, TERRAIN.ROUGH);
            }
        }
    }

    // Goal across river
    ui.placeGoalAnchor(WIDTH * 0.82, HEIGHT * 0.3);
    unitManager.initUnits();
}

// Initial setup
loadScenarioChoke();

// --- Wire HTML Controls ---
// Formations
document.querySelectorAll('[data-formation]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-formation]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        unitManager.setFormation(btn.dataset.formation);
    });
});

// Tools
document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ui.activeTool = btn.dataset.tool;
    });
});

// Unit Slider
const unitSlider = document.getElementById('unit-count-slider');
const unitCountVal = document.getElementById('unit-count-val');
const statUnits = document.getElementById('stat-units');
unitSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    unitCountVal.textContent = val;
    statUnits.textContent = val;
    unitManager.setUnitCount(val);
});

// Brush Size Slider
const brushSlider = document.getElementById('brush-size-slider');
const brushVal = document.getElementById('brush-size-val');
brushSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    brushVal.textContent = `${val} px`;
    ui.brushRadius = val;
});

// Toggles
document.getElementById('toggle-flow').addEventListener('change', (e) => {
    ui.showFlowVectors = e.target.checked;
});
document.getElementById('toggle-influence').addEventListener('change', (e) => {
    ui.showInfluence = e.target.checked;
});
document.getElementById('toggle-integration').addEventListener('change', (e) => {
    ui.showIntegration = e.target.checked;
});
document.getElementById('toggle-choke').addEventListener('change', (e) => {
    ui.showChokePoints = e.target.checked;
});

// Preset buttons
document.getElementById('btn-scenario-choke').addEventListener('click', loadScenarioChoke);
document.getElementById('btn-scenario-river').addEventListener('click', loadScenarioRiver);
document.getElementById('btn-clear-all').addEventListener('click', () => {
    flowField.initDefaultCost();
    influenceMap.clearThreats();
    ui.placeGoalAnchor(WIDTH * 0.5, HEIGHT * 0.5);
});

// --- Telemetry Elements ---
const statFps = document.getElementById('stat-fps');
const statWaveMs = document.getElementById('stat-wave-ms');
const statChokeCount = document.getElementById('stat-choke-count');

let lastTime = performance.now();
let frameCount = 0;
let fpsTimer = 0;

// --- Main Simulation Loop ---
function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // FPS Meter
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
        statFps.textContent = Math.round(frameCount / fpsTimer);
        frameCount = 0;
        fpsTimer = 0;
    }

    // 1. Recompute FlowField if modified
    if (flowField.needsUpdate) {
        flowField.recompute();
        influenceMap.update(
            Array.from({ length: unitManager.unitCount }, (_, i) => ({
                x: unitManager.x[i],
                y: unitManager.y[i]
            })),
            flowField
        );
        statWaveMs.textContent = `${flowField.lastComputeTimeMs.toFixed(2)} ms`;
        statChokeCount.textContent = influenceMap.chokePointList.length;
    }

    // 2. Simulate Units
    unitManager.tick(flowField, influenceMap, dt);

    // 3. Render Canvas
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Overlays & terrain
    ui.renderOverlays(ctx);

    // Units
    unitManager.render(ctx);

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
