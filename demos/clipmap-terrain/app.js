// demos/clipmap-terrain/app.js
import { HeightmapGenerator } from './heightmap.js';
import { FlightCamera } from './flight.js';
import { TerrainUI } from './ui.js';

class ClipmapApp {
    constructor() {
        this.canvas = document.getElementById('c');
        this.scene = this.canvas.getContext('scene');
        if (!this.scene) {
            console.error('Failed to get 3D scene context');
            return;
        }

        this.initScene();
        this.initClipmap();
        this.initFlightAndUI();
        this.lastTime = performance.now();

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initScene() {
        // ACES tonemapping and PBR environment
        this.scene.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });
        try {
            this.scene.setEnvironment({
                hdr: '../lighting-demo/hdri/kloofendal_43d_clear_puresky_2k.hdr',
                intensity: 1.0,
            });
        } catch (e) {
            console.warn('HDR environment load skipped:', e);
        }

        // Directional Sun Light
        this.sun = this.scene.createLight({
            type: 'directional',
            direction: [-0.4, -0.7, -0.5],
            color: [1.0, 0.97, 0.92],
            intensity: 3.2,
        });
        this.sun.castsShadow = true;
        this.sun.cascadeCount = 4;
        this.sun.shadowNormalBias = 0.05;

        // Camera setup
        this.cameraNode = this.scene.createCamera({
            fov: 65,
            near: 1.0,
            far: 50000.0,
        });
        this.scene.activeCamera = this.cameraNode;
    }

    initClipmap() {
        // Create Geometry Clipmap Terrain
        this.clipmap = this.scene.createClipmapTerrain({
            levels: 6,
            resolution: 128,
            cellSize: 2.0,
            heightScale: 1.0,
            seaLevel: 0.0,
            snowLine: 1200.0,
            planetRadius: 0.0, // Flat terrain mode
            detailRelief: 18.0,
            detailWavelength: 24.0,
            detailGain: 0.5,
            detailOctaves: 3,
            materials: {
                rock: { albedo: [0.38, 0.36, 0.35], roughness: 0.85 },
                snow: { albedo: [0.92, 0.95, 0.98], roughness: 0.35 },
                sand: { albedo: [0.76, 0.70, 0.50], roughness: 0.90 },
                grass: { albedo: [0.22, 0.42, 0.18], roughness: 0.80 },
            },
            forest: {
                albedo: [0.12, 0.26, 0.10],
                strength: 0.70,
            }
        });

        // Generate heightmap layers
        const hgen = new HeightmapGenerator(42);
        const w = 512, h = 512;
        const layer0 = hgen.generateLayer(w, h, 8.0, 0, 0);

        this.clipmap.setHeightLayer(0, {
            data: layer0,
            width: w,
            height: h,
            originX: 0,
            originZ: 0,
            metresPerCell: 8.0,
            wrapX: false,
            bandLimited: false,
        });
    }

    initFlightAndUI() {
        this.flightCamera = new FlightCamera(this.cameraNode, this.clipmap, this.canvas);
        this.ui = new TerrainUI(this.clipmap, this.flightCamera, this.sun);
    }

    animate(now) {
        const dt = Math.min(0.1, (now - this.lastTime) * 0.001);
        this.lastTime = now;

        const camInfo = this.flightCamera.update(dt);

        // Update Clipmap terrain center position (displaces concentric LOD rings)
        if (this.clipmap) {
            this.clipmap.update(camInfo.x, camInfo.y, camInfo.z);
            this.ui.updateStats(camInfo);
        }

        requestAnimationFrame(this.animate);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new ClipmapApp();
});
