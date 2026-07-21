// gallery.js — capture screenshots for all milestones: M2, M3, M4, and M5.
import { ready, getCam, getPlayer, getMapView, getSeason, getAtlas } from "/app/app.js";

// 1. Pump until ready
let ok = false;
for (let i = 0; i < 1500; i++) {
    if (typeof wallSleep === 'function') wallSleep(60);
    advanceTime(16);
    if (typeof flush === 'function') flush();
    if (ready()) { ok = true; break; }
}
if (!ok) { throw new Error('Not ready'); }

const cam = getCam();
const player = getPlayer();
const mapview = getMapView();
const season = getSeason();
const atlas = getAtlas();

// Helper to look at a point
function lookAt(eye, target) {
    cam.pos[0] = eye[0]; cam.pos[1] = eye[1]; cam.pos[2] = eye[2];
    const dx = target[0] - eye[0];
    const dy = target[1] - eye[1];
    const dz = target[2] - eye[2];
    
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, Math.sqrt(dx*dx + dz*dz));
    
    const cy = Math.cos(yaw/2), sy = Math.sin(yaw/2);
    const cp = Math.cos(pitch/2), sp = Math.sin(pitch/2);
    
    cam.rot[0] = cy * sp;
    cam.rot[1] = sy * cp;
    cam.rot[2] = -sy * sp;
    cam.rot[3] = cy * cp;
}

// Settle frames
function settle(n = 60) {
    for (let i = 0; i < n; i++) {
        advanceTime(16);
        if (typeof flush === 'function') flush();
        if (typeof wallSleep === 'function') wallSleep(30);
    }
}

console.log('--- STARTING GALLERY SCREENSHOT RUN ---');

// 1. M2 Coast and river valley
lookAt([1800, 350, 1500], [0, 50, 0]);
settle();
screenshot('m2_coast_valley.png');
console.log('SHOT m2_coast_valley.png');

// 2. M3 Ground-level forest
const forestY = atlas.sampleHeight(800, 800);
lookAt([800, forestY + 2.0, 800], [1200, forestY + 12.0, 1200]);
settle();
screenshot('m3_forest.png');
console.log('SHOT m3_forest.png');

// 3. M3 Alpine ridge
const alpineY = atlas.sampleHeight(-200, -800);
lookAt([-200, alpineY + 10.0, -800], [0, alpineY + 50.0, -400]);
settle();
screenshot('m3_alpine.png');
console.log('SHOT m3_alpine.png');

// 4. M4 On-foot + open map
player.onFoot = true;
const beachY = atlas.sampleHeight(-1200, 1200);
cam.pos[0] = -1200; cam.pos[2] = 1200;
cam.pos[1] = beachY + 1.8;
mapview.open = true;
settle();
screenshot('m4_onfoot_map.png');
console.log('SHOT m4_onfoot_map.png');

// Restore freefly and close map for seasons
mapview.open = false;
player.onFoot = false;

// 5. M5 Season showcase: Winter
lookAt([1500, 800, 1500], [0, 200, 0]);
// Query the slider input elements
const sliders = document.querySelectorAll('#season-panel input[type="range"]');
const seasonSlider = sliders[0];
const timeSlider = sliders[1];

// Set winter
seasonSlider.value = 0.05;
seasonSlider.dispatchEvent(new Event('input'));
// Set mid day (12:00)
timeSlider.value = 12.0;
timeSlider.dispatchEvent(new Event('input'));
settle(80);
screenshot('m5_winter.png');
console.log('SHOT m5_winter.png');

// Autumn
seasonSlider.value = 0.85;
seasonSlider.dispatchEvent(new Event('input'));
settle(80);
screenshot('m5_autumn.png');
console.log('SHOT m5_autumn.png');

console.log('--- GALLERY RUN COMPLETED ---');
