// sim_worker.js — Background Web Worker physics simulation engine with zero-copy binary buffer transfers
import {
    MSG_INIT, MSG_CONFIG, MSG_MOUSE, MSG_FRAME, MSG_RECYCLE_BUFFER,
    MSG_PAUSE, MSG_RESUME, MSG_STEP, MSG_RESET,
    MODE_BOIDS, MODE_PARTICLES, MODE_GRAVITY,
    ENT_STRIDE, OFFSET_X, OFFSET_Y, OFFSET_VX, OFFSET_VY, OFFSET_MASS, OFFSET_COLOR,
    createEntityBuffer
} from './protocol.js';

let width = 1280;
let height = 720;
let entityCount = 4000;
let mode = MODE_BOIDS;
let isRunning = true;

// Simulation parameters
let speedScale = 1.0;
let damping = 0.99;
let mouseX = -1000;
let mouseY = -1000;
let mouseActive = false;
let mouseButton = 0; // 0 = attract, 2 = repel, 1 = vortex

// Buffers
let activeBuffer = null;
let recycledBuffers = [];

// Spatial Grid Partitioning
const CELL_SIZE = 40;
let gridCols = Math.ceil(width / CELL_SIZE);
let gridRows = Math.ceil(height / CELL_SIZE);
let gridHead = new Int32Array(gridCols * gridRows);
let gridNext = new Int32Array(25000);

// Performance tracking
let lastTime = performance.now();
let tickCount = 0;
let tps = 0;
let lastTpsTime = performance.now();
let stepTimeMs = 0;

function initSimulation() {
    activeBuffer = createEntityBuffer(entityCount);
    recycledBuffers = [createEntityBuffer(entityCount)];

    gridCols = Math.ceil(width / CELL_SIZE);
    gridRows = Math.ceil(height / CELL_SIZE);
    gridHead = new Int32Array(gridCols * gridRows);
    gridNext = new Int32Array(Math.max(25000, entityCount + 100));

    // Seed entities
    for (let i = 0; i < entityCount; i++) {
        const off = i * ENT_STRIDE;
        activeBuffer[off + OFFSET_X] = Math.random() * width;
        activeBuffer[off + OFFSET_Y] = Math.random() * height;

        const ang = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 80;
        activeBuffer[off + OFFSET_VX] = Math.cos(ang) * sp;
        activeBuffer[off + OFFSET_VY] = Math.sin(ang) * sp;

        activeBuffer[off + OFFSET_MASS] = 1.0 + Math.random() * 2.0;
        activeBuffer[off + OFFSET_COLOR] = Math.random() * 360;
    }
}

function updateSpatialGrid(buf, count) {
    gridHead.fill(-1);
    const numCells = gridHead.length;

    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        const x = buf[off + OFFSET_X];
        const y = buf[off + OFFSET_Y];

        const gx = Math.max(0, Math.min(gridCols - 1, Math.floor(x / CELL_SIZE)));
        const gy = Math.max(0, Math.min(gridRows - 1, Math.floor(y / CELL_SIZE)));
        const cellIdx = gy * gridCols + gx;

        if (cellIdx >= 0 && cellIdx < numCells) {
            gridNext[i] = gridHead[cellIdx];
            gridHead[cellIdx] = i;
        }
    }
}

function stepSimulation(dt) {
    if (!activeBuffer) return;
    const t0 = performance.now();
    const buf = activeBuffer;
    const count = entityCount;

    updateSpatialGrid(buf, count);

    if (mode === MODE_BOIDS) {
        stepBoids(buf, count, dt);
    } else if (mode === MODE_PARTICLES) {
        stepParticles(buf, count, dt);
    } else if (mode === MODE_GRAVITY) {
        stepGravity(buf, count, dt);
    }

    // Apply mouse interaction force
    if (mouseActive) {
        applyMouseForce(buf, count, dt);
    }

    // Integrate velocities & boundary wrap/bounce
    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        let x = buf[off + OFFSET_X];
        let y = buf[off + OFFSET_Y];
        let vx = buf[off + OFFSET_VX];
        let vy = buf[off + OFFSET_VY];

        x += vx * dt * speedScale;
        y += vy * dt * speedScale;

        if (mode === MODE_BOIDS || mode === MODE_GRAVITY) {
            // Toroidal wrap
            if (x < 0) x += width;
            else if (x >= width) x -= width;
            if (y < 0) y += height;
            else if (y >= height) y -= height;
        } else {
            // Wall bounce
            if (x < 6) { x = 6; vx = -vx * 0.85; }
            else if (x > width - 6) { x = width - 6; vx = -vx * 0.85; }
            if (y < 6) { y = 6; vy = -vy * 0.85; }
            else if (y > height - 6) { y = height - 6; vy = -vy * 0.85; }
        }

        buf[off + OFFSET_X] = x;
        buf[off + OFFSET_Y] = y;
        buf[off + OFFSET_VX] = vx;
        buf[off + OFFSET_VY] = vy;
    }

    stepTimeMs = performance.now() - t0;
    tickCount++;

    // Calculate TPS
    const now = performance.now();
    if (now - lastTpsTime >= 500) {
        tps = Math.round((tickCount * 1000) / (now - lastTpsTime));
        tickCount = 0;
        lastTpsTime = now;
    }
}

// 1. Boids Flocking Simulation
function stepBoids(buf, count, dt) {
    const visualRange = 40;
    const visualRangeSq = visualRange * visualRange;
    const minDistance = 14;
    const minDistanceSq = minDistance * minDistance;

    const maxSpeed = 160;
    const minSpeed = 50;

    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        const x = buf[off + OFFSET_X];
        const y = buf[off + OFFSET_Y];
        let vx = buf[off + OFFSET_VX];
        let vy = buf[off + OFFSET_VY];

        let centerX = 0, centerY = 0, numNeighbors = 0;
        let avgVx = 0, avgVy = 0;
        let closeDx = 0, closeDy = 0;

        const gx = Math.floor(x / CELL_SIZE);
        const gy = Math.floor(y / CELL_SIZE);

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = gx + dx;
                const cy = gy + dy;
                if (cx < 0 || cx >= gridCols || cy < 0 || cy >= gridRows) continue;

                let other = gridHead[cy * gridCols + cx];
                while (other !== -1) {
                    if (other !== i) {
                        const oOff = other * ENT_STRIDE;
                        const ox = buf[oOff + OFFSET_X];
                        const oy = buf[oOff + OFFSET_Y];
                        const distSq = (x - ox) * (x - ox) + (y - oy) * (y - oy);

                        if (distSq < visualRangeSq) {
                            if (distSq < minDistanceSq) {
                                closeDx += x - ox;
                                closeDy += y - oy;
                            } else {
                                centerX += ox;
                                centerY += oy;
                                avgVx += buf[oOff + OFFSET_VX];
                                avgVy += buf[oOff + OFFSET_VY];
                                numNeighbors++;
                            }
                        }
                    }
                    other = gridNext[other];
                }
            }
        }

        // Apply Boid Rules
        if (numNeighbors > 0) {
            centerX /= numNeighbors;
            centerY /= numNeighbors;
            avgVx /= numNeighbors;
            avgVy /= numNeighbors;

            // Cohesion + Alignment
            vx += (centerX - x) * 0.015 + (avgVx - vx) * 0.04;
            vy += (centerY - y) * 0.015 + (avgVy - vy) * 0.04;
        }

        // Separation
        vx += closeDx * 0.06;
        vy += closeDy * 0.06;

        // Speed Clamping
        const speed = Math.sqrt(vx * vx + vy * vy) || 1;
        if (speed > maxSpeed) {
            vx = (vx / speed) * maxSpeed;
            vy = (vy / speed) * maxSpeed;
        } else if (speed < minSpeed) {
            vx = (vx / speed) * minSpeed;
            vy = (vy / speed) * minSpeed;
        }

        // Color based on velocity heading
        buf[off + OFFSET_COLOR] = ((Math.atan2(vy, vx) + Math.PI) / (Math.PI * 2)) * 360;
        buf[off + OFFSET_VX] = vx;
        buf[off + OFFSET_VY] = vy;
    }
}

// 2. Elastic Particle Collision Simulation
function stepParticles(buf, count, dt) {
    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        const x = buf[off + OFFSET_X];
        const y = buf[off + OFFSET_Y];
        let vx = buf[off + OFFSET_VX] * damping;
        let vy = buf[off + OFFSET_VY] * damping + 25 * dt; // gravity

        const gx = Math.floor(x / CELL_SIZE);
        const gy = Math.floor(y / CELL_SIZE);

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = gx + dx;
                const cy = gy + dy;
                if (cx < 0 || cx >= gridCols || cy < 0 || cy >= gridRows) continue;

                let other = gridHead[cy * gridCols + cx];
                while (other !== -1) {
                    if (other > i) {
                        const oOff = other * ENT_STRIDE;
                        const ox = buf[oOff + OFFSET_X];
                        const oy = buf[oOff + OFFSET_Y];
                        const dx2 = x - ox;
                        const dy2 = y - oy;
                        const distSq = dx2 * dx2 + dy2 * dy2;

                        if (distSq < 144 && distSq > 0.001) { // radius ~6
                            const dist = Math.sqrt(distSq);
                            const overlap = 0.5 * (12 - dist);
                            const nx = dx2 / dist;
                            const ny = dy2 / dist;

                            vx += nx * overlap * 12;
                            vy += ny * overlap * 12;
                            buf[oOff + OFFSET_VX] -= nx * overlap * 12;
                            buf[oOff + OFFSET_VY] -= ny * overlap * 12;
                        }
                    }
                    other = gridNext[other];
                }
            }
        }

        const sp = Math.sqrt(vx * vx + vy * vy);
        buf[off + OFFSET_COLOR] = Math.min(360, sp * 1.5);
        buf[off + OFFSET_VX] = vx;
        buf[off + OFFSET_VY] = vy;
    }
}

// 3. Gravitational N-Body Simulation
function stepGravity(buf, count, dt) {
    const cx = width / 2;
    const cy = height / 2;
    const centralMass = 8000;

    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        const x = buf[off + OFFSET_X];
        const y = buf[off + OFFSET_Y];
        let vx = buf[off + OFFSET_VX];
        let vy = buf[off + OFFSET_VY];

        // Central gravitational attraction
        const dx = cx - x;
        const dy = cy - y;
        const distSq = dx * dx + dy * dy + 800; // softening
        const dist = Math.sqrt(distSq);
        const f = (centralMass / distSq) * dt * 25;

        vx += (dx / dist) * f;
        vy += (dy / dist) * f;

        const sp = Math.sqrt(vx * vx + vy * vy);
        buf[off + OFFSET_COLOR] = 180 + Math.min(180, sp * 1.8);
        buf[off + OFFSET_VX] = vx;
        buf[off + OFFSET_VY] = vy;
    }
}

function applyMouseForce(buf, count, dt) {
    const radius = 220;
    const radiusSq = radius * radius;

    for (let i = 0; i < count; i++) {
        const off = i * ENT_STRIDE;
        const x = buf[off + OFFSET_X];
        const y = buf[off + OFFSET_Y];
        const dx = mouseX - x;
        const dy = mouseY - y;
        const distSq = dx * dx + dy * dy;

        if (distSq < radiusSq && distSq > 4) {
            const dist = Math.sqrt(distSq);
            const strength = (1.0 - dist / radius) * 450 * dt;

            if (mouseButton === 0) {
                // Attract
                buf[off + OFFSET_VX] += (dx / dist) * strength;
                buf[off + OFFSET_VY] += (dy / dist) * strength;
            } else if (mouseButton === 2) {
                // Repel
                buf[off + OFFSET_VX] -= (dx / dist) * strength * 1.5;
                buf[off + OFFSET_VY] -= (dy / dist) * strength * 1.5;
            } else if (mouseButton === 1) {
                // Vortex / Whirlpool
                buf[off + OFFSET_VX] += (-dy / dist) * strength * 1.4;
                buf[off + OFFSET_VY] += (dx / dist) * strength * 1.4;
            }
        }
    }
}

// Worker fixed-timestep loop
function tick() {
    if (isRunning && activeBuffer) {
        stepSimulation(1.0 / 60.0);

        // Zero-copy transfer active buffer to main thread
        const transferable = activeBuffer.buffer;
        self.postMessage({
            type: MSG_FRAME,
            buffer: transferable,
            count: entityCount,
            tps: tps,
            stepTimeMs: stepTimeMs
        }, [transferable]);

        // Swap to recycled buffer
        activeBuffer = recycledBuffers.pop() || createEntityBuffer(entityCount);
    }

    setTimeout(tick, 1000 / 60);
}

// Handle messages from Main Thread
self.onmessage = function (e) {
    const msg = e.data;
    if (!msg) return;

    switch (msg.type) {
        case MSG_INIT:
            width = msg.width || width;
            height = msg.height || height;
            entityCount = msg.count || entityCount;
            mode = msg.mode || mode;
            initSimulation();
            tick();
            break;

        case MSG_CONFIG:
            if (msg.count && msg.count !== entityCount) {
                entityCount = msg.count;
                initSimulation();
            }
            if (msg.mode) mode = msg.mode;
            if (msg.speedScale != null) speedScale = msg.speedScale;
            break;

        case MSG_MOUSE:
            mouseX = msg.x;
            mouseY = msg.y;
            mouseActive = msg.active;
            mouseButton = msg.button || 0;
            break;

        case MSG_RECYCLE_BUFFER:
            if (msg.buffer && msg.buffer.byteLength === entityCount * ENT_STRIDE * 4) {
                recycledBuffers.push(new Float32Array(msg.buffer));
            }
            break;

        case MSG_PAUSE:
            isRunning = false;
            break;

        case MSG_RESUME:
            isRunning = true;
            break;

        case MSG_STEP:
            stepSimulation(1.0 / 60.0);
            break;

        case MSG_RESET:
            initSimulation();
            break;
    }
};
