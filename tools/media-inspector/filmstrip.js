// tools/media-inspector/filmstrip.js
export class FilmstripViewer {
    constructor(canvas, onSeek) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onSeek = onSeek;
        this.thumbnails = null;

        this.initEvents();
    }

    setThumbnails(thumbs) {
        this.thumbnails = thumbs;
        this.render();
    }

    initEvents() {
        this.canvas.addEventListener('click', (e) => {
            if (!this.thumbnails || !this.thumbnails.times || this.thumbnails.count <= 0) return;
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, clickX / rect.width));
            const frameIdx = Math.min(
                this.thumbnails.count - 1,
                Math.floor(frac * this.thumbnails.count)
            );
            const seekTime = this.thumbnails.times[frameIdx] || 0;
            if (this.onSeek) this.onSeek(seekTime);
        });
    }

    render() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        if (!this.thumbnails || !this.thumbnails.data || this.thumbnails.count <= 0) {
            ctx.fillStyle = '#121418';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#4a5568';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No video filmstrip thumbnails extracted (audio-only or format unavailable)', width / 2, height / 2 + 4);
            return;
        }

        const count = this.thumbnails.count;
        const frameW = this.thumbnails.width;
        const frameH = this.thumbnails.height;
        const rawData = this.thumbnails.data;

        // Create Offscreen canvas / ImageData to blit the full horizontal strip
        try {
            const stripW = frameW * count;
            const imgData = new ImageData(new Uint8ClampedArray(rawData.buffer || rawData), stripW, frameH);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = stripW;
            tempCanvas.height = frameH;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imgData, 0, 0);

            // Scale to fit canvas
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(tempCanvas, 0, 0, stripW, frameH, 0, 0, width, height);

            // Draw frame dividers and timestamp overlays
            const displayFrameW = width / count;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';

            for (let i = 0; i < count; i++) {
                const x = i * displayFrameW;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();

                const timeVal = this.thumbnails.times ? this.thumbnails.times[i] : (i * 0.5);
                const timeStr = typeof timeVal === 'number' ? timeVal.toFixed(2) + 's' : '';

                ctx.fillRect(x + 2, height - 16, ctx.measureText(timeStr).width + 6, 14);
                ctx.fillStyle = '#f0f3f8';
                ctx.fillText(timeStr, x + 5, height - 5);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            }
        } catch (err) {
            console.error('Filmstrip render error:', err);
            ctx.fillStyle = '#e71d36';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Thumbnail decode failed: ' + err.message, width / 2, height / 2);
        }
    }
}
