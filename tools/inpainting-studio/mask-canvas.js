// tools/inpainting-studio/mask-canvas.js

export class MaskCanvasController {
    constructor(baseCanvas, maskCanvas, onMaskChanged) {
        this.baseCanvas = baseCanvas;
        this.maskCanvas = maskCanvas;
        this.onMaskChanged = onMaskChanged;

        this.baseCtx = this.baseCanvas.getContext('2d');
        this.maskCtx = this.maskCanvas.getContext('2d');

        this.isPainting = false;
        this.tool = 'brush'; // 'brush' | 'eraser'
        this.brushSize = 32;
        this.brushHardness = 0.8;
        this.lastX = 0;
        this.lastY = 0;

        this.initEvents();
    }

    initEvents() {
        const mask = this.maskCanvas;

        const getPos = (e) => {
            const rect = mask.getBoundingClientRect();
            const scaleX = mask.width / rect.width;
            const scaleY = mask.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        mask.addEventListener('mousedown', (e) => {
            this.isPainting = true;
            const pos = getPos(e);
            this.lastX = pos.x;
            this.lastY = pos.y;
            this.paintStroke(pos.x, pos.y);
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isPainting) return;
            const pos = getPos(e);
            this.paintLine(this.lastX, this.lastY, pos.x, pos.y);
            this.lastX = pos.x;
            this.lastY = pos.y;
        });

        window.addEventListener('mouseup', () => {
            if (this.isPainting) {
                this.isPainting = false;
                if (this.onMaskChanged) this.onMaskChanged();
            }
        });
    }

    paintStroke(x, y) {
        const ctx = this.maskCtx;
        ctx.save();

        if (this.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, this.brushSize * 0.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            const rad = this.brushSize * 0.5;
            const grad = ctx.createRadialGradient(x, y, rad * (this.brushHardness * 0.8), x, y, rad);
            grad.addColorStop(0, 'rgba(247, 37, 133, 0.85)');
            grad.addColorStop(1, 'rgba(247, 37, 133, 0.0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    paintLine(x1, y1, x2, y2) {
        const dist = Math.hypot(x2 - x1, y2 - y1);
        const step = Math.max(1, this.brushSize * 0.2);
        const steps = Math.ceil(dist / step);

        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            this.paintStroke(x, y);
        }
    }

    clearMask() {
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        if (this.onMaskChanged) this.onMaskChanged();
    }

    fillMask() {
        this.maskCtx.fillStyle = 'rgba(247, 37, 133, 0.85)';
        this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        if (this.onMaskChanged) this.onMaskChanged();
    }

    invertMask() {
        const w = this.maskCanvas.width;
        const h = this.maskCanvas.height;
        const imgData = this.maskCtx.getImageData(0, 0, w, h);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
            const alpha = d[i + 3];
            d[i] = 247;
            d[i + 1] = 37;
            d[i + 2] = 133;
            d[i + 3] = alpha > 30 ? 0 : 215; // Invert alpha
        }
        this.maskCtx.putImageData(imgData, 0, 0);
        if (this.onMaskChanged) this.onMaskChanged();
    }

    expandBounds(dx, dy) {
        // Expand canvas size for outpainting
        const oldW = this.baseCanvas.width;
        const oldH = this.baseCanvas.height;
        const newW = Math.min(1024, oldW + Math.abs(dx));
        const newH = Math.min(1024, oldH + Math.abs(dy));

        const offX = dx < 0 ? Math.abs(dx) : 0;
        const offY = dy < 0 ? Math.abs(dy) : 0;

        // Save old base image & mask
        const oldBase = this.baseCtx.getImageData(0, 0, oldW, oldH);
        const oldMask = this.maskCtx.getImageData(0, 0, oldW, oldH);

        // Resize all canvases
        const canvases = [this.baseCanvas, this.maskCanvas];
        for (const c of canvases) {
            c.width = newW;
            c.height = newH;
        }

        // Restore base image with offset
        this.baseCtx.fillStyle = '#101216';
        this.baseCtx.fillRect(0, 0, newW, newH);
        this.baseCtx.putImageData(oldBase, offX, offY);

        // Fill expanded boundary with mask
        this.maskCtx.fillStyle = 'rgba(247, 37, 133, 0.85)';
        this.maskCtx.fillRect(0, 0, newW, newH);
        this.maskCtx.clearRect(offX, offY, oldW, oldH);
        this.maskCtx.putImageData(oldMask, offX, offY);

        if (this.onMaskChanged) this.onMaskChanged();
    }
}
