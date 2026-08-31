// tools/media-inspector/waveform.js
export class WaveformViewer {
    constructor(canvas, onSeek) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onSeek = onSeek;
        this.peaks = null;
        this.currentTime = 0;
        this.duration = 0;
        this.zoom = 1.0;
        this.panOffset = 0;

        this.initEvents();
    }

    setPeaks(peaks) {
        this.peaks = peaks;
        this.duration = peaks ? peaks.duration : 0;
        this.currentTime = 0;
        this.panOffset = 0;
        this.render();
    }

    setCurrentTime(time) {
        this.currentTime = time;
        this.render();
    }

    setZoom(zoom) {
        this.zoom = Math.max(1.0, Math.min(16.0, zoom));
        this.render();
    }

    initEvents() {
        let isDragging = false;

        const handleSeek = (e) => {
            if (!this.peaks || this.duration <= 0) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const normalizedX = (x / rect.width) / this.zoom + (this.panOffset / (rect.width * this.zoom));
            const clamped = Math.max(0, Math.min(1, normalizedX));
            const seekTime = clamped * this.duration;
            if (this.onSeek) this.onSeek(seekTime);
        };

        this.canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            handleSeek(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) handleSeek(e);
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Wheel zoom / pan
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey) {
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                this.setZoom(this.zoom * delta);
            } else {
                this.panOffset += e.deltaX || e.deltaY;
                this.render();
            }
        });
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.render();
        }
    }

    render() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Background grid & center line
        ctx.fillStyle = '#0b0c0e';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#1d212a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const midY = height / 2;
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();

        if (!this.peaks || !this.peaks.min || !this.peaks.max) {
            ctx.fillStyle = '#4a5568';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No audio waveform data available', width / 2, midY + 4);
            return;
        }

        const bucketCount = this.peaks.buckets || this.peaks.max.length;
        const minArr = this.peaks.min;
        const maxArr = this.peaks.max;
        const rmsArr = this.peaks.rms;

        const visibleWidth = width * this.zoom;
        const startX = -this.panOffset;

        // Draw Peak Envelope (Filled Min/Max)
        ctx.fillStyle = 'rgba(58, 134, 255, 0.35)';
        ctx.strokeStyle = '#3a86ff';
        ctx.lineWidth = 1;

        ctx.beginPath();
        for (let i = 0; i < bucketCount; i++) {
            const x = startX + (i / bucketCount) * visibleWidth;
            if (x < -2 || x > width + 2) continue;

            const maxVal = maxArr[i];
            const yMax = midY - maxVal * (height * 0.44);

            if (i === 0) ctx.moveTo(x, yMax);
            else ctx.lineTo(x, yMax);
        }

        for (let i = bucketCount - 1; i >= 0; i--) {
            const x = startX + (i / bucketCount) * visibleWidth;
            if (x < -2 || x > width + 2) continue;

            const minVal = minArr[i];
            const yMin = midY - minVal * (height * 0.44);
            ctx.lineTo(x, yMin);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw RMS Energy curve (Bright overlay line)
        if (rmsArr && rmsArr.length > 0) {
            ctx.strokeStyle = '#00f5d4';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < bucketCount; i++) {
                const x = startX + (i / bucketCount) * visibleWidth;
                if (x < -2 || x > width + 2) continue;

                const rmsVal = rmsArr[i];
                const yRms = midY - rmsVal * (height * 0.44);
                if (i === 0) ctx.moveTo(x, yRms);
                else ctx.lineTo(x, yRms);
            }
            ctx.stroke();

            // Symmetrical lower RMS
            ctx.beginPath();
            for (let i = 0; i < bucketCount; i++) {
                const x = startX + (i / bucketCount) * visibleWidth;
                if (x < -2 || x > width + 2) continue;

                const rmsVal = rmsArr[i];
                const yRms = midY + rmsVal * (height * 0.44);
                if (i === 0) ctx.moveTo(x, yRms);
                else ctx.lineTo(x, yRms);
            }
            ctx.stroke();
        }

        // Draw Time ticks
        ctx.fillStyle = '#606b7c';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        const numTicks = 8;
        for (let t = 0; t <= numTicks; t++) {
            const frac = t / numTicks;
            const x = startX + frac * visibleWidth;
            if (x >= 0 && x <= width) {
                ctx.strokeStyle = '#242832';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                const sec = (frac * this.duration).toFixed(1) + 's';
                ctx.fillText(sec, x + 4, height - 6);
            }
        }

        // Draw Playhead
        if (this.duration > 0) {
            const playFrac = Math.max(0, Math.min(1, this.currentTime / this.duration));
            const playX = startX + playFrac * visibleWidth;

            ctx.strokeStyle = '#ff0055';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(playX, 0);
            ctx.lineTo(playX, height);
            ctx.stroke();

            // Playhead indicator triangle
            ctx.fillStyle = '#ff0055';
            ctx.beginPath();
            ctx.moveTo(playX - 6, 0);
            ctx.lineTo(playX + 6, 0);
            ctx.lineTo(playX, 8);
            ctx.closePath();
            ctx.fill();
        }
    }
}
