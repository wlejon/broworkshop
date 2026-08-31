/**
 * filmstrip.js — Video Filmstrip Thumbnail Strip Visualizer
 *
 * Consumes bro.media.thumbnails pixel data and renders an interactive
 * multi-frame timeline ribbon with timecode badges, frame hover tooltips,
 * and click-to-seek synchronization.
 */

export class FilmstripVisualizer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {HTMLElement} [container]
     * @param {Object} [options]
     */
    constructor(canvas, container = null, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.container = container || canvas.parentElement;
        this.options = Object.assign({
            bgColor: '#0e1118',
            borderColor: '#2b3248',
            badgeBg: 'rgba(15, 23, 42, 0.85)',
            badgeTextColor: '#cbd5e1',
            activeBorderColor: '#38bdf8',
            hoverBorderColor: '#a78bfa',
            playheadColor: '#f43f5e',
            frameMargin: 2,
            badgeHeight: 16,
        }, options);

        this.strip = null;
        this.duration = 0;
        this.windowFrom = 0;
        this.windowTo = 0;
        this.playheadTime = 0;

        // Hover & interaction
        this.hoverIndex = -1;
        this.hoverTime = null;
        this.tooltipEl = null;

        // Callbacks
        this.onSeekCallback = null;
        this.onFrameHoverCallback = null;

        this._createTooltip();
        this._initEvents();
        this.resize();
    }

    /**
     * Set thumbnail strip data from bro.media.thumbnails.
     * @param {Object|null} stripData
     * @param {number} [totalDuration]
     */
    setData(stripData, totalDuration) {
        this.strip = stripData;
        this.duration = totalDuration || (stripData ? (stripData.times[stripData.times.length - 1] || 0) : 0);
        this.hoverIndex = -1;
        this._hideTooltip();
        this.render();
    }

    /**
     * Update active playback time to position playhead marker.
     * @param {number} time
     */
    setPlayhead(time) {
        this.playheadTime = Math.max(0, Math.min(this.duration || 1, time));
        this.render();
    }

    /**
     * Set active time window (for zoomed filmstrip).
     * @param {number} from
     * @param {number} to
     */
    setWindow(from, to) {
        this.windowFrom = from;
        this.windowTo = to;
        this.render();
    }

    /**
     * Set seek callback.
     * @param {(time: number) => void} cb
     */
    onSeek(cb) {
        this.onSeekCallback = cb;
    }

    /**
     * Set frame hover callback.
     * @param {(info: Object|null) => void} cb
     */
    onHover(cb) {
        this.onFrameHoverCallback = cb;
    }

    /**
     * Resize canvas to container bounds.
     */
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(100, Math.floor(rect.width || this.canvas.width || 800));
        const h = Math.max(40, Math.floor(rect.height || this.canvas.height || 72));

        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssWidth = w;
        this.cssHeight = h;
        this.render();
    }

    /**
     * Render the filmstrip canvas.
     */
    render() {
        const ctx = this.ctx;
        const w = this.cssWidth || this.canvas.width;
        const h = this.cssHeight || this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = this.options.bgColor;
        ctx.fillRect(0, 0, w, h);

        if (!this.strip || !this.strip.count || !this.strip.data) {
            ctx.fillStyle = '#4a5568';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                this.duration ? 'No video frames / audio-only media' : 'Load video file to extract filmstrip',
                w / 2, h / 2
            );
            return;
        }

        const strip = this.strip;
        const count = strip.count;
        const srcW = strip.width;
        const srcH = strip.height;
        const totalStripSrcW = srcW * count;

        // Render thumbnails via temporary offscreen canvas or putImageData
        if (!this._offscreenCanvas || this._offscreenCanvas.width !== totalStripSrcW || this._offscreenCanvas.height !== srcH) {
            this._offscreenCanvas = document.createElement('canvas');
            this._offscreenCanvas.width = totalStripSrcW;
            this._offscreenCanvas.height = srcH;
            const offCtx = this._offscreenCanvas.getContext('2d');
            const imgData = new ImageData(strip.data, totalStripSrcW, srcH);
            offCtx.putImageData(imgData, 0, 0);
        }

        // Layout thumbnails across available width
        const badgeH = this.options.badgeHeight;
        const frameDisplayH = h - badgeH;
        const frameDisplayW = w / count;

        for (let i = 0; i < count; i++) {
            const destX = i * frameDisplayW;
            const srcX = i * srcW;
            const time = strip.times[i] || 0;

            // Draw frame image scaled to cell
            ctx.drawImage(
                this._offscreenCanvas,
                srcX, 0, srcW, srcH,
                destX, 0, frameDisplayW, frameDisplayH
            );

            // Frame border separator
            ctx.strokeStyle = (i === this.hoverIndex) ? this.options.hoverBorderColor : this.options.borderColor;
            ctx.lineWidth = (i === this.hoverIndex) ? 2 : 1;
            ctx.strokeRect(destX, 0, frameDisplayW, frameDisplayH);

            // Timecode Badge at bottom
            ctx.fillStyle = (i === this.hoverIndex) ? '#312e81' : this.options.badgeBg;
            ctx.fillRect(destX, frameDisplayH, frameDisplayW, badgeH);

            ctx.fillStyle = (i === this.hoverIndex) ? '#e0e7ff' : this.options.badgeTextColor;
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${time.toFixed(2)}s`, destX + frameDisplayW / 2, frameDisplayH + badgeH / 2);

            // Frame index number in corner
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(destX + 2, 2, 18, 12);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`#${i + 1}`, destX + 11, 8);
        }

        // Highlight active playhead frame
        if (this.duration > 0 && strip.times && strip.times.length > 0) {
            const activeIdx = this._getActiveFrameIndex(this.playheadTime);
            if (activeIdx >= 0 && activeIdx < count) {
                const destX = activeIdx * frameDisplayW;

                // Active frame glow outline
                ctx.strokeStyle = this.options.activeBorderColor;
                ctx.lineWidth = 2;
                ctx.strokeRect(destX + 1, 1, frameDisplayW - 2, frameDisplayH - 2);

                // Playhead needle indicator
                const needleRatio = (this.playheadTime - (strip.times[0] || 0)) / ((strip.times[count - 1] || this.duration) || 1);
                const needleX = Math.max(0, Math.min(w, needleRatio * w));

                ctx.strokeStyle = this.options.playheadColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(needleX, 0);
                ctx.lineTo(needleX, h);
                ctx.stroke();
            }
        }
    }

    /**
     * Find thumbnail frame index closest to given time.
     * @private
     */
    _getActiveFrameIndex(time) {
        if (!this.strip || !this.strip.times) return -1;
        const times = this.strip.times;
        let closest = 0;
        let minDiff = Infinity;
        for (let i = 0; i < times.length; i++) {
            const diff = Math.abs(times[i] - time);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        }
        return closest;
    }

    /**
     * Create floating hover tooltip.
     * @private
     */
    _createTooltip() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'filmstrip-hover-tooltip';
        this.tooltipEl.style.display = 'none';
        this.tooltipEl.style.position = 'absolute';
        this.tooltipEl.style.pointerEvents = 'none';
        this.tooltipEl.style.zIndex = '100';
        if (this.container) {
            this.container.style.position = 'relative';
            this.container.appendChild(this.tooltipEl);
        }
    }

    /**
     * Hide hover tooltip.
     * @private
     */
    _hideTooltip() {
        if (this.tooltipEl) {
            this.tooltipEl.style.display = 'none';
        }
    }

    /**
     * Setup DOM interaction events.
     * @private
     */
    _initEvents() {
        const getFrameFromEvent = (e) => {
            if (!this.strip || !this.strip.count) return null;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const count = this.strip.count;
            const frameW = rect.width / count;
            const idx = Math.floor(x / frameW);
            if (idx < 0 || idx >= count) return null;
            return {
                index: idx,
                time: this.strip.times[idx] || 0,
                x: idx * frameW,
                width: frameW,
            };
        };

        this.canvas.addEventListener('mousemove', (e) => {
            const frame = getFrameFromEvent(e);
            if (frame) {
                this.hoverIndex = frame.index;
                this.hoverTime = frame.time;
                this.render();

                // Update tooltip
                if (this.tooltipEl) {
                    const rect = this.canvas.getBoundingClientRect();
                    this.tooltipEl.style.display = 'block';
                    this.tooltipEl.innerHTML = `
                        <div class="tip-time">${frame.time.toFixed(3)}s</div>
                        <div class="tip-meta">Frame #${frame.index + 1} / ${this.strip.count}</div>
                        <div class="tip-dim">${this.strip.width}×${this.strip.height}</div>
                    `;
                    const tipX = Math.max(8, Math.min(rect.width - 100, e.clientX - rect.left - 45));
                    this.tooltipEl.style.left = `${tipX}px`;
                    this.tooltipEl.style.top = '-48px';
                }

                if (this.onFrameHoverCallback) {
                    this.onFrameHoverCallback({
                        index: frame.index,
                        time: frame.time,
                        width: this.strip.width,
                        height: this.strip.height,
                    });
                }
            } else {
                this.hoverIndex = -1;
                this.hoverTime = null;
                this._hideTooltip();
                this.render();
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoverIndex = -1;
            this.hoverTime = null;
            this._hideTooltip();
            this.render();
            if (this.onFrameHoverCallback) this.onFrameHoverCallback(null);
        });

        this.canvas.addEventListener('click', (e) => {
            const frame = getFrameFromEvent(e);
            if (frame && this.onSeekCallback) {
                this.onSeekCallback(frame.time);
            }
        });
    }
}
