// ui.js — Mouse interactions, painting brushes, overlay rendering, and tactical HUD controls.

import { TERRAIN } from "./flowfield.js";
import { FORMATIONS } from "./units.js";

export const TOOLS = {
    GOAL: 'goal',
    WALL: 'wall',
    ROUGH: 'rough',
    ERASE: 'erase',
    THREAT: 'threat'
};

export class TacticalUI {
    constructor(canvas, flowField, influenceMap, unitManager) {
        this.canvas = canvas;
        this.flowField = flowField;
        this.influenceMap = influenceMap;
        this.unitManager = unitManager;

        // Active tool & brush settings
        this.activeTool = TOOLS.GOAL;
        this.brushRadius = 24;
        this.isMouseDown = false;
        this.mousePos = { x: 0, y: 0 };
        this.lastPaintPos = null;

        // Overlay options
        this.showFlowVectors = true;
        this.showIntegration = false;
        this.showInfluence = false;
        this.showChokePoints = true;

        this.bindEvents();
    }

    bindEvents() {
        const c = this.canvas;

        const getPos = (e) => {
            const rect = c.getBoundingClientRect();
            const scaleX = c.width / rect.width;
            const scaleY = c.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        c.addEventListener('mousedown', (e) => {
            this.isMouseDown = true;
            this.mousePos = getPos(e);
            this.handlePointerAction(this.mousePos, e.button === 2);
        });

        window.addEventListener('mousemove', (e) => {
            this.mousePos = getPos(e);
            if (this.isMouseDown) {
                this.handlePointerDrag(this.mousePos);
            }
        });

        window.addEventListener('mouseup', () => {
            this.isMouseDown = false;
            this.lastPaintPos = null;
        });

        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const pos = getPos(e);
            // Right-click always places or moves Goal Anchor
            this.placeGoalAnchor(pos.x, pos.y);
        });
    }

    handlePointerAction(pos, isRightClick = false) {
        if (isRightClick || this.activeTool === TOOLS.GOAL) {
            this.placeGoalAnchor(pos.x, pos.y);
        } else if (this.activeTool === TOOLS.WALL) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.IMPASSABLE);
        } else if (this.activeTool === TOOLS.ROUGH) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.ROUGH);
        } else if (this.activeTool === TOOLS.ERASE) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.OPEN);
        } else if (this.activeTool === TOOLS.THREAT) {
            this.influenceMap.addThreat(pos.x, pos.y, 140, 1.2);
        }
    }

    handlePointerDrag(pos) {
        if (this.activeTool === TOOLS.WALL) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.IMPASSABLE);
        } else if (this.activeTool === TOOLS.ROUGH) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.ROUGH);
        } else if (this.activeTool === TOOLS.ERASE) {
            this.flowField.setBrush(pos.x, pos.y, this.brushRadius, TERRAIN.OPEN);
        } else if (this.activeTool === TOOLS.GOAL) {
            // Dragging in goal mode adjusts facing direction
            const dx = pos.x - this.unitManager.anchorX;
            const dy = pos.y - this.unitManager.anchorY;
            if (Math.hypot(dx, dy) > 10) {
                const facing = Math.atan2(dy, dx);
                this.unitManager.setAnchor(this.unitManager.anchorX, this.unitManager.anchorY, facing);
            }
        }
    }

    placeGoalAnchor(wx, wy) {
        this.unitManager.setAnchor(wx, wy);
        this.flowField.clearGoals();
        this.flowField.addGoal(wx, wy);
    }

    // --- Overlay Visualizations ---
    renderOverlays(ctx) {
        const ff = this.flowField;
        const im = this.influenceMap;
        const cs = ff.cellSize;

        // 1. Draw Cost Field / Obstacles / Rough Terrain
        for (let y = 0; y < ff.rows; y++) {
            for (let x = 0; x < ff.cols; x++) {
                const idx = y * ff.cols + x;
                const cost = ff.cost[idx];
                const px = x * cs;
                const py = y * cs;

                if (cost >= TERRAIN.IMPASSABLE) {
                    ctx.fillStyle = '#1c2438';
                    ctx.fillRect(px, py, cs, cs);
                    ctx.strokeStyle = '#2d3b59';
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
                } else if (cost === TERRAIN.ROUGH) {
                    ctx.fillStyle = 'rgba(180, 110, 30, 0.28)';
                    ctx.fillRect(px, py, cs, cs);
                }
            }
        }

        // 2. Draw Integration Heatmap Overlay
        if (this.showIntegration && ff.goals.length > 0) {
            for (let y = 0; y < ff.rows; y += 2) {
                for (let x = 0; x < ff.cols; x += 2) {
                    const idx = y * ff.cols + x;
                    const val = ff.integration[idx];
                    if (val < 1e5 && ff.cost[idx] < TERRAIN.IMPASSABLE) {
                        const norm = Math.min(1, val / 400);
                        // Blue-Cyan-Green-Red gradient
                        const r = Math.floor(norm * 255);
                        const g = Math.floor((1 - Math.abs(norm - 0.5) * 2) * 200);
                        const b = Math.floor((1 - norm) * 255);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.28)`;
                        ctx.fillRect(x * cs, y * cs, cs * 2, cs * 2);
                    }
                }
            }
        }

        // 3. Draw Influence & Threat Heatmap Overlay
        if (this.showInfluence) {
            for (let y = 0; y < im.rows; y += 2) {
                for (let x = 0; x < im.cols; x += 2) {
                    const idx = y * im.cols + x;
                    const infl = im.influence[idx];
                    const threat = im.threat[idx];

                    if (threat > 0.05) {
                        ctx.fillStyle = `rgba(255, 30, 70, ${Math.min(0.45, threat * 0.45)})`;
                        ctx.fillRect(x * cs, y * cs, cs * 2, cs * 2);
                    } else if (infl > 0.1) {
                        ctx.fillStyle = `rgba(0, 200, 255, ${Math.min(0.35, infl * 0.2)})`;
                        ctx.fillRect(x * cs, y * cs, cs * 2, cs * 2);
                    }
                }
            }
        }

        // 4. Draw Choke Points & Tactical Cover
        if (this.showChokePoints) {
            // Choke point diamond markers
            ctx.fillStyle = '#ffaa00';
            for (const cp of im.chokePointList) {
                ctx.beginPath();
                ctx.moveTo(cp.wx, cp.wy - 5);
                ctx.lineTo(cp.wx + 5, cp.wy);
                ctx.lineTo(cp.wx, cp.wy + 5);
                ctx.lineTo(cp.wx - 5, cp.wy);
                ctx.closePath();
                ctx.fill();
            }
        }

        // 5. Draw Flow Vector Field Streamlines / Arrows
        if (this.showFlowVectors) {
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
            ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
            ctx.lineWidth = 1;

            const step = 3; // draw every 3rd cell for crisp readability
            for (let y = 1; y < ff.rows - 1; y += step) {
                for (let x = 1; x < ff.cols - 1; x += step) {
                    const idx = y * ff.cols + x;
                    const vx = ff.flowX[idx];
                    const vy = ff.flowY[idx];

                    if ((vx !== 0 || vy !== 0) && ff.cost[idx] < TERRAIN.IMPASSABLE) {
                        const cx = (x + 0.5) * cs;
                        const cy = (y + 0.5) * cs;
                        const len = cs * 1.1;

                        const endX = cx + vx * len;
                        const endY = cy + vy * len;

                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.lineTo(endX, endY);
                        ctx.stroke();

                        // Tiny arrow tip
                        ctx.beginPath();
                        ctx.arc(endX, endY, 1.2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        // 6. Draw Threat Sources (pulses)
        for (const ts of im.threatSources) {
            ctx.strokeStyle = 'rgba(255, 40, 80, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(ts.wx, ts.wy, 12, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 40, 80, 0.25)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(ts.wx, ts.wy, ts.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#ff2850';
            ctx.font = '10px monospace';
            ctx.fillText('THREAT', ts.wx - 18, ts.wy - 16);
        }

        // 7. Draw Goal Anchor Marker
        const ax = this.unitManager.anchorX;
        const ay = this.unitManager.anchorY;
        const fa = this.unitManager.facingAngle;

        ctx.strokeStyle = '#39ff14';
        ctx.fillStyle = 'rgba(57, 255, 20, 0.2)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(ax, ay, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Facing Pointer
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(fa) * 24, ay + Math.sin(fa) * 24);
        ctx.stroke();

        // 8. Brush Hover Cursor
        if (!this.isMouseDown && (this.activeTool === TOOLS.WALL || this.activeTool === TOOLS.ROUGH || this.activeTool === TOOLS.ERASE)) {
            ctx.strokeStyle = this.activeTool === TOOLS.WALL ? '#ffaa00' : (this.activeTool === TOOLS.ROUGH ? '#d48800' : '#ffffff');
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(this.mousePos.x, this.mousePos.y, this.brushRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}
