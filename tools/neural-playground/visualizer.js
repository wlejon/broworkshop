// visualizer.js — Canvas graphics for Decision Boundary Heatmap, Network Architecture Graph, and Loss Curves

export class Visualizer {
    constructor(boundaryCanvas, networkCanvas, lossCanvas) {
        this.boundaryCanvas = boundaryCanvas;
        this.boundaryCtx = boundaryCanvas.getContext('2d');

        this.networkCanvas = networkCanvas;
        this.networkCtx = networkCanvas.getContext('2d');

        this.lossCanvas = lossCanvas;
        this.lossCtx = lossCanvas.getContext('2d');

        // Precompute grid coordinates [-5, 5]
        this.gridRes = 50;
        this.gridPoints = [];
        for (let r = 0; r < this.gridRes; r++) {
            const y = 5.0 - (r / (this.gridRes - 1)) * 10.0;
            for (let c = 0; c < this.gridRes; c++) {
                const x = -5.0 + (c / (this.gridRes - 1)) * 10.0;
                this.gridPoints.push([x, y]);
            }
        }

        // Loss history
        this.lossHistory = [];
    }

    resetLossHistory() {
        this.lossHistory = [];
        this.renderLossChart();
    }

    recordLoss(epoch, trainLoss, testLoss, trainAcc, testAcc) {
        this.lossHistory.push({ epoch, trainLoss, testLoss, trainAcc, testAcc });
        if (this.lossHistory.length > 300) {
            this.lossHistory.shift();
        }
    }

    // 1. Render 2D Decision Boundary Heatmap
    renderDecisionBoundary(model, dataset) {
        const ctx = this.boundaryCtx;
        const w = this.boundaryCanvas.width;
        const h = this.boundaryCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Get predictions over grid
        const probs = model.predictGrid(this.gridPoints);

        // Render pixel tiles
        const cellW = w / this.gridRes;
        const cellH = h / this.gridRes;

        for (let r = 0; r < this.gridRes; r++) {
            for (let c = 0; c < this.gridRes; c++) {
                const idx = r * this.gridRes + c;
                const p = probs[idx];

                // Interpolate color: Class 0 (Blue) -> Class 1 (Orange)
                // p = 0 -> rgb(12, 100, 240)
                // p = 0.5 -> rgb(20, 24, 36)
                // p = 1.0 -> rgb(255, 106, 0)
                let rCol, gCol, bCol;
                if (p < 0.5) {
                    const t = (0.5 - p) * 2.0;
                    rCol = Math.round(20 * (1 - t) + 12 * t);
                    gCol = Math.round(24 * (1 - t) + 100 * t);
                    bCol = Math.round(36 * (1 - t) + 240 * t);
                } else {
                    const t = (p - 0.5) * 2.0;
                    rCol = Math.round(20 * (1 - t) + 255 * t);
                    gCol = Math.round(24 * (1 - t) + 106 * t);
                    bCol = Math.round(36 * (1 - t) + 0 * t);
                }

                ctx.fillStyle = `rgb(${rCol},${gCol},${bCol})`;
                ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
            }
        }

        // Draw coordinate axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw Data Points
        const toCanvasX = (x) => ((x + 5.0) / 10.0) * w;
        const toCanvasY = (y) => ((5.0 - y) / 10.0) * h;

        // Train Points
        if (dataset && dataset.train) {
            for (let i = 0; i < dataset.train.X.length; i++) {
                const [x, y] = dataset.train.X[i];
                const label = dataset.train.y[i];
                const cx = toCanvasX(x);
                const cy = toCanvasY(y);

                ctx.fillStyle = label === 1 ? '#ff7700' : '#00b4ff';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        // Test Points
        if (dataset && dataset.test) {
            for (let i = 0; i < dataset.test.X.length; i++) {
                const [x, y] = dataset.test.X[i];
                const label = dataset.test.y[i];
                const cx = toCanvasX(x);
                const cy = toCanvasY(y);

                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.strokeStyle = label === 1 ? '#ff9900' : '#33c9ff';
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }
    }

    // 2. Render Network Architecture Graph & Weights
    renderNetworkGraph(model) {
        const ctx = this.networkCtx;
        const w = this.networkCanvas.width;
        const h = this.networkCanvas.height;

        ctx.clearRect(0, 0, w, h);

        const layerSizes = model.layerSizes;
        const numLayers = layerSizes.length;
        const layerSpacing = w / (numLayers + 1);

        // Compute neuron coordinates
        const nodeCoords = [];
        for (let l = 0; l < numLayers; l++) {
            const count = layerSizes[l];
            const x = (l + 1) * layerSpacing;
            const ySpacing = Math.min(48, (h - 60) / (count + 1));
            const startY = (h - (count - 1) * ySpacing) / 2;

            const layerCoords = [];
            for (let n = 0; n < count; n++) {
                const y = startY + n * ySpacing;
                layerCoords.push({ x, y });
            }
            nodeCoords.push(layerCoords);
        }

        // Draw Synaptic Connection Lines
        for (let l = 0; l < model.layers.length; l++) {
            const layer = model.layers[l];
            const inCoords = nodeCoords[l];
            const outCoords = nodeCoords[l + 1];

            for (let i = 0; i < layer.inDim; i++) {
                for (let j = 0; j < layer.outDim; j++) {
                    const weightVal = layer.W[i * layer.outDim + j];
                    const absW = Math.abs(weightVal);
                    const lineWidth = Math.max(0.5, Math.min(5.0, absW * 1.8));

                    ctx.strokeStyle = weightVal >= 0
                        ? `rgba(0, 210, 255, ${Math.min(0.9, 0.2 + absW * 0.4)})`
                        : `rgba(255, 100, 0, ${Math.min(0.9, 0.2 + absW * 0.4)})`;
                    ctx.lineWidth = lineWidth;

                    ctx.beginPath();
                    ctx.moveTo(inCoords[i].x, inCoords[i].y);
                    ctx.lineTo(outCoords[j].x, outCoords[j].y);
                    ctx.stroke();
                }
            }
        }

        // Draw Neuron Nodes
        for (let l = 0; l < numLayers; l++) {
            const count = layerSizes[l];
            const isInput = l === 0;
            const isOutput = l === numLayers - 1;

            for (let n = 0; n < count; n++) {
                const { x, y } = nodeCoords[l][n];
                const r = 12;

                ctx.save();
                ctx.fillStyle = '#101626';
                ctx.strokeStyle = isInput ? '#00e5ff' : (isOutput ? '#ffea00' : '#818cf8');
                ctx.lineWidth = 2.5;

                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Labels
                ctx.fillStyle = '#e2e8f0';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                let label = '';
                if (isInput) label = n === 0 ? 'X₁' : 'X₂';
                else if (isOutput) label = 'Ŷ';
                else label = `h${l}_${n + 1}`;

                ctx.fillText(label, x, y);
                ctx.restore();
            }

            // Layer Title
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            const layerName = isInput ? 'Input (2)' : (isOutput ? 'Output (1)' : `Hidden ${l} (${count})`);
            ctx.fillText(layerName, (l + 1) * layerSpacing, h - 10);
        }
    }

    // 3. Render Loss Curves
    renderLossChart() {
        const ctx = this.lossCtx;
        const w = this.lossCanvas.width;
        const h = this.lossCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Background grid & border
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

        if (this.lossHistory.length < 2) {
            ctx.fillStyle = '#64748b';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Training loss curves will appear here...', w / 2, h / 2);
            return;
        }

        // Find max loss
        let maxLoss = 1.0;
        for (const pt of this.lossHistory) {
            if (pt.trainLoss > maxLoss) maxLoss = pt.trainLoss;
            if (pt.testLoss > maxLoss) maxLoss = pt.testLoss;
        }
        maxLoss = Math.min(2.5, Math.max(0.7, maxLoss * 1.1));

        const plotX = (idx) => 40 + (idx / (this.lossHistory.length - 1)) * (w - 55);
        const plotY = (loss) => (h - 25) - (Math.min(maxLoss, Math.max(0, loss)) / maxLoss) * (h - 45);

        // Train Loss (Cyan)
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        for (let i = 0; i < this.lossHistory.length; i++) {
            const x = plotX(i);
            const y = plotY(this.lossHistory[i].trainLoss);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Test Loss (Amber)
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        for (let i = 0; i < this.lossHistory.length; i++) {
            const x = plotX(i);
            const y = plotY(this.lossHistory[i].testLoss);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Legend & axes text
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`0.0`, 10, h - 22);
        ctx.fillText(`${maxLoss.toFixed(1)}`, 10, 25);

        // Mini legend
        ctx.fillStyle = '#00e5ff';
        ctx.fillText('— Train Loss', w - 160, 16);
        ctx.fillStyle = '#ffea00';
        ctx.fillText('— Test Loss', w - 85, 16);
    }
}
