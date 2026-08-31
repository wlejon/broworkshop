// app.js — Main entry point for NavMesh Carving & Off-Mesh Links demo.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { Environment, FLOORS } from "./environment.js";
import { NavMeshGraph, LINK_TYPES } from "./navmesh.js";
import { AgentManager, AGENT_STATE } from "./agents.js";

installSystemMenu();

const canvas = document.getElementById('stage');
let scene = null;
try {
    scene = canvas.getContext('scene');
} catch (_) {
    scene = null;
}

// --- Orbit Camera Setup ---
const cam = Camera.createOrbit({
    target: [0, 2.8, 0],
    dist: 18.0,
    pitch: 28,
    yaw: 40,
    fov: 48,
    near: 0.1,
    far: 200
});

// --- 3D Scene Environment & Lighting Setup ---
if (scene) {
    scene.setAmbient([0.08, 0.10, 0.15]);
    scene.setToneMap({ mode: 'aces', exposure: 1.15 });

    // Directional Sun Light
    scene.createLight({
        type: 'directional',
        direction: [-0.6, -1.0, -0.4],
        color: [1.0, 0.98, 0.92],
        intensity: 2.2,
        castsShadow: true
    });

    // Cool Rim Light
    scene.createLight({
        type: 'directional',
        direction: [0.5, 0.4, 0.6],
        color: [0.35, 0.65, 0.95],
        intensity: 1.1
    });
}

// Fallback 2D Canvas Context
const ctx = scene ? null : canvas.getContext('2d');

// --- Instantiate Core Systems ---
const env = new Environment(scene);
const navGraph = new NavMeshGraph();
const agentManager = new AgentManager(scene, navGraph, env);

// Initial obstacle synchronization & agent squad spawn
navGraph.syncEnvironmentObstacles(env);
agentManager.spawnSquad(5);

// Send initial squad to Mezzanine
agentManager.sendAllTo(0, FLOORS.MEZZANINE, -6.0);

// --- Wire HTML Controls ---
// Gate Toggle
const btnToggleGate = document.getElementById('btn-toggle-gate');
btnToggleGate.addEventListener('click', () => {
    const isOpen = env.toggleGate();
    btnToggleGate.textContent = isOpen ? '🚪 Gate (Open)' : '🚪 Gate (Closed)';
    btnToggleGate.classList.toggle('active', isOpen);
});

// Bridge Toggle
const btnToggleBridge = document.getElementById('btn-toggle-bridge');
btnToggleBridge.addEventListener('click', () => {
    const isExtended = env.toggleBridge();
    btnToggleBridge.textContent = isExtended ? '🌉 Bridge (Open)' : '🌉 Bridge (Retracted)';
    btnToggleBridge.classList.toggle('active', isExtended);
});

// Barricade Toggle
const btnToggleBarricade = document.getElementById('btn-toggle-barricade');
btnToggleBarricade.addEventListener('click', () => {
    const isActive = env.toggleBarricade();
    btnToggleBarricade.textContent = isActive ? '📦 Barricade (Active)' : '📦 Barricade (Removed)';
    btnToggleBarricade.classList.toggle('active', isActive);
});

// Elevator Floor Calls
document.getElementById('btn-elev-0').addEventListener('click', () => env.callElevator(0));
document.getElementById('btn-elev-1').addEventListener('click', () => env.callElevator(1));
document.getElementById('btn-elev-2').addEventListener('click', () => env.callElevator(2));

// Quick Targets
document.getElementById('btn-target-south').addEventListener('click', () => {
    agentManager.sendAllTo(0, FLOORS.GROUND, 4.0);
});
document.getElementById('btn-target-north').addEventListener('click', () => {
    agentManager.sendAllTo(0, FLOORS.GROUND, -6.5);
});
document.getElementById('btn-target-mezz').addEventListener('click', () => {
    agentManager.sendAllTo(0, FLOORS.MEZZANINE, -6.0);
});
document.getElementById('btn-target-roof').addEventListener('click', () => {
    agentManager.sendAllTo(-1.0, FLOORS.ROOFTOP, 2.0);
});
document.getElementById('btn-target-island').addEventListener('click', () => {
    agentManager.sendAllTo(11.5, FLOORS.ROOFTOP, 2.0);
});

// Agent Spawners
const statAgents = document.getElementById('stat-agents');
document.getElementById('btn-spawn-1').addEventListener('click', () => {
    agentManager.spawnAgent(0, FLOORS.GROUND, 5.0);
    statAgents.textContent = agentManager.agents.length;
});
document.getElementById('btn-spawn-5').addEventListener('click', () => {
    agentManager.spawnSquad(5);
    statAgents.textContent = agentManager.agents.length;
});
document.getElementById('btn-clear-agents').addEventListener('click', () => {
    agentManager.clearAgents();
    statAgents.textContent = 0;
});

// Debug Toggles
const toggleNavNodes = document.getElementById('toggle-nav-nodes');
const togglePathLines = document.getElementById('toggle-path-lines');
const toggleLinkArcs = document.getElementById('toggle-link-arcs');

// Telemetry Elements
const statFps = document.getElementById('stat-fps');
const statTraversals = document.getElementById('stat-traversals');
const statElevFloor = document.getElementById('stat-elev-floor');

let lastTime = performance.now();
let frameCount = 0;
let fpsTimer = 0;

// Camera perspective 3D to 2D projection helper for Canvas 2D
function project3D(x, y, z, width, height) {
    const cy = Math.cos((cam.yaw * Math.PI) / 180);
    const sy = Math.sin((cam.yaw * Math.PI) / 180);
    const cp = Math.cos((cam.pitch * Math.PI) / 180);
    const sp = Math.sin((cam.pitch * Math.PI) / 180);

    const relX = x - cam.target[0];
    const relY = y - cam.target[1];
    const relZ = z - cam.target[2];

    const rx = relX * cy - relZ * sy;
    const rz = relX * sy + relZ * cy;
    const ry = relY * cp - rz * sp;
    const depth = relY * sp + rz * cp + cam.dist;

    const fovScale = 720 / Math.max(0.1, depth);
    return {
        x: width / 2 + rx * fovScale,
        y: height / 2 - ry * fovScale,
        depth
    };
}

// --- Main Simulation & Render Loop ---
function frame(now) {
    const dt = Math.min(0.04, (now - lastTime) / 1000);
    lastTime = now;

    // FPS Meter
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
        statFps.textContent = Math.round(frameCount / fpsTimer);
        frameCount = 0;
        fpsTimer = 0;
    }

    // 1. Update Environment Animations
    env.update(dt);

    // 2. Synchronize Dynamic Obstacle Carvings
    navGraph.syncEnvironmentObstacles(env);

    // 3. Update NPC Agents
    agentManager.update(dt);

    // 4. Update Telemetry
    statTraversals.textContent = agentManager.stats.traversals;
    statElevFloor.textContent = `F${env.elevator.currentFloor} (${env.elevator.y.toFixed(1)}m)`;

    // 5. Fallback Canvas 2D Rendering
    if (ctx) {
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, 1280, 720);

        // Draw Environment Blocks
        for (const b of env.blocks) {
            const p = project3D(b.x, b.y, b.z, 1280, 720);
            ctx.fillStyle = b.color;
            ctx.strokeStyle = '#32415d';
            ctx.lineWidth = 1;
            const wScaled = (b.w * 350) / Math.max(0.1, p.depth);
            const hScaled = (b.h * 350) / Math.max(0.1, p.depth);
            ctx.fillRect(p.x - wScaled / 2, p.y - hScaled / 2, wScaled, hScaled);
            ctx.strokeRect(p.x - wScaled / 2, p.y - hScaled / 2, wScaled, hScaled);
        }

        // Draw Gate
        const gateP = project3D(env.gate.pos.x, env.gate.pos.y + (env.gate.size.h / 2) + env.gate.progress * 3.0, env.gate.pos.z, 1280, 720);
        ctx.fillStyle = '#ff2850';
        ctx.fillRect(gateP.x - 30, gateP.y - 20, 60, 40);

        // Draw Bridge
        if (env.bridge.extended || env.bridge.progress > 0.05) {
            const bridgeX = 4.0 + (env.bridge.progress * 5.0) / 2;
            const brP = project3D(bridgeX, FLOORS.ROOFTOP, 2.0, 1280, 720);
            ctx.fillStyle = '#39ff14';
            ctx.fillRect(brP.x - (env.bridge.progress * 40), brP.y - 6, env.bridge.progress * 80, 12);
        }

        // Draw Elevator Cabin
        const elP = project3D(env.elevator.pos.x, env.elevator.y, env.elevator.pos.z, 1280, 720);
        ctx.fillStyle = '#00f0ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(elP.x - 22, elP.y - 22, 44, 44);
        ctx.strokeRect(elP.x - 22, elP.y - 22, 44, 44);

        // Draw Barricade
        if (env.barricade.active) {
            const barP = project3D(env.barricade.pos.x, env.barricade.pos.y + 0.6, env.barricade.pos.z, 1280, 720);
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(barP.x - 14, barP.y - 14, 28, 28);
        }

        // Draw NavMesh Nodes & Graph
        if (toggleNavNodes.checked) {
            for (const node of navGraph.nodes) {
                const p = project3D(node.x, node.y, node.z, 1280, 720);
                ctx.fillStyle = node.carved ? '#ff2850' : '#00f0ff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, node.carved ? 4 : 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Draw Edges
                if (!node.carved) {
                    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
                    ctx.lineWidth = 0.5;
                    for (const n of node.neighbors) {
                        const target = navGraph.nodes[n.id];
                        if (!target.carved && !n.link) {
                            const p2 = project3D(target.x, target.y, target.z, 1280, 720);
                            ctx.beginPath();
                            ctx.moveTo(p.x, p.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.stroke();
                        }
                    }
                }
            }
        }

        // Draw Off-Mesh Links (Ladder, Jump Arc, Elevator Lines)
        if (toggleLinkArcs.checked) {
            for (const link of navGraph.links) {
                const pStart = project3D(link.startPos.x, link.startPos.y, link.startPos.z, 1280, 720);
                const pEnd = project3D(link.endPos.x, link.endPos.y, link.endPos.z, 1280, 720);

                if (link.type === LINK_TYPES.JUMP) {
                    // Parabolic arc
                    ctx.strokeStyle = '#39ff14';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    for (let step = 0; step <= 20; step++) {
                        const t = step / 20;
                        const jx = link.startPos.x + (link.endPos.x - link.startPos.x) * t;
                        const jz = link.startPos.z + (link.endPos.z - link.startPos.z) * t;
                        const jy = link.startPos.y + (link.endPos.y - link.startPos.y) * t + 4.0 * t * (1 - t) * 3.5;
                        const pt = project3D(jx, jy, jz, 1280, 720);
                        if (step === 0) ctx.moveTo(pt.x, pt.y);
                        else ctx.lineTo(pt.x, pt.y);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else if (link.type === LINK_TYPES.LADDER) {
                    ctx.strokeStyle = '#f59e0b';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(pStart.x, pStart.y);
                    ctx.lineTo(pEnd.x, pEnd.y);
                    ctx.stroke();
                } else if (link.type === LINK_TYPES.ELEVATOR) {
                    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 4]);
                    ctx.beginPath();
                    ctx.moveTo(pStart.x, pStart.y);
                    ctx.lineTo(pEnd.x, pEnd.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        }

        // Draw Agents and Path Lines
        for (const a of agentManager.agents) {
            // Draw Path Waypoints
            if (togglePathLines.checked && a.path.length > 0) {
                ctx.strokeStyle = a.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                const curP = project3D(a.x, a.y, a.z, 1280, 720);
                ctx.moveTo(curP.x, curP.y);

                for (let i = a.waypointIndex; i < a.path.length; i++) {
                    const wp = a.path[i];
                    const wpP = project3D(wp.x, wp.y, wp.z, 1280, 720);
                    ctx.lineTo(wpP.x, wpP.y);
                }
                ctx.stroke();
            }

            // Draw Agent Marker
            const ap = project3D(a.x, a.y, a.z, 1280, 720);
            ctx.fillStyle = a.color;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(ap.x, ap.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw State tag above agent
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '10px monospace';
            ctx.fillText(a.state, ap.x - 16, ap.y - 10);
        }
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
