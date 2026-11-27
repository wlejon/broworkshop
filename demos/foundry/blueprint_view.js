// demos/foundry/blueprint_view.js — Interactive 2D Mechanical Blueprint Canvas
// with Real-Time Stress, Power-Flow Pulses, and Immediate Out-of-Spec Overlays.
//
// Features:
//   - Pan (right/middle drag), zoom (wheel), click-select node, drag-move node
//   - Drag from output port dot -> input port dot to create typed physical links
//   - Double-click any nested Compiled Assembly card to drill down into its blueprint!
//   - Live per-frame overlays: animated power flow on wires, utilization & wear bars,
//     and pulsing OUT-OF-SPEC / SNAPPED / SLIPPING alert pills directly on the nodes!

import { fitCanvas } from "/lib/kit/gauges.js";
import { PORT_COLORS } from "/lib/foundry/primitives.js";
import { nodePorts, canLink, addLink, removeLink, removeNode } from "/lib/foundry/blueprint.js";
import { compileBlueprint } from "/lib/foundry/compiler.js";

const CARD_W = 176;
const CARD_H = 88;
const PORT_R = 6;

const STATUS_STYLE = {
    ok:         { border: '#334155', glow: null,      pill: null },
    warn:       { border: '#eab308', glow: '#eab308', pill: '#eab308' },
    slipping:   { border: '#e879f9', glow: '#e879f9', pill: '#e879f9' },
    overstress: { border: '#f97316', glow: '#f97316', pill: '#f97316' },
    failed:     { border: '#ef4444', glow: '#ef4444', pill: '#ef4444' },
};

export function createBlueprintView(canvas, opts = {}) {
    const view = { x: 40, y: 40, scale: 0.92 };
    let bp = null;
    let library = {};
    let compiled = null;
    let runtime = null;
    let selectedId = null;
    let hoverNode = null;
    let hoverPort = null; // { nodeId, portId, dir, domain, wx, wy }
    let dragNode = null;  // { node, ox, oy, startX, startY }
    let dragWire = null;  // { fromId, fromPort, domain, sx, sy, wx, wy }
    let panning = null;   // { sx, sy, vx, vy }
    let pulseT = 0;
    let subSpecCache = new Map();
    let lastCanvasW = 0;
    let needsFit = true;

    const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
    const localPt = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    function getPortPositions(node) {
        const info = nodePorts(node, library);
        const ins = info.ins.map((p, i) => ({
            ...p, dir: 'in', nodeId: node.id,
            wx: node.x, wy: node.y + 30 + i * 19,
        }));
        const outs = info.outs.map((p, i) => ({
            ...p, dir: 'out', nodeId: node.id,
            wx: node.x + CARD_W, wy: node.y + 30 + i * 19,
        }));
        return { ins, outs, label: info.label, color: info.color };
    }

    function hitPort(wx, wy) {
        if (!bp) return null;
        for (const n of bp.nodes) {
            const pp = getPortPositions(n);
            for (const p of [...pp.ins, ...pp.outs]) {
                if (Math.hypot(wx - p.wx, wy - p.wy) <= 11 / view.scale) return p;
            }
        }
        return null;
    }

    function hitNode(wx, wy) {
        if (!bp) return null;
        for (let i = bp.nodes.length - 1; i >= 0; i--) {
            const n = bp.nodes[i];
            if (wx >= n.x && wx <= n.x + CARD_W && wy >= n.y && wy <= n.y + CARD_H) return n;
        }
        return null;
    }

    function fitView(wOverride, hOverride) {
        if (!bp || !bp.nodes.length) return;
        const r = canvas.getBoundingClientRect();
        const w = Math.max(220, wOverride || r.width || 640);
        const h = Math.max(180, hOverride || r.height || 400);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const n of bp.nodes) {
            x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
            x1 = Math.max(x1, n.x + CARD_W); y1 = Math.max(y1, n.y + CARD_H);
        }
        const bw = Math.max(200, x1 - x0 + 70), bh = Math.max(140, y1 - y0 + 70);
        view.scale = Math.max(0.28, Math.min(1.15, Math.min(w / bw, h / bh)));
        view.x = (w - (x1 - x0) * view.scale) * 0.5 - x0 * view.scale;
        view.y = (h - (y1 - y0) * view.scale) * 0.5 - y0 * view.scale;
        needsFit = false;
    }

    // --- Pointer Interaction ----------------------------------------------------
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (!bp) return;
        const pt = localPt(e);
        const w = toWorld(pt.x, pt.y);
        if (e.button === 1 || e.button === 2) {
            panning = { sx: pt.x, sy: pt.y, vx: view.x, vy: view.y };
            return;
        }
        if (e.button !== 0) return;

        const port = hitPort(w.x, w.y);
        if (port && port.dir === 'out') {
            dragWire = { fromId: port.nodeId, fromPort: port.id, domain: port.domain, sx: port.wx, sy: port.wy, wx: w.x, wy: w.y };
            return;
        }
        const node = hitNode(w.x, w.y);
        if (node) {
            selectedId = node.id;
            dragNode = { node, ox: w.x - node.x, oy: w.y - node.y, moved: false };
            opts.onSelect?.(node);
            return;
        }
        // Empty space click: deselect & allow left-drag pan for convenience
        selectedId = null;
        opts.onSelect?.(null);
        panning = { sx: pt.x, sy: pt.y, vx: view.x, vy: view.y };
    });

    canvas.addEventListener('dblclick', (e) => {
        if (!bp) return;
        const pt = localPt(e), w = toWorld(pt.x, pt.y);
        const node = hitNode(w.x, w.y);
        if (node && node.type === 'assembly' && node.ref && library[node.ref]) {
            opts.onDrillDown?.(node.ref, node);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!bp) return;
        const pt = localPt(e), w = toWorld(pt.x, pt.y);
        if (panning) {
            view.x = panning.vx + (pt.x - panning.sx);
            view.y = panning.vy + (pt.y - panning.sy);
            return;
        }
        if (dragNode) {
            dragNode.node.x = Math.round((w.x - dragNode.ox) / 10) * 10;
            dragNode.node.y = Math.round((w.y - dragNode.oy) / 10) * 10;
            dragNode.moved = true;
            return;
        }
        if (dragWire) {
            dragWire.wx = w.x; dragWire.wy = w.y;
            hoverPort = hitPort(w.x, w.y);
            return;
        }
        hoverPort = hitPort(w.x, w.y);
        hoverNode = hoverPort ? null : hitNode(w.x, w.y);
    });

    window.addEventListener('mouseup', () => {
        if (dragWire && hoverPort && hoverPort.dir === 'in') {
            const chk = canLink(bp, dragWire.fromId, dragWire.fromPort, hoverPort.nodeId, hoverPort.id, library);
            if (chk.ok) {
                addLink(bp, dragWire.fromId, dragWire.fromPort, hoverPort.nodeId, hoverPort.id, library);
                opts.onMutate?.('Connect ' + dragWire.fromId + ' → ' + hoverPort.nodeId);
            }
        }
        if (dragNode && dragNode.moved) {
            opts.onMutate?.('Move ' + dragNode.node.label, { layoutOnly: true });
        }
        dragWire = null;
        dragNode = null;
        panning = null;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pt = localPt(e);
        const before = toWorld(pt.x, pt.y);
        const factor = Math.exp(-e.deltaY * 0.0012);
        view.scale = Math.max(0.32, Math.min(2.2, view.scale * factor));
        view.x = pt.x - before.x * view.scale;
        view.y = pt.y - before.y * view.scale;
    });

    // --- Rendering (60 Hz crisp schematic with live stress & flow) --------------
    function draw(dt = 1 / 60) {
        pulseT += dt;
        const { ctx, w, h } = fitCanvas(canvas);
        if (!(w > 4 && h > 4)) return;
        if (needsFit || Math.abs(w - lastCanvasW) > 6) {
            lastCanvasW = w;
            fitView(w, h);
        }

        // Blueprint dark grid background
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(0, 0, w, h);

        const gridStep = 24 * view.scale;
        if (gridStep >= 8) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const ox = ((view.x % gridStep) + gridStep) % gridStep;
            const oy = ((view.y % gridStep) + gridStep) % gridStep;
            for (let x = ox; x < w; x += gridStep) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
            for (let y = oy; y < h; y += gridStep) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
            ctx.stroke();
        }

        if (!bp) return;

        const rollups = runtime ? runtime.getNodeRollups() : new Map();

        ctx.save();
        ctx.translate(view.x, view.y);
        ctx.scale(view.scale, view.scale);

        // 1. Draw Links with live animated power flow & break detection!
        const portCoord = new Map();
        for (const n of bp.nodes) {
            const pp = getPortPositions(n);
            for (const p of pp.ins) portCoord.set(`in:${n.id}:${p.id}`, p);
            for (const p of pp.outs) portCoord.set(`out:${n.id}:${p.id}`, p);
        }

        for (const l of bp.links) {
            const a = portCoord.get(`out:${l.from}:${l.fromPort}`);
            const b = portCoord.get(`in:${l.to}:${l.toPort}`);
            if (!a || !b) continue;

            const rFrom = rollups.get(l.from);
            const rTo = rollups.get(l.to);
            const broken = rFrom?.status === 'failed' || rTo?.status === 'failed';
            const hot = rFrom?.status === 'overstress' || rTo?.status === 'overstress' || rFrom?.status === 'slipping';
            const rpm = Math.max(rFrom?.rpm || 0, rTo?.rpm || 0);

            const dx = Math.max(48, Math.abs(b.wx - a.wx) * 0.45);
            const col = broken ? '#ef4444' : hot ? '#f97316' : (PORT_COLORS[l.domain] || '#94a3b8');

            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = broken ? 2 : hot ? 3.2 : 2.4;
            if (broken) ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(a.wx, a.wy);
            ctx.bezierCurveTo(a.wx + dx, a.wy, b.wx - dx, b.wy, b.wx, b.wy);
            ctx.stroke();

            // Animated flow bead along active wires proportional to RPM!
            if (!broken && rpm > 5 && l.domain !== 'struct') {
                const speed = Math.min(4.0, 0.35 + rpm / 450);
                for (let k = 0; k < 2; k++) {
                    const t = (pulseT * speed + k * 0.5) % 1;
                    const u = 1 - t;
                    const px = u * u * u * a.wx + 3 * u * u * t * (a.wx + dx) + 3 * u * t * t * (b.wx - dx) + t * t * t * b.wx;
                    const py = u * u * u * a.wy + 3 * u * u * t * a.wy + 3 * u * t * t * b.wy + t * t * t * b.wy;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
        }

        // In-progress wire drag
        if (dragWire) {
            ctx.strokeStyle = PORT_COLORS[dragWire.domain] || '#fbbf24';
            ctx.lineWidth = 2.4;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(dragWire.sx, dragWire.sy);
            ctx.lineTo(dragWire.wx, dragWire.wy);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 2. Draw Nodes (Primitives & Nested Certified Assemblies)
        for (const n of bp.nodes) {
            const pp = getPortPositions(n);
            const r = rollups.get(n.id);
            const status = r ? r.status : 'ok';
            const st = STATUS_STYLE[status] || STATUS_STYLE.ok;
            const isSel = n.id === selectedId;
            const isAsm = n.type === 'assembly';

            // Outer glow on out-of-spec / failed / selected nodes
            ctx.save();
            if (st.glow) {
                ctx.shadowColor = st.glow;
                ctx.shadowBlur = status === 'failed' ? 18 : 12;
            } else if (isSel) {
                ctx.shadowColor = '#38bdf8';
                ctx.shadowBlur = 12;
            }

            // Card body
            ctx.fillStyle = isAsm ? '#151c2e' : '#131924';
            ctx.strokeStyle = isSel ? '#38bdf8' : st.border;
            ctx.lineWidth = isSel || status !== 'ok' ? 2.2 : 1.2;
            roundRect(ctx, n.x, n.y, CARD_W, CARD_H, 7);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // Header bar
            ctx.fillStyle = isAsm ? 'rgba(99, 102, 241, 0.24)' : 'rgba(148, 163, 184, 0.10)';
            roundRectTop(ctx, n.x + 1, n.y + 1, CARD_W - 2, 21, 6);
            ctx.fill();

            // Type color stripe
            ctx.fillStyle = pp.color;
            ctx.fillRect(n.x + 1, n.y + 1, 4, 21);

            // Title
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.fillText(truncate(n.label, 21), n.x + 10, n.y + 15);

            // Nested Assembly Certified Badge
            if (isAsm) {
                const subSpec = getSubSpec(n.ref);
                const badge = subSpec ? subSpec.grade : 'MOD';
                ctx.fillStyle = badge === 'SAFE' ? '#22c55e' : badge === 'UNPROTECTED' ? '#f97316' : '#818cf8';
                ctx.font = '700 9px monospace';
                ctx.fillText(badge, n.x + CARD_W - 6 - ctx.measureText(badge).width, n.y + 14);
            }

            // Live Telemetry Readout inside card
            const rpm = r ? r.rpm : 0;
            const torque = r ? r.torqueNm : 0;
            const stress = r ? r.maxStress : 0;
            const wear = r ? r.maxWear : 0;

            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px monospace';
            if (r && (rpm > 1 || torque > 0.5)) {
                ctx.fillText(`${rpm.toFixed(0)} rpm · ${torque.toFixed(0)} N·m`, n.x + 10, n.y + 39);
            } else if (isAsm) {
                const subSpec = getSubSpec(n.ref);
                const info = subSpec ? `${subSpec.massKg.toFixed(1)} kg · ${subSpec.primaryRatio.toFixed(1)}:1 (dbl-click)` : 'Compiled Module';
                ctx.fillText(truncate(info, 25), n.x + 10, n.y + 39);
            } else {
                const part = compiled?.parts.find((p) => p.path === n.id);
                ctx.fillText(truncate(part?.analysis.summary || n.type, 25), n.x + 10, n.y + 39);
            }

            // Live Stress Bar + Wear Bar
            drawMiniBar(ctx, n.x + 10, n.y + 49, CARD_W - 20, 7, stress,
                stress >= 1 ? '#ef4444' : stress >= 0.8 ? '#f59e0b' : '#22c55e',
                `LOAD ${Math.round(stress * 100)}%`);
            drawMiniBar(ctx, n.x + 10, n.y + 66, CARD_W - 20, 7, wear,
                wear >= 0.7 ? '#ef4444' : wear >= 0.3 ? '#f59e0b' : '#38bdf8',
                `WEAR ${Math.round(wear * 100)}%`);

            // Immediate Pulsing OUT-OF-SPEC Pill above card!
            if (status !== 'ok') {
                const msg = status === 'failed' ? (r.worstPart?.failReason || 'FAILED')
                    : status === 'slipping' ? 'CLUTCH SLIPPING'
                    : (r.outOfSpecMsg ? truncate(r.outOfSpecMsg, 28) : 'OUT OF SPEC');
                ctx.font = '700 9.5px monospace';
                const pw = Math.min(CARD_W + 40, ctx.measureText(msg).width + 12);
                const px = n.x + (CARD_W - pw) * 0.5;
                const py = n.y - 20;
                ctx.fillStyle = st.pill;
                roundRect(ctx, px, py, pw, 16, 4);
                ctx.fill();
                ctx.fillStyle = '#090d14';
                ctx.fillText(msg, px + 6, py + 11.5);
            }

            // Ports
            for (const p of [...pp.ins, ...pp.outs]) {
                const isHover = hoverPort && hoverPort.nodeId === p.nodeId && hoverPort.id === p.id && hoverPort.dir === p.dir;
                ctx.fillStyle = PORT_COLORS[p.domain] || '#94a3b8';
                ctx.beginPath();
                ctx.arc(p.wx, p.wy, isHover ? PORT_R + 2 : PORT_R, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0c111a';
                ctx.lineWidth = 1.6;
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    function getSubSpec(ref) {
        if (!ref || !library[ref]) return null;
        if (!subSpecCache.has(ref)) {
            subSpecCache.set(ref, compileBlueprint(library[ref], library).spec);
        }
        return subSpecCache.get(ref);
    }

    return {
        setContext(newBp, newLib, newCompiled, newRuntime) {
            const changedBp = bp !== newBp;
            bp = newBp;
            library = newLib || {};
            compiled = newCompiled || null;
            runtime = newRuntime || null;
            subSpecCache.clear();
            if (changedBp) {
                selectedId = null;
                needsFit = true;
                fitView();
            }
        },
        setRuntime(newRuntime) { runtime = newRuntime; },
        setSelected(id) { selectedId = id; },
        get selectedId() { return selectedId; },
        fitView,
        draw,
        deleteSelected() {
            if (!bp || !selectedId) return false;
            const ok = removeNode(bp, selectedId);
            if (ok) {
                selectedId = null;
                opts.onSelect?.(null);
                opts.onMutate?.('Remove component');
            }
            return ok;
        },
    };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function roundRectTop(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function drawMiniBar(ctx, x, y, w, h, frac, col, label) {
    ctx.fillStyle = '#0b1019';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 8.5px monospace';
    ctx.fillText(label, x + 3, y + h - 0.5);
}
function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
