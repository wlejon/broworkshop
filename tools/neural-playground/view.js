// Canvas drawing: the decision boundary with the data over it, the network
// graph with its weights, and the loss curves. Each canvas is sized to its
// box on every draw.

export const GRID = 50;             // decision-boundary samples per axis
const SPAN = 5;                     // the plane is [-SPAN, SPAN]²

/** GRID x GRID sample points (row 0 at the top, y = +SPAN) as flat x,y pairs. */
export const GRID_POINTS = (() => {
    const out = new Float32Array(GRID * GRID * 2);
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const i = (r * GRID + c) * 2;
            out[i] = -SPAN + (c / (GRID - 1)) * 2 * SPAN;
            out[i + 1] = SPAN - (r / (GRID - 1)) * 2 * SPAN;
        }
    }
    return out;
})();

function fit(canvas) {
    const w = Math.max(1, canvas.clientWidth | 0), h = Math.max(1, canvas.clientHeight | 0);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
}

/** Probability -> colour: blue (class 0) through dark (0.5) to orange (class 1). */
export function probColor(p) {
    const t = Math.abs(p - 0.5) * 2;
    const [r, g, b] = p < 0.5 ? [12, 100, 240] : [255, 106, 0];
    return [Math.round(20 + (r - 20) * t), Math.round(24 + (g - 24) * t), Math.round(36 + (b - 36) * t)];
}

/** The model's probabilities over GRID_POINTS as tiles, with train (filled) and test (ringed) points. */
export function drawBoundary(canvas, probs, data) {
    const ctx = canvas.getContext('2d');
    const [w, h] = fit(canvas);
    const cw = w / GRID, ch = h / GRID;
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const [cr, cg, cb] = probColor(probs[r * GRID + c]);
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
            ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
        }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    const px = (x) => ((x + SPAN) / (2 * SPAN)) * w, py = (y) => ((SPAN - y) / (2 * SPAN)) * h;
    const dots = (split, fill, stroke, lw) => {
        if (!split) return;
        split.y.forEach((label, i) => {
            ctx.fillStyle = fill(label);
            ctx.strokeStyle = stroke(label);
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.arc(px(split.flat[i * 2]), py(split.flat[i * 2 + 1]), 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    };
    dots(data.train, (l) => (l ? '#ff7700' : '#00b4ff'), () => '#ffffff', 1.5);
    dots(data.test, () => 'rgba(0,0,0,0.4)', (l) => (l ? '#ff9900' : '#33c9ff'), 2);
}

/** Neurons per layer, and every weight as a line (cyan +, orange -, width ~ |w|). */
export function drawNetwork(canvas, sizes, layers) {
    const ctx = canvas.getContext('2d');
    const [w, h] = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const gap = w / (sizes.length + 1);
    const nodes = sizes.map((count, l) => {
        const dy = Math.min(48, (h - 60) / (count + 1));
        const y0 = (h - (count - 1) * dy) / 2;
        return Array.from({ length: count }, (_, n) => ({ x: (l + 1) * gap, y: y0 + n * dy }));
    });
    layers.forEach((layer, l) => {
        for (let k = 0; k < layer.in; k++) {
            for (let j = 0; j < layer.out; j++) {
                const v = layer.W[j * layer.in + k], a = Math.abs(v);
                const alpha = Math.min(0.9, 0.2 + a * 0.4);
                ctx.strokeStyle = v >= 0 ? `rgba(0, 210, 255, ${alpha})` : `rgba(255, 100, 0, ${alpha})`;
                ctx.lineWidth = Math.max(0.5, Math.min(5, a * 1.8));
                ctx.beginPath();
                ctx.moveTo(nodes[l][k].x, nodes[l][k].y);
                ctx.lineTo(nodes[l + 1][j].x, nodes[l + 1][j].y);
                ctx.stroke();
            }
        }
    });
    const last = sizes.length - 1;
    sizes.forEach((count, l) => {
        nodes[l].forEach(({ x, y }, n) => {
            ctx.fillStyle = '#101626';
            ctx.strokeStyle = l === 0 ? '#00e5ff' : l === last ? '#ffea00' : '#818cf8';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#e2e8f0';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(l === 0 ? (n === 0 ? 'X₁' : 'X₂') : l === last ? 'Ŷ' : `h${l}_${n + 1}`, x, y);
        });
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(l === 0 ? 'Input (2)' : l === last ? 'Output (1)' : `Hidden ${l} (${count})`, (l + 1) * gap, h - 10);
    });
}

/** Train (cyan) and test (amber) loss over the recorded history. */
export function drawLoss(canvas, history) {
    const ctx = canvas.getContext('2d');
    const [w, h] = fit(canvas);
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let gy = 20; gy < h - 20; gy += 25) {
        ctx.beginPath();
        ctx.moveTo(35, gy);
        ctx.lineTo(w - 10, gy);
        ctx.stroke();
    }
    if (history.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Training loss curves will appear here…', w / 2, h / 2);
        return;
    }
    let max = 1;
    for (const p of history) max = Math.max(max, p.trainLoss, p.testLoss);
    max = Math.min(2.5, Math.max(0.7, max * 1.1));
    const X = (i) => 40 + (i / (history.length - 1)) * (w - 55);
    const Y = (v) => (h - 25) - (Math.min(max, Math.max(0, v)) / max) * (h - 45);
    for (const [key, color] of [['trainLoss', '#00e5ff'], ['testLoss', '#ffea00']]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        history.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p[key])) : ctx.moveTo(X(i), Y(p[key]))));
        ctx.stroke();
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0.0', 10, h - 22);
    ctx.fillText(max.toFixed(1), 10, 25);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('— Train Loss', w - 160, 16);
    ctx.fillStyle = '#ffea00';
    ctx.fillText('— Test Loss', w - 85, 16);
}
