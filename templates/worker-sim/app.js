// app.js — Main thread bootstrap, worker lifecycle, zero-copy buffer transfer, and Canvas rendering loop
import {
    MSG_INIT, MSG_CONFIG, MSG_MOUSE, MSG_FRAME, MSG_RECYCLE_BUFFER,
    MSG_PAUSE, MSG_RESUME, MSG_STEP, MSG_RESET,
    MODE_BOIDS, MODE_PARTICLES, MODE_GRAVITY,
    ENT_STRIDE, OFFSET_X, OFFSET_Y, OFFSET_VX, OFFSET_VY, OFFSET_MASS, OFFSET_COLOR
} from './protocol.js';

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas.getContext('2d');

    const valFps = document.getElementById('valFps');
    const valFrameTime = document.getElementById('valFrameTime');
    const valTps = document.getElementById('valTps');
    const valStepTime = document.getElementById('valStepTime');
    const valEntityCount = document.getElementById('valEntityCount');
    const valTransfer = document.getElementById('valTransfer');

    const modeButtons = document.querySelectorAll('.btn-mode');
    const sliderCount = document.getElementById('sliderCount');
    const lblCount = document.getElementById('lblCount');
    const sliderSpeed = document.getElementById('sliderSpeed');
    const btnPause = document.getElementById('btnPause');
    const btnStep = document.getElementById('btnStep');
    const btnReset = document.getElementById('btnReset');

    const width = canvas.width;
    const height = canvas.height;

    let isPaused = false;
    let currentMode = MODE_BOIDS;
    let entityCount = parseInt(sliderCount.value, 10);

    // Latest render buffer from worker
    let latestBuffer = null;
    let latestCount = entityCount;

    // Performance measurements
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let frameRenderTimeMs = 0;
    let workerTps = 60;
    let workerStepMs = 0;
    let bytesTransferred = 0;

    // 1. Instantiate Worker
    const worker = new Worker(new URL('./sim_worker.js', import.meta.url), { type: 'module' });

    // Handle messages from Worker
    worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;

        if (msg.type === MSG_FRAME) {
            // Received transferred binary buffer
            const rawBuffer = msg.buffer;
            bytesTransferred += rawBuffer.byteLength;

            // Render current frame
            renderFrame(rawBuffer, msg.count);

            workerTps = msg.tps || 60;
            workerStepMs = msg.stepTimeMs || 0;

            // Recycle buffer back to worker for zero-allocation ping-pong
            worker.postMessage({
                type: MSG_RECYCLE_BUFFER,
                buffer: rawBuffer
            }, [rawBuffer]);
        }
    };

    // Initialize worker simulation
    worker.postMessage({
        type: MSG_INIT,
        width,
        height,
        count: entityCount,
        mode: currentMode
    });

    // 2. High-Performance Canvas Rendering
    function renderFrame(rawBuffer, count) {
        const t0 = performance.now();
        const floatView = new Float32Array(rawBuffer);

        // Semi-transparent fade for motion trails
        ctx.fillStyle = currentMode === MODE_GRAVITY ? 'rgba(5, 7, 14, 0.25)' : 'rgba(6, 9, 16, 0.4)';
        ctx.fillRect(0, 0, width, height);

        // Draw entities
        for (let i = 0; i < count; i++) {
            const off = i * ENT_STRIDE;
            const x = floatView[off + OFFSET_X];
            const y = floatView[off + OFFSET_Y];
            const vx = floatView[off + OFFSET_VX];
            const vy = floatView[off + OFFSET_VY];
            const hue = floatView[off + OFFSET_COLOR];

            if (currentMode === MODE_BOIDS) {
                // Draw boid arrow
                const ang = Math.atan2(vy, vx);
                const len = 7;
                ctx.fillStyle = `hsl(${hue}, 85%, 60%)`;
                ctx.beginPath();
                ctx.moveTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
                ctx.lineTo(x + Math.cos(ang + 2.4) * len * 0.6, y + Math.sin(ang + 2.4) * len * 0.6);
                ctx.lineTo(x + Math.cos(ang - 2.4) * len * 0.6, y + Math.sin(ang - 2.4) * len * 0.6);
                ctx.closePath();
                ctx.fill();
            } else if (currentMode === MODE_PARTICLES) {
                // Elastic particle circle
                ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (currentMode === MODE_GRAVITY) {
                // Gravity star node
                ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
                ctx.beginPath();
                ctx.arc(x, y, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        frameRenderTimeMs = performance.now() - t0;
        frameCount++;

        // Update FPS & metrics every 500ms
        const now = performance.now();
        if (now - lastFpsTime >= 500) {
            const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
            valFps.textContent = `${fps} FPS`;
            valFrameTime.textContent = `${frameRenderTimeMs.toFixed(1)} ms`;
            valTps.textContent = `${workerTps} TPS`;
            valStepTime.textContent = `${workerStepMs.toFixed(1)} ms`;
            valEntityCount.textContent = count.toLocaleString();

            const mbSec = ((bytesTransferred / (1024 * 1024)) / ((now - lastFpsTime) / 1000)).toFixed(1);
            valTransfer.textContent = `Zero-Copy (${mbSec} MB/s)`;

            bytesTransferred = 0;
            frameCount = 0;
            lastFpsTime = now;
        }
    }

    // 3. Mouse Interaction Handling
    let isMouseDown = false;
    let activeMouseButton = 0;

    function sendMouseState(x, y, active, button) {
        worker.postMessage({
            type: MSG_MOUSE,
            x, y,
            active,
            button
        });
    }

    canvas.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        activeMouseButton = e.shiftKey ? 1 : e.button;
        sendMouseState(x, y, true, activeMouseButton);
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        sendMouseState(x, y, true, activeMouseButton);
    });

    window.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            sendMouseState(-1000, -1000, false, 0);
        }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 4. UI Controls Wiring
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
            worker.postMessage({
                type: MSG_CONFIG,
                mode: currentMode
            });
        });
    });

    sliderCount.addEventListener('input', () => {
        entityCount = parseInt(sliderCount.value, 10);
        lblCount.textContent = entityCount >= 1000 ? `${entityCount / 1000}k` : `${entityCount}`;
    });

    sliderCount.addEventListener('change', () => {
        worker.postMessage({
            type: MSG_CONFIG,
            count: entityCount
        });
    });

    sliderSpeed.addEventListener('input', () => {
        worker.postMessage({
            type: MSG_CONFIG,
            speedScale: parseFloat(sliderSpeed.value)
        });
    });

    btnPause.addEventListener('click', () => {
        isPaused = !isPaused;
        btnPause.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
        worker.postMessage({
            type: isPaused ? MSG_PAUSE : MSG_RESUME
        });
    });

    btnStep.addEventListener('click', () => {
        if (isPaused) {
            worker.postMessage({ type: MSG_STEP });
        }
    });

    btnReset.addEventListener('click', () => {
        worker.postMessage({ type: MSG_RESET });
    });
});
