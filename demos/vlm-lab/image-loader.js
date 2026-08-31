// demos/vlm-lab/image-loader.js

export class ImageLoader {
    constructor(imageCanvas, overlayCanvas, onImageLoaded) {
        this.imgCanvas = imageCanvas;
        this.overlayCanvas = overlayCanvas;
        this.onImageLoaded = onImageLoaded;

        this.ctx = this.imgCanvas.getContext('2d');
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        this.currentBoxes = [];
        this.currentPreset = 'scenery';

        this.initDropZone();
        this.loadPreset('scenery');
    }

    initDropZone() {
        const dropZone = document.getElementById('dropZone');
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.loadFile(e.dataTransfer.files[0]);
            }
        });
    }

    loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.drawImage(img);
                if (this.onImageLoaded) this.onImageLoaded({ type: 'custom', file: file.name });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    drawImage(img) {
        const w = this.imgCanvas.width;
        const h = this.imgCanvas.height;
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(img, 0, 0, w, h);
        this.clearOverlay();
    }

    loadPreset(presetKey) {
        this.currentPreset = presetKey;
        const w = this.imgCanvas.width;
        const h = this.imgCanvas.height;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        if (presetKey === 'scenery') {
            // Sky gradient
            const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
            sky.addColorStop(0, '#1d3557');
            sky.addColorStop(1, '#a8dadc');
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, w, h);

            // Sun
            ctx.fillStyle = '#ffb703';
            ctx.beginPath();
            ctx.arc(w * 0.8, h * 0.25, 40, 0, Math.PI * 2);
            ctx.fill();

            // Mountain 1 (Left)
            ctx.fillStyle = '#457b9d';
            ctx.beginPath();
            ctx.moveTo(w * 0.1, h * 0.75);
            ctx.lineTo(w * 0.35, h * 0.3);
            ctx.lineTo(w * 0.6, h * 0.75);
            ctx.fill();

            // Mountain 2 (Right)
            ctx.fillStyle = '#2b2d42';
            ctx.beginPath();
            ctx.moveTo(w * 0.4, h * 0.8);
            ctx.lineTo(w * 0.65, h * 0.2);
            ctx.lineTo(w * 0.95, h * 0.8);
            ctx.fill();

            // Ground & river
            ctx.fillStyle = '#2a9d8f';
            ctx.fillRect(0, h * 0.7, w, h * 0.3);

            this.groundTruth = [
                { label: 'Sun', box: [150, 720, 350, 880] },
                { label: 'Peak Alpha', box: [300, 100, 750, 600] },
                { label: 'Peak Beta', box: [200, 400, 800, 950] },
                { label: 'Valley Grass', box: [700, 0, 1000, 1000] }
            ];
        } else if (presetKey === 'room') {
            // Interior room
            ctx.fillStyle = '#3d405b';
            ctx.fillRect(0, 0, w, h);

            // Wall panel
            ctx.fillStyle = '#f4f1de';
            ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.5);

            // Window
            ctx.fillStyle = '#81b29a';
            ctx.fillRect(w * 0.6, h * 0.15, w * 0.25, h * 0.35);

            // Table
            ctx.fillStyle = '#e07a5f';
            ctx.fillRect(w * 0.2, h * 0.6, w * 0.6, h * 0.3);

            this.groundTruth = [
                { label: 'Window', box: [150, 600, 500, 850] },
                { label: 'Wooden Table', box: [600, 200, 900, 800] }
            ];
        } else {
            // Workshop Desk
            ctx.fillStyle = '#1e1e24';
            ctx.fillRect(0, 0, w, h);

            // Laptop
            ctx.fillStyle = '#929084';
            ctx.fillRect(w * 0.3, h * 0.35, w * 0.4, h * 0.35);

            // Coffee Mug
            ctx.fillStyle = '#f7567c';
            ctx.beginPath();
            ctx.arc(w * 0.8, h * 0.65, 30, 0, Math.PI * 2);
            ctx.fill();

            this.groundTruth = [
                { label: 'Laptop', box: [350, 300, 700, 700] },
                { label: 'Coffee Cup', box: [600, 750, 720, 850] }
            ];
        }

        this.clearOverlay();
        if (this.onImageLoaded) this.onImageLoaded({ type: 'preset', key: presetKey, groundTruth: this.groundTruth });
    }

    renderBoundingBoxes(boxes) {
        this.clearOverlay();
        this.currentBoxes = boxes || [];

        const ctx = this.overlayCtx;
        const w = this.overlayCanvas.width;
        const h = this.overlayCanvas.height;

        for (const item of this.currentBoxes) {
            // normalized [ymin, xmin, ymax, xmax] in 0..1000
            const [ymin, xmin, ymax, xmax] = item.box;
            const bx = (xmin / 1000) * w;
            const by = (ymin / 1000) * h;
            const bw = ((xmax - xmin) / 1000) * w;
            const bh = ((ymax - ymin) / 1000) * h;

            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);

            ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.fillRect(bx, by, bw, bh);

            ctx.fillStyle = '#38bdf8';
            ctx.font = '11px sans-serif';
            ctx.fillText(item.label || 'Object', bx + 4, Math.max(14, by - 4));
        }
    }

    clearOverlay() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
}
