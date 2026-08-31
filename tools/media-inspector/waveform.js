/**
 * waveform.js — Canvas2D Audio Waveform & Energy Visualizer
 *
 * Renders min/max envelope and RMS energy curves from bro.media.peaks data.
 * Supports interactive timeline scrubbing, playhead tracking, zooming/panning,
 * and region selection.
 */

export class WaveformVisualizer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [options]
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.options = Object.assign({
            bgColor: '#12151e',
            gridColor: '#1e2333',
            rulerColor: '#2b3248',
            textColor: '#8892b0',
            envelopeTopColor: 'rgba(59, 130, 246, 0.75)',
            envelopeBottomColor: 'rgba(37, 99, 235, 0.45)',
            envelopeOutlineColor: '#60a5fa',
            rmsLineColor: '#10b981',
            rmsGlowColor: 'rgba(16, 185, 129, 0.3)',
            playheadColor: '#f43f5e',
            playheadTextColor: '#ffffff',
            hoverLineColor: 'rgba(255, 255, 255, 0.35)',
            selectionColor: 'rgba(139, 92, 246, 0.25)',
            selectionBorderColor: '#8b5cf6',
            centerLineColor: '#23293d',
            rulerHeight: 22,
        }, options);

        this.peaks = null;
        this.duration = 0;
        this.windowFrom = 0;
        this.windowTo = 0;
        this.playheadTime = 0;

        // Interaction state
        this.isDraggingPlayhead = false;
        this.isSelectingRegion = false;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.hoverX = null;
        this.hoverTime = null;

        // Callbacks
        this.onSeekCallback = null;
        this.onRegionSelectCallback = null;
        this.onZoomChangeCallback = null;

        this._initEvents();
        this.resize();
    }

    /**
     * Set waveform data from bro.media.peaks result.
     * @param {Object} peaksData
     * @param {number} [totalDuration]
     */
    setData(peaksData, totalDuration) {
        this.peaks = peaksData;
        if (!peaksData) {
            this.duration = totalDuration || 0;
            this.windowFrom = 0;
            this.windowTo = this.duration;
            this.render();
            return;
        }

        this.duration = totalDuration || peaksData.duration || 0;
        this.windowFrom = (typeof peaksData.from === 'number') ? peaksData.from : 0;
        this.windowTo = (typeof peaksData.to === 'number' && peaksData.to > this.windowFrom)
            ? peaksData.to
            : (this.duration || 1);

        this.render();
    }

    /**
     * Update current playhead position in seconds.
     * @param {number} time
     */
    setPlayhead(time) {
        this.playheadTime = Math.max(0, Math.min(this.duration, time));
        this.render();
    }

    /**
     * Set active time window (for zoom/pan).
     * @param {number} from
     * @param {number} to
     */
    setWindow(from, to) {
        const minSpan = 0.05;
        this.windowFrom = Math.max(0, Math.min(from, this.duration - minSpan));
        this.windowTo = Math.min(this.duration, Math.max(to, this.windowFrom + minSpan));
        if (this.onZoomChangeCallback) {
            this.onZoomChangeCallback(this.windowFrom, this.windowTo);
        }
        this.render();
    }

    /**
     * Zoom into or out of timeline centered at given normalized position.
     * @param {number} factor (> 1 zooms in, < 1 zooms out)
     * @param {number} [centerRatio=0.5]
     */
    zoom(factor, centerRatio = 0.5) {
        if (!this.duration) return;
        const currentSpan = this.windowTo - this.windowFrom;
        const newSpan = Math.max(0.05, Math.min(this.duration, currentSpan / factor));
        const centerTime = this.windowFrom + currentSpan * centerRatio;
        const newFrom = Math.max(0, centerTime - newSpan * centerRatio);
        const newTo = Math.min(this.duration, newFrom + newSpan);
        this.setWindow(newFrom, newTo);
    }

    /**
     * Reset zoom to view full file duration.
     */
    fit() {
        this.setWindow(0, this.duration);
        this.clearSelection();
    }

    /**
     * Clear active region selection.
     */
    clearSelection() {
        this.selectionStart = null;
        this.selectionEnd = null;
        this.render();
    }

    /**
     * Get active region selection in seconds.
     * @returns {{ from: number, to: number } | null}
     */
    getSelection() {
        if (this.selectionStart === null || this.selectionEnd === null) return null;
        const from = Math.min(this.selectionStart, this.selectionEnd);
        const to = Math.max(this.selectionStart, this.selectionEnd);
        if (Math.abs(to - from) < 0.01) return null;
        return { from, to };
    }

    /**
     * Set seek callback.
     * @param {(time: number) => void} cb
     */
    onSeek(cb) {
        this.onSeekCallback = cb;
    }

    /**
     * Set region select callback.
     * @param {(from: number, to: number) => void} cb
     */
    onRegionSelect(cb) {
        this.onRegionSelectCallback = cb;
    }

    /**
     * Handle canvas resize with device pixel ratio.
     */
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(100, Math.floor(rect.width || this.canvas.width || 800));
        const h = Math.max(60, Math.floor(rect.height || this.canvas.height || 140));

        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssWidth = w;
        this.cssHeight = h;
        this.render();
    }

    /**
     * Convert time (s) to canvas X coordinate.
     * @param {number} time
     * @returns {number}
     */
    timeToX(time) {
        const span = this.windowTo - this.windowFrom;
        if (span <= 0) return 0;
        return ((time - this.windowFrom) / span) * this.cssWidth;
    }

    /**
     * Convert canvas X coordinate to time (s).
     * @param {number} x
     * @returns {number}
     */
    xToTime(x) {
        const span = this.windowTo - this.windowFrom;
        const ratio = Math.max(0, Math.min(1, x / this.cssWidth));
        return this.windowFrom + ratio * span;
    }

    /**
     * Main canvas rendering routine.
     */
    render() {
        const ctx = this.ctx;
        const w = this.cssWidth || this.canvas.width;
        const h = this.cssHeight || this.canvas.height;
        const rulerH = this.options.rulerHeight;
        const waveH = h - rulerH;
        const centerY = rulerH + waveH / 2;

        ctx.clearRect(0, 0, w, h);

        // 1. Background
        ctx.fillStyle = this.options.bgColor;
        ctx.fillRect(0, 0, w, h);

        // 2. Timeline ruler background
        ctx.fillStyle = this.options.rulerColor;
        ctx.fillRect(0, 0, w, rulerH);

        // Ruler bottom border
        ctx.strokeStyle = this.options.gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, rulerH - 0.5);
        ctx.lineTo(w, rulerH - 0.5);
        ctx.stroke();

        // 3. Grid & Ruler Ticks
        this._renderRuler(ctx, w, h, rulerH, waveH);

        // 4. Center zero line
        ctx.strokeStyle = this.options.centerLineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        // 5. Waveform Peaks & RMS
        if (this.peaks && this.peaks.buckets > 0) {
            this._renderPeaks(ctx, w, rulerH, waveH, centerY);
        } else {
            // Placeholder text when no audio data
            ctx.fillStyle = '#4a5568';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.duration ? 'No audio track / peak data' : 'Load media file to view waveform', w / 2, centerY);
        }

        // 6. Region Selection Highlight
        if (this.selectionStart !== null && this.selectionEnd !== null) {
            const x1 = this.timeToX(Math.min(this.selectionStart, this.selectionEnd));
            const x2 = this.timeToX(Math.max(this.selectionStart, this.selectionEnd));
            const selW = Math.max(1, x2 - x1);

            ctx.fillStyle = this.options.selectionColor;
            ctx.fillRect(x1, rulerH, selW, waveH);

            ctx.strokeStyle = this.options.selectionBorderColor;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x1, rulerH, selW, waveH);

            // Selection duration tag
            const selDur = Math.abs(this.selectionEnd - this.selectionStart);
            ctx.fillStyle = '#c4b5fd';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${selDur.toFixed(3)}s`, x1 + selW / 2, rulerH + 14);
        }

        // 7. Hover Indicator Line
        if (this.hoverX !== null && this.hoverTime !== null && this.hoverX >= 0 && this.hoverX <= w) {
            ctx.strokeStyle = this.options.hoverLineColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(this.hoverX, 0);
            ctx.lineTo(this.hoverX, h);
            ctx.stroke();
            ctx.setLineDash([]);

            // Hover timestamp pill
            const hoverTag = `${this.hoverTime.toFixed(3)}s`;
            ctx.font = '10px monospace';
            const tagW = ctx.measureText(hoverTag).width + 8;
            const tagX = Math.max(4, Math.min(w - tagW - 4, this.hoverX - tagW / 2));
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.fillRect(tagX, rulerH + 2, tagW, 14);
            ctx.strokeStyle = '#475569';
            ctx.strokeRect(tagX, rulerH + 2, tagW, 14);
            ctx.fillStyle = '#e2e8f0';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(hoverTag, tagX + 4, rulerH + 9);
        }

        // 8. Playhead Indicator
        if (this.duration > 0 && this.playheadTime >= this.windowFrom && this.playheadTime <= this.windowTo) {
            const playX = this.timeToX(this.playheadTime);

            // Vertical playhead line
            ctx.strokeStyle = this.options.playheadColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(playX, 0);
            ctx.lineTo(playX, h);
            ctx.stroke();

            // Playhead handle triangle at ruler top
            ctx.fillStyle = this.options.playheadColor;
            ctx.beginPath();
            ctx.moveTo(playX - 6, 0);
            ctx.lineTo(playX + 6, 0);
            ctx.lineTo(playX, 8);
            ctx.closePath();
            ctx.fill();

            // Playhead time badge in ruler
            const badgeText = `${this.playheadTime.toFixed(2)}s`;
            ctx.font = 'bold 10px monospace';
            const badgeW = ctx.measureText(badgeText).width + 6;
            const badgeX = Math.max(2, Math.min(w - badgeW - 2, playX - badgeW / 2));
            ctx.fillStyle = this.options.playheadColor;
            ctx.fillRect(badgeX, 9, badgeW, 12);
            ctx.fillStyle = this.options.playheadTextColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, badgeX + badgeW / 2, 15);
        }
    }

    /**
     * Render ruler ticks and time labels.
     * @private
     */
    _renderRuler(ctx, w, h, rulerH, waveH) {
        const span = this.windowTo - this.windowFrom;
        if (span <= 0) return;

        // Choose nice tick interval based on visible span
        const targetTickCount = Math.max(4, Math.floor(w / 90));
        const rawStep = span / targetTickCount;
        const step = this._niceStep(rawStep);

        const firstTick = Math.ceil(this.windowFrom / step) * step;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let t = firstTick; t <= this.windowTo; t += step) {
            const x = this.timeToX(t);
            if (x < 0 || x > w) continue;

            // Ruler tick mark
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, rulerH - 6);
            ctx.lineTo(x, rulerH);
            ctx.stroke();

            // Grid line through waveform
            ctx.strokeStyle = this.options.gridColor;
            ctx.beginPath();
            ctx.moveTo(x, rulerH);
            ctx.lineTo(x, h);
            ctx.stroke();

            // Time label
            ctx.fillStyle = this.options.textColor;
            ctx.fillText(this._formatTimeLabel(t, span), x, 4);

            // Sub-ticks
            const subStep = step / 4;
            for (let sub = 1; sub < 4; sub++) {
                const st = t + sub * subStep;
                if (st > this.windowTo) break;
                const sx = this.timeToX(st);
                if (sx >= 0 && sx <= w) {
                    ctx.strokeStyle = '#334155';
                    ctx.beginPath();
                    ctx.moveTo(sx, rulerH - 3);
                    ctx.lineTo(sx, rulerH);
                    ctx.stroke();
                }
            }
        }
    }

    /**
     * Render min/max envelope and RMS line.
     * @private
     */
    _renderPeaks(ctx, w, rulerH, waveH, centerY) {
        const p = this.peaks;
        const buckets = p.buckets;
        const halfWaveH = (waveH / 2) * 0.92;
        const minv = p.min;
        const maxv = p.max;
        const rms = p.rms;

        const pFrom = (typeof p.from === 'number') ? p.from : 0;
        const pTo = (typeof p.to === 'number' && p.to > pFrom) ? p.to : this.duration;
        const pSpan = pTo - pFrom;

        // Compute screen coordinates for each bucket
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, rulerH, w, waveH);
        ctx.clip();

        // 1. Min/Max Envelope
        ctx.fillStyle = this.options.envelopeTopColor;
        ctx.strokeStyle = this.options.envelopeOutlineColor;
        ctx.lineWidth = 1;

        // Draw vertical bucket bars or filled envelope path
        for (let i = 0; i < buckets; i++) {
            const bucketTime = pFrom + (i / (buckets - 1 || 1)) * pSpan;
            const x = this.timeToX(bucketTime);
            if (x < -2 || x > w + 2) continue;

            const maxVal = Math.min(1.5, Math.max(0, maxv[i]));
            const minVal = Math.max(-1.5, Math.min(0, minv[i]));

            const topY = centerY - maxVal * halfWaveH;
            const botY = centerY - minVal * halfWaveH;
            const barH = Math.max(1, botY - topY);

            // Gradient per bucket bar
            ctx.fillStyle = maxVal > 0.8 ? '#38bdf8' : this.options.envelopeTopColor;
            ctx.fillRect(x - 0.5, topY, 1.2, barH);
        }

        // 2. RMS Energy Curve
        if (rms && rms.length === buckets) {
            ctx.strokeStyle = this.options.rmsLineColor;
            ctx.lineWidth = 2;
            ctx.shadowColor = this.options.rmsGlowColor;
            ctx.shadowBlur = 4;

            // Positive RMS path
            ctx.beginPath();
            let first = true;
            for (let i = 0; i < buckets; i++) {
                const bucketTime = pFrom + (i / (buckets - 1 || 1)) * pSpan;
                const x = this.timeToX(bucketTime);
                const r = Math.min(1.5, Math.max(0, rms[i]));
                const y = centerY - r * halfWaveH;
                if (first) { ctx.moveTo(x, y); first = false; }
                else { ctx.lineTo(x, y); }
            }
            ctx.stroke();

            // Mirrored negative RMS path
            ctx.beginPath();
            first = true;
            for (let i = 0; i < buckets; i++) {
                const bucketTime = pFrom + (i / (buckets - 1 || 1)) * pSpan;
                const x = this.timeToX(bucketTime);
                const r = Math.min(1.5, Math.max(0, rms[i]));
                const y = centerY + r * halfWaveH;
                if (first) { ctx.moveTo(x, y); first = false; }
                else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }

    /**
     * Compute aesthetic interval step.
     * @private
     */
    _niceStep(val) {
        const exp = Math.floor(Math.log10(val));
        const frac = val / Math.pow(10, exp);
        let niceFrac;
        if (frac < 1.5) niceFrac = 1;
        else if (frac < 3) niceFrac = 2;
        else if (frac < 7) niceFrac = 5;
        else niceFrac = 10;
        return niceFrac * Math.pow(10, exp);
    }

    /**
     * Format time label for ruler.
     * @private
     */
    _formatTimeLabel(t, span) {
        if (span < 2) return `${t.toFixed(2)}s`;
        if (span < 10) return `${t.toFixed(1)}s`;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
        return `${s}s`;
    }

    /**
     * Setup DOM mouse/wheel event listeners.
     * @private
     */
    _initEvents() {
        const getX = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return e.clientX - rect.left;
        };

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const x = getX(e);
            const t = this.xToTime(x);

            if (e.shiftKey) {
                // Region selection mode
                this.isSelectingRegion = true;
                this.selectionStart = t;
                this.selectionEnd = t;
                this.render();
            } else {
                // Playhead scrub mode
                this.isDraggingPlayhead = true;
                this.setPlayhead(t);
                if (this.onSeekCallback) this.onSeekCallback(t);
            }
        });

        window.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const inBounds = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );

            if (inBounds) {
                this.hoverX = e.clientX - rect.left;
                this.hoverTime = this.xToTime(this.hoverX);
            } else if (!this.isDraggingPlayhead && !this.isSelectingRegion) {
                this.hoverX = null;
                this.hoverTime = null;
            }

            if (this.isDraggingPlayhead) {
                const x = e.clientX - rect.left;
                const t = this.xToTime(x);
                this.setPlayhead(t);
                if (this.onSeekCallback) this.onSeekCallback(t);
            } else if (this.isSelectingRegion) {
                const x = e.clientX - rect.left;
                this.selectionEnd = this.xToTime(x);
                this.render();
            } else if (inBounds) {
                this.render();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingPlayhead) {
                this.isDraggingPlayhead = false;
            }
            if (this.isSelectingRegion) {
                this.isSelectingRegion = false;
                const sel = this.getSelection();
                if (sel && this.onRegionSelectCallback) {
                    this.onRegionSelectCallback(sel.from, sel.to);
                }
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const x = getX(e);
            const ratio = Math.max(0, Math.min(1, x / this.cssWidth));
            const factor = e.deltaY < 0 ? 1.25 : 0.8;
            this.zoom(factor, ratio);
        }, { passive: false });

        this.canvas.addEventListener('mouseleave', () => {
            if (!this.isDraggingPlayhead && !this.isSelectingRegion) {
                this.hoverX = null;
                this.hoverTime = null;
                this.render();
            }
        });
    }
}
