// timeline.js — Interactive timeline scrubber and canvas easing curve plotter.

export class TimelineScrubber {
    constructor(elements, onSeekCallback) {
        this.slider = elements.slider;
        this.timeDisplay = elements.timeDisplay;
        this.progressFill = elements.progressFill;
        this.keyframeTrack = elements.keyframeTrack;
        this.onSeek = onSeekCallback || (() => {});

        this.isDragging = false;
        this._bindEvents();
    }

    _bindEvents() {
        if (!this.slider) return;

        this.slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (this.progressFill) this.progressFill.style.width = `${val}%`;
            this.onSeek(val / 100);
        });

        this.slider.addEventListener('mousedown', () => { this.isDragging = true; });
        window.addEventListener('mouseup', () => { this.isDragging = false; });
    }

    update(telemetry) {
        if (this.isDragging || !telemetry) return;

        const progress = (telemetry.progress || 0) * 100;
        if (this.slider) this.slider.value = progress;
        if (this.progressFill) this.progressFill.style.width = `${progress}%`;

        if (this.timeDisplay) {
            const cur = this.formatTimeMs(telemetry.currentTime);
            const total = this.formatTimeMs(telemetry.duration);
            const pct = (telemetry.progress * 100).toFixed(1);
            this.timeDisplay.textContent = `${cur} / ${total} (${pct}%)`;
        }
    }

    setKeyframeMarkers(keyframes) {
        if (!this.keyframeTrack || !Array.isArray(keyframes)) return;

        this.keyframeTrack.innerHTML = '';
        keyframes.forEach((kf) => {
            let offset = kf.offset;
            if (offset == null) return;
            const marker = document.createElement('div');
            marker.className = 'kf-marker';
            marker.style.left = `${offset * 100}%`;
            marker.title = `Keyframe @ ${Math.round(offset * 100)}%`;
            this.keyframeTrack.appendChild(marker);
        });
    }

    formatTimeMs(ms) {
        if (ms == null || isNaN(ms) || ms === Infinity) return '∞';
        const totalSec = ms / 1000;
        const mins = Math.floor(totalSec / 60);
        const secs = Math.floor(totalSec % 60);
        const millis = Math.floor(ms % 1000);

        const mStr = String(mins).padStart(2, '0');
        const sStr = String(secs).padStart(2, '0');
        const msStr = String(millis).padStart(3, '0');
        return `${mStr}:${sStr}.${msStr}`;
    }
}

/**
 * Easing Curve Visualizer:
 * Computes and renders cubic-bezier curves and real-time progress markers on canvas.
 */
export class EasingPlotter {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement ? canvasElement.getContext('2d') : null;
    }

    /**
     * Parses standard CSS easing or cubic-bezier into 4 control points: (0,0), (x1, y1), (x2, y2), (1,1).
     */
    parseEasing(easingStr) {
        if (!easingStr) return [0.25, 0.1, 0.25, 1.0]; // default 'ease'

        const str = easingStr.trim().toLowerCase();
        if (str === 'linear') return [0, 0, 1, 1];
        if (str === 'ease') return [0.25, 0.1, 0.25, 1.0];
        if (str === 'ease-in') return [0.42, 0, 1.0, 1.0];
        if (str === 'ease-out') return [0, 0, 0.58, 1.0];
        if (str === 'ease-in-out') return [0.42, 0, 0.58, 1.0];

        const match = str.match(/cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/);
        if (match) {
            return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4])];
        }

        return [0.25, 0.1, 0.25, 1.0];
    }

    /**
     * Calculates Cubic Bezier point B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
     */
    bezierPoint(t, p0, p1, p2, p3) {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;

        return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
    }

    render(easingStr, progress = 0) {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;

        const w = this.canvas.clientWidth || 280;
        const h = this.canvas.clientHeight || 180;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        const padX = 32;
        const padY = 32;
        const graphW = w - padX * 2;
        const graphH = h - padY * 2;

        // Background grid
        ctx.fillStyle = '#10141d';
        ctx.fillRect(padX, padY, graphW, graphH);

        ctx.strokeStyle = '#1e2634';
        ctx.lineWidth = 1;
        // Grid lines
        for (let i = 1; i < 4; i++) {
            const x = padX + (graphW / 4) * i;
            const y = padY + (graphH / 4) * i;
            ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + graphH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + graphW, y); ctx.stroke();
        }

        // Axes (0,0 is bottom-left)
        ctx.strokeStyle = '#303a4c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padX, padY);
        ctx.lineTo(padX, padY + graphH);
        ctx.lineTo(padX + graphW, padY + graphH);
        ctx.stroke();

        // Control Points
        const [x1, y1, x2, y2] = this.parseEasing(easingStr);

        const p0 = { x: padX, y: padY + graphH };
        const p1 = { x: padX + x1 * graphW, y: padY + graphH - y1 * graphH };
        const p2 = { x: padX + x2 * graphW, y: padY + graphH - y2 * graphH };
        const p3 = { x: padX + graphW, y: padY };

        // Draw handle guide lines
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Handle points
        ctx.fillStyle = '#a855f7';
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2); ctx.fill();

        // Draw Bezier Curve
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);

        const steps = 60;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const bx = this.bezierPoint(t, 0, x1, x2, 1);
            const by = this.bezierPoint(t, 0, y1, y2, 1);
            const screenX = padX + bx * graphW;
            const screenY = padY + graphH - by * graphH;
            ctx.lineTo(screenX, screenY);
        }
        ctx.stroke();

        // Draw animated progress ball along the curve
        const clampedProg = Math.max(0, Math.min(1, progress));
        const curBx = this.bezierPoint(clampedProg, 0, x1, x2, 1);
        const curBy = this.bezierPoint(clampedProg, 0, y1, y2, 1);
        const ballX = padX + curBx * graphW;
        const ballY = padY + graphH - curBy * graphH;

        // Glow ring
        ctx.fillStyle = 'rgba(255, 0, 127, 0.3)';
        ctx.beginPath();
        ctx.arc(ballX, ballY, 9, 0, Math.PI * 2);
        ctx.fill();

        // Solid ball
        ctx.fillStyle = '#ff007f';
        ctx.beginPath();
        ctx.arc(ballX, ballY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Text labels
        ctx.fillStyle = '#8b949e';
        ctx.font = '10px monospace';
        ctx.fillText('0,0', padX - 8, padY + graphH + 14);
        ctx.fillText('1,1', padX + graphW - 8, padY - 6);
        ctx.fillStyle = '#00f0ff';
        ctx.fillText(easingStr.length > 25 ? easingStr.slice(0, 25) + '...' : easingStr, padX, padY - 8);
    }
}
