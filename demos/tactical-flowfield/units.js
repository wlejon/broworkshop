// units.js — Mass unit simulation, formation offsets, steering behaviors, and fast batch rendering.

import { TERRAIN } from "./flowfield.js";

export const FORMATIONS = {
    BOX: 'Box',
    WEDGE: 'Wedge',
    CIRCLE: 'Circle',
    FLANK: 'Flank'
};

/**
 * Computes relative (dx, dy) formation slot offsets for N units given a formation type and facing angle.
 */
export function computeFormationOffsets(formationType, count, facingAngle = 0, spacing = 12) {
    const offsets = new Array(count);
    const cosA = Math.cos(facingAngle);
    const sinA = Math.sin(facingAngle);

    function rotate(lx, ly) {
        return {
            x: lx * cosA - ly * sinA,
            y: lx * sinA + ly * cosA
        };
    }

    switch (formationType) {
        case FORMATIONS.WEDGE: {
            // Delta / inverted V formation
            offsets[0] = rotate(0, 0); // Leader at apex
            let row = 1;
            let i = 1;
            while (i < count) {
                // Left wing
                if (i < count) {
                    offsets[i] = rotate(-row * spacing * 0.85, -row * spacing * 0.85);
                    i++;
                }
                // Right wing
                if (i < count) {
                    offsets[i] = rotate(row * spacing * 0.85, -row * spacing * 0.85);
                    i++;
                }
                row++;
            }
            break;
        }
        case FORMATIONS.CIRCLE: {
            // Concentric defensive circles
            let ring = 0;
            let allocated = 0;
            while (allocated < count) {
                if (ring === 0) {
                    offsets[allocated++] = rotate(0, 0);
                } else {
                    const ringRadius = ring * spacing * 1.1;
                    const ringCap = Math.max(6, Math.floor((2 * Math.PI * ringRadius) / spacing));
                    const inThisRing = Math.min(ringCap, count - allocated);
                    for (let j = 0; j < inThisRing; j++) {
                        const theta = (j / inThisRing) * Math.PI * 2;
                        offsets[allocated++] = rotate(Math.cos(theta) * ringRadius, Math.sin(theta) * ringRadius);
                    }
                }
                ring++;
            }
            break;
        }
        case FORMATIONS.FLANK: {
            // Pincer / split wing formation with center anchor
            let i = 0;
            offsets[i++] = rotate(0, 0); // Lead commander
            const wingUnits = Math.floor((count - 1) / 2);
            // Left wing
            for (let w = 0; w < wingUnits && i < count; w++) {
                const col = w % 3;
                const row = Math.floor(w / 3);
                offsets[i++] = rotate(-spacing * 3 - col * spacing, -row * spacing);
            }
            // Right wing
            for (let w = 0; w < wingUnits && i < count; w++) {
                const col = w % 3;
                const row = Math.floor(w / 3);
                offsets[i++] = rotate(spacing * 3 + col * spacing, -row * spacing);
            }
            // Fill any remainder in center
            while (i < count) {
                offsets[i] = rotate(0, -(i - 2 * wingUnits) * spacing);
                i++;
            }
            break;
        }
        case FORMATIONS.BOX:
        default: {
            // Classic ranked box / column
            const cols = Math.max(5, Math.ceil(Math.sqrt(count * 1.5)));
            for (let i = 0; i < count; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const lx = (col - (cols - 1) / 2) * spacing;
                const ly = -row * spacing;
                offsets[i] = rotate(lx, ly);
            }
            break;
        }
    }

    return offsets;
}

export class UnitManager {
    constructor(maxUnits = 5000, bounds = { width: 1280, height: 720 }) {
        this.maxUnits = maxUnits;
        this.bounds = bounds;
        this.unitCount = 1000;

        // Flat typed arrays for cache-friendly fast mass updates
        this.x = new Float32Array(maxUnits);
        this.y = new Float32Array(maxUnits);
        this.vx = new Float32Array(maxUnits);
        this.vy = new Float32Array(maxUnits);
        this.slotX = new Float32Array(maxUnits);
        this.slotY = new Float32Array(maxUnits);
        this.targetDist = new Float32Array(maxUnits);
        this.unitRadius = 2.8;

        // Formation state
        this.formationType = FORMATIONS.BOX;
        this.formationSpacing = 12;
        this.anchorX = bounds.width * 0.5;
        this.anchorY = bounds.height * 0.5;
        this.facingAngle = 0;

        // Parameters
        this.maxSpeed = 2.4;
        this.maxForce = 0.18;
        this.flowWeight = 1.0;
        this.formationWeight = 0.65;
        this.separationWeight = 0.85;
        this.alignmentWeight = 0.25;
        this.threatWeight = 1.2;

        // Spatial Hash for O(1) separation queries
        this.gridCellSize = 16;
        this.gridCols = Math.ceil(bounds.width / this.gridCellSize);
        this.gridRows = Math.ceil(bounds.height / this.gridCellSize);
        this.gridTotal = this.gridCols * this.gridRows;
        this.gridHead = new Int32Array(this.gridTotal);
        this.gridNext = new Int32Array(maxUnits);

        this.initUnits();
    }

    initUnits() {
        const startX = 120;
        const startY = this.bounds.height * 0.5;

        for (let i = 0; i < this.maxUnits; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * 80;
            this.x[i] = Math.max(20, Math.min(this.bounds.width - 20, startX + Math.cos(angle) * dist));
            this.y[i] = Math.max(20, Math.min(this.bounds.height - 20, startY + Math.sin(angle) * dist));
            this.vx[i] = (Math.random() - 0.5) * 0.5;
            this.vy[i] = (Math.random() - 0.5) * 0.5;
            this.slotX[i] = this.x[i];
            this.slotY[i] = this.y[i];
        }

        this.updateFormationSlots();
    }

    setUnitCount(count) {
        this.unitCount = Math.max(10, Math.min(this.maxUnits, count));
        this.updateFormationSlots();
    }

    setFormation(type) {
        this.formationType = type;
        this.updateFormationSlots();
    }

    setAnchor(ax, ay, facing = null) {
        if (facing !== null) {
            this.facingAngle = facing;
        } else {
            // Face along motion vector from previous anchor
            const dx = ax - this.anchorX;
            const dy = ay - this.anchorY;
            if (Math.hypot(dx, dy) > 2) {
                this.facingAngle = Math.atan2(dy, dx);
            }
        }
        this.anchorX = ax;
        this.anchorY = ay;
        this.updateFormationSlots();
    }

    updateFormationSlots() {
        const offsets = computeFormationOffsets(
            this.formationType,
            this.unitCount,
            this.facingAngle,
            this.formationSpacing
        );

        for (let i = 0; i < this.unitCount; i++) {
            const off = offsets[i] || { x: 0, y: 0 };
            this.slotX[i] = Math.max(10, Math.min(this.bounds.width - 10, this.anchorX + off.x));
            this.slotY[i] = Math.max(10, Math.min(this.bounds.height - 10, this.anchorY + off.y));
        }
    }

    // --- Spatial Hash Update ---
    buildSpatialGrid() {
        this.gridHead.fill(-1);
        const gCols = this.gridCols;
        const gRows = this.gridRows;
        const cs = this.gridCellSize;
        const count = this.unitCount;

        for (let i = 0; i < count; i++) {
            const gx = Math.max(0, Math.min(gCols - 1, (this.x[i] / cs) | 0));
            const gy = Math.max(0, Math.min(gRows - 1, (this.y[i] / cs) | 0));
            const cellIdx = gy * gCols + gx;

            this.gridNext[i] = this.gridHead[cellIdx];
            this.gridHead[cellIdx] = i;
        }
    }

    // --- Physics & Steering Simulation Tick ---
    tick(flowField, influenceMap, dt = 1 / 60) {
        this.buildSpatialGrid();

        const count = this.unitCount;
        const maxSpd = this.maxSpeed;
        const maxF = this.maxForce;
        const fWeight = this.flowWeight;
        const formWeight = this.formationWeight;
        const sepWeight = this.separationWeight;
        const alignWeight = this.alignmentWeight;
        const threatWeight = this.threatWeight;
        const neighborDist = this.unitRadius * 3.2;
        const neighborDistSq = neighborDist * neighborDist;
        const gCols = this.gridCols;
        const gRows = this.gridRows;
        const cs = this.gridCellSize;

        const flowVec = { x: 0, y: 0 };

        for (let i = 0; i < count; i++) {
            const px = this.x[i];
            const py = this.y[i];
            const vx = this.vx[i];
            const vy = this.vy[i];

            let steerX = 0;
            let steerY = 0;

            // 1. Flow Field Navigation Force
            flowField.sampleFlow(px, py, flowVec);
            const distToGoal = flowField.getDistanceAt(px, py);
            this.targetDist[i] = distToGoal;

            if (flowVec.x !== 0 || flowVec.y !== 0) {
                // Desired velocity in flow direction
                let desiredSpeed = maxSpd;
                // Arrival deceleration near goal
                if (distToGoal < 30) {
                    desiredSpeed = (distToGoal / 30) * maxSpd;
                }
                const desiredVx = flowVec.x * desiredSpeed;
                const desiredVy = flowVec.y * desiredSpeed;
                steerX += (desiredVx - vx) * fWeight;
                steerY += (desiredVy - vy) * fWeight;
            }

            // 2. Formation Slot Attraction
            const targetX = this.slotX[i];
            const targetY = this.slotY[i];
            const toSlotX = targetX - px;
            const toSlotY = targetY - py;
            const slotDist = Math.hypot(toSlotX, toSlotY);

            if (slotDist > 2) {
                const slotDesiredSpd = Math.min(maxSpd * 1.3, slotDist * 0.1);
                const sNormX = (toSlotX / slotDist) * slotDesiredSpd;
                const sNormY = (toSlotY / slotDist) * slotDesiredSpd;
                steerX += (sNormX - vx) * formWeight;
                steerY += (sNormY - vy) * formWeight;
            }

            // 3. Local Separation & Flocking Alignment (using spatial hash)
            const gx = Math.max(0, Math.min(gCols - 1, (px / cs) | 0));
            const gy = Math.max(0, Math.min(gRows - 1, (py / cs) | 0));

            let sepX = 0, sepY = 0;
            let alignVx = 0, alignVy = 0;
            let neighborCount = 0;

            for (let dy = -1; dy <= 1; dy++) {
                const ny = gy + dy;
                if (ny < 0 || ny >= gRows) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = gx + dx;
                    if (nx < 0 || nx >= gCols) continue;

                    let other = this.gridHead[ny * gCols + nx];
                    while (other !== -1) {
                        if (other !== i) {
                            const diffX = px - this.x[other];
                            const diffY = py - this.y[other];
                            const dSq = diffX * diffX + diffY * diffY;

                            if (dSq > 1e-4 && dSq < neighborDistSq) {
                                const d = Math.sqrt(dSq);
                                const push = (neighborDist - d) / neighborDist;
                                sepX += (diffX / d) * push;
                                sepY += (diffY / d) * push;

                                alignVx += this.vx[other];
                                alignVy += this.vy[other];
                                neighborCount++;
                            }
                        }
                        other = this.gridNext[other];
                    }
                }
            }

            if (neighborCount > 0) {
                steerX += sepX * sepWeight;
                steerY += sepY * sepWeight;

                alignVx /= neighborCount;
                alignVy /= neighborCount;
                steerX += (alignVx - vx) * alignWeight;
                steerY += (alignVy - vy) * alignWeight;
            }

            // 4. Tactical Threat Avoidance
            if (influenceMap.threatSources.length > 0) {
                const threatVal = influenceMap.sampleThreat(px, py);
                if (threatVal > 0.05) {
                    // Probe threat gradient
                    const step = 8;
                    const threatLeft = influenceMap.sampleThreat(px - step, py);
                    const threatRight = influenceMap.sampleThreat(px + step, py);
                    const threatUp = influenceMap.sampleThreat(px, py - step);
                    const threatDown = influenceMap.sampleThreat(px, py + step);

                    const escapeX = threatLeft - threatRight;
                    const escapeY = threatUp - threatDown;
                    const escapeLen = Math.hypot(escapeX, escapeY);
                    if (escapeLen > 1e-3) {
                        steerX += (escapeX / escapeLen) * threatWeight * threatVal;
                        steerY += (escapeY / escapeLen) * threatWeight * threatVal;
                    }
                }
            }

            // Clamp steering force
            const steerMag = Math.hypot(steerX, steerY);
            if (steerMag > maxF) {
                steerX = (steerX / steerMag) * maxF;
                steerY = (steerY / steerMag) * maxF;
            }

            // Integrate velocity
            let nvx = vx + steerX;
            let nvy = vy + steerY;

            // Clamp velocity to maxSpeed
            const spd = Math.hypot(nvx, nvy);
            if (spd > maxSpd) {
                nvx = (nvx / spd) * maxSpd;
                nvy = (nvy / spd) * maxSpd;
            }

            // Damping in rough terrain
            const currentCost = flowField.getCost(Math.floor(px / flowField.cellSize), Math.floor(py / flowField.cellSize));
            if (currentCost === TERRAIN.ROUGH) {
                nvx *= 0.5;
                nvy *= 0.5;
            }

            // Integrate position
            let nextPx = px + nvx;
            let nextPy = py + nvy;

            // Wall collision response (slide along obstacles)
            const nextGx = Math.floor(nextPx / flowField.cellSize);
            const nextGy = Math.floor(nextPy / flowField.cellSize);
            if (flowField.getCost(nextGx, nextGy) >= TERRAIN.IMPASSABLE) {
                // Try sliding on X only
                if (flowField.getCost(nextGx, Math.floor(py / flowField.cellSize)) < TERRAIN.IMPASSABLE) {
                    nextPy = py;
                    nvy = -nvy * 0.2;
                }
                // Try sliding on Y only
                else if (flowField.getCost(Math.floor(px / flowField.cellSize), nextGy) < TERRAIN.IMPASSABLE) {
                    nextPx = px;
                    nvx = -nvx * 0.2;
                } else {
                    // Fully blocked: bounce back
                    nextPx = px;
                    nextPy = py;
                    nvx = 0;
                    nvy = 0;
                }
            }

            // Bounds constrain
            nextPx = Math.max(12, Math.min(this.bounds.width - 12, nextPx));
            nextPy = Math.max(12, Math.min(this.bounds.height - 12, nextPy));

            this.x[i] = nextPx;
            this.y[i] = nextPy;
            this.vx[i] = nvx;
            this.vy[i] = nvy;
        }
    }

    // --- Fast Batch Canvas 2D Rendering ---
    render(ctx) {
        const count = this.unitCount;
        const rad = this.unitRadius;

        // Render formation ghost slots if units are in motion
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < count; i += Math.max(1, (count / 200) | 0)) {
            ctx.rect(this.slotX[i] - 1.5, this.slotY[i] - 1.5, 3, 3);
        }
        ctx.stroke();

        // Render Unit Glyphs
        // Group render paths by heading quadrant or render with fast directional chevrons
        ctx.fillStyle = '#00f0ff';
        ctx.strokeStyle = '#006688';
        ctx.lineWidth = 1;

        for (let i = 0; i < count; i++) {
            const px = this.x[i];
            const py = this.y[i];
            const vx = this.vx[i];
            const vy = this.vy[i];
            const spd = Math.hypot(vx, vy);

            if (spd > 0.15) {
                const heading = Math.atan2(vy, vx);
                const cosH = Math.cos(heading);
                const sinH = Math.sin(heading);

                // Sleek tactical chevron triangle
                ctx.beginPath();
                const tipX = px + cosH * (rad * 1.5);
                const tipY = py + sinH * (rad * 1.5);
                const leftX = px - cosH * rad - sinH * (rad * 0.9);
                const leftY = py - sinH * rad + cosH * (rad * 0.9);
                const rightX = px - cosH * rad + sinH * (rad * 0.9);
                const rightY = py - sinH * rad - cosH * (rad * 0.9);

                ctx.moveTo(tipX, tipY);
                ctx.lineTo(leftX, leftY);
                ctx.lineTo(px - cosH * (rad * 0.4), py - sinH * (rad * 0.4));
                ctx.lineTo(rightX, rightY);
                ctx.closePath();
                ctx.fill();
            } else {
                // Idle circle dot
                ctx.beginPath();
                ctx.arc(px, py, rad * 0.9, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}
