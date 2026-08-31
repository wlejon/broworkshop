// demos/clipmap-terrain/ui.js

export class TerrainUI {
    constructor(clipmap, flightCamera, sunLight) {
        this.clipmap = clipmap;
        this.flightCamera = flightCamera;
        this.sunLight = sunLight;

        this.dom = {
            panel: document.getElementById('panel'),
            togglePanelBtn: document.getElementById('togglePanelBtn'),
            reopenPanelBtn: document.getElementById('reopenPanelBtn'),
            camSpeed: document.getElementById('camSpeed'),
            camSpeedVal: document.getElementById('camSpeedVal'),
            snowLine: document.getElementById('snowLine'),
            snowLineVal: document.getElementById('snowLineVal'),
            detailRelief: document.getElementById('detailRelief'),
            detailReliefVal: document.getElementById('detailReliefVal'),
            detailWavelength: document.getElementById('detailWavelength'),
            detailWavelengthVal: document.getElementById('detailWavelengthVal'),
            forestStrength: document.getElementById('forestStrength'),
            forestStrengthVal: document.getElementById('forestStrengthVal'),
            sunPitch: document.getElementById('sunPitch'),
            sunPitchVal: document.getElementById('sunPitchVal'),
            sunHeading: document.getElementById('sunHeading'),
            sunHeadingVal: document.getElementById('sunHeadingVal'),
            sunIntensity: document.getElementById('sunIntensity'),
            sunIntensityVal: document.getElementById('sunIntensityVal'),
            pillTris: document.getElementById('pillTris'),
            pillLevels: document.getElementById('pillLevels'),
            pillFar: document.getElementById('pillFar'),
            pillAlt: document.getElementById('pillAlt'),
            infoResolution: document.getElementById('infoResolution'),
            infoCellSize: document.getElementById('infoCellSize'),
            infoVertices: document.getElementById('infoVertices'),
            infoElevation: document.getElementById('infoElevation'),
        };

        this.initEvents();
    }

    initEvents() {
        // Panel open / close
        this.dom.togglePanelBtn.addEventListener('click', () => {
            this.dom.panel.classList.add('hidden');
            this.dom.reopenPanelBtn.classList.add('show');
        });

        this.dom.reopenPanelBtn.addEventListener('click', () => {
            this.dom.panel.classList.remove('hidden');
            this.dom.reopenPanelBtn.classList.remove('show');
        });

        // Presets
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.flightCamera.setPreset(preset);
            });
        });

        // Sliders
        this.dom.camSpeed.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.flightCamera.speed = v;
            this.dom.camSpeedVal.textContent = v.toFixed(0) + 'm/s';
        });

        this.dom.snowLine.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.dom.snowLineVal.textContent = v.toFixed(0) + 'm';
            if (this.clipmap) this.clipmap.setSnowLine(v);
        });

        const updateDetail = () => {
            const relief = parseFloat(this.dom.detailRelief.value);
            const wave = parseFloat(this.dom.detailWavelength.value);
            this.dom.detailReliefVal.textContent = relief.toFixed(0) + 'm';
            this.dom.detailWavelengthVal.textContent = wave.toFixed(0) + 'm';
            if (this.clipmap) {
                this.clipmap.setDetail({
                    relief: relief,
                    wavelength: wave,
                    gain: 0.5,
                    octaves: 3
                });
            }
        };

        this.dom.detailRelief.addEventListener('input', updateDetail);
        this.dom.detailWavelength.addEventListener('input', updateDetail);

        this.dom.forestStrength.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.dom.forestStrengthVal.textContent = v.toFixed(2);
            if (this.clipmap) {
                this.clipmap.setForest({
                    albedo: [0.15, 0.28, 0.12],
                    strength: v
                });
            }
        });

        const updateSun = () => {
            const pitchDeg = parseFloat(this.dom.sunPitch.value);
            const headDeg = parseFloat(this.dom.sunHeading.value);
            const intensity = parseFloat(this.dom.sunIntensity.value);

            this.dom.sunPitchVal.textContent = pitchDeg + '°';
            this.dom.sunHeadingVal.textContent = headDeg + '°';
            this.dom.sunIntensityVal.textContent = intensity.toFixed(1);

            const pitchRad = (pitchDeg * Math.PI) / 180;
            const headRad = (headDeg * Math.PI) / 180;

            const dirX = Math.sin(headRad) * Math.cos(pitchRad);
            const dirY = -Math.sin(pitchRad);
            const dirZ = Math.cos(headRad) * Math.cos(pitchRad);

            if (this.sunLight) {
                this.sunLight.direction = [dirX, dirY, dirZ];
                this.sunLight.intensity = intensity;
            }
        };

        this.dom.sunPitch.addEventListener('input', updateSun);
        this.dom.sunHeading.addEventListener('input', updateSun);
        this.dom.sunIntensity.addEventListener('input', updateSun);
    }

    updateStats(camInfo) {
        if (!this.clipmap) return;

        const tris = this.clipmap.triangleCount || 0;
        const levels = this.clipmap.levels || 6;
        const farDist = this.clipmap.farDistance || 0;
        const verts = this.clipmap.vertexCount || 0;

        this.dom.pillTris.textContent = `Triangles: ${(tris / 1000).toFixed(1)}k`;
        this.dom.pillLevels.textContent = `Levels: ${levels}`;
        this.dom.pillFar.textContent = `Far: ${(farDist / 1000).toFixed(1)}km`;
        this.dom.pillAlt.textContent = `Altitude: ${camInfo.agl.toFixed(0)}m AGL`;

        this.dom.infoVertices.textContent = verts.toLocaleString();
        this.dom.infoElevation.textContent = camInfo.groundElev.toFixed(1) + ' m';
    }
}
