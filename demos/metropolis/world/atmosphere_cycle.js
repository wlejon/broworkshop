// Hillaire physical atmosphere, starfield, incident-metered exposure, and day/dusk/night cycle.

const SUN_LUX = 128000;

const PRESETS = {
    day: { timeHours: 13.5, turbidity: 5.5 },
    dusk: { timeHours: 17.82, turbidity: 9.0 },
    night: { timeHours: 22.5, turbidity: 4.5 },
};

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

function normalize3(x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
}

export function createAtmosphereCycle(scene) {
    scene.setToneMap({ mode: 'aces' });
    const BASE_EXPOSURE = {
        mode: 'auto',
        meter: 'incident',
        compensation: -0.18,
        speedUp: 4,
        speedDown: 2,
    };
    const SNAP_EXPOSURE = {
        mode: 'auto',
        meter: 'incident',
        compensation: -0.18,
        speedUp: 120,
        speedDown: 120,
    };
    scene.setExposure(BASE_EXPOSURE);
    scene.setStarfield?.({ starCount: 1600, starSize: 1.7, twinkleSpeed: 0.8 });

    const sun = scene.createLight({
        type: 'directional',
        color: [1, 1, 1],
        intensity: SUN_LUX,
        castsShadow: true,
        shadowDistance: 260,
        shadowBias: 0.0005,
        shadowNormalBias: 0.04,
    });
    const moonLight = scene.createLight({
        type: 'directional',
        color: [0.58, 0.74, 1.0],
        intensity: 0,
        castsShadow: false,
    });
    const nightFill = scene.createLight({
        type: 'directional',
        direction: [0, -1, 0],
        color: [0.28, 0.42, 0.78],
        intensity: 0,
        castsShadow: false,
    });

    let mode = 'day';
    let timeHours = PRESETS.day.timeHours;
    let turbidity = PRESETS.day.turbidity;
    let appliedTurbidity = -1;
    let nightFactor = 0;
    let emissiveScale = 0.45;
    let sunDir = [0.35, 0.85, 0.39];
    let autoCycle = false;
    let cycleRate = 0.25;
    let exposureSnapTimer = 0;

    function triggerExposureSnap() {
        exposureSnapTimer = 0.15;
        scene.setExposure(SNAP_EXPOSURE);
    }

    function applySolarState() {
        const theta = ((timeHours - 6.0) / 24.0) * Math.PI * 2.0;
        const azTilt = 0.55;
        const elevSin = Math.sin(theta) * 0.88;
        const horiz = Math.cos(theta);
        const dx = horiz * Math.cos(azTilt) + Math.sin(theta) * 0.24;
        const dy = elevSin;
        const dz = horiz * Math.sin(azTilt) - 0.18;
        sunDir = normalize3(dx, dy, dz);
        sun.direction = [-sunDir[0], -sunDir[1], -sunDir[2]];

        const sunElev = sunDir[1];
        // Smoothly attenuate direct solar intensity through the horizon and disable below -0.02;
        // keep shadows active whenever direct sun illumination is present (sunElev > 0.002).
        const horizonAtten = sunElev <= -0.02 ? 0.0 : smoothstep(-0.02, 0.18, sunElev);
        sun.intensity = SUN_LUX * horizonAtten;
        sun.castsShadow = sun.intensity > 0 && sunElev > 0.002;

        nightFactor = clamp((0.12 - sunElev) / 0.24, 0, 1);
        const duskFactor = clamp(1.0 - Math.abs(sunElev - 0.03) / 0.20, 0, 1);
        emissiveScale = clamp(0.45 + 1.55 * duskFactor + 2.75 * nightFactor, 0.45, 3.2);

        if (nightFactor > 0.65) mode = 'night';
        else if (duskFactor > 0.35 || nightFactor > 0.08) mode = 'dusk';
        else mode = 'day';

        if (nightFactor > 0.001) {
            const mTheta = theta + Math.PI * 0.92;
            let mx = Math.cos(mTheta) * 0.65;
            let my = Math.max(0.42, Math.sin(mTheta) * 0.78 + 0.35);
            let mz = Math.sin(mTheta) * 0.52 + 0.35;
            const mDir = normalize3(mx, my, mz);
            moonLight.direction = [-mDir[0], -mDir[1], -mDir[2]];
            moonLight.intensity = SUN_LUX * 0.000018 * nightFactor;
            nightFill.intensity = SUN_LUX * 0.000008 * nightFactor;
        } else {
            moonLight.intensity = 0;
            nightFill.intensity = 0;
        }

        if (Math.abs(turbidity - appliedTurbidity) > 0.05) {
            appliedTurbidity = turbidity;
            scene.setAtmosphere({
                enabled: true,
                turbidity,
                groundAlbedo: [0.16, 0.17, 0.19],
                seaLevel: 0,
            });
        }
    }

    function setPreset(name) {
        const key = PRESETS[name] ? name : 'day';
        const p = PRESETS[key];
        const prev = timeHours;
        timeHours = p.timeHours;
        turbidity = p.turbidity;
        applySolarState();
        mode = key;
        const dh = Math.abs(timeHours - prev);
        if (Math.min(dh, 24 - dh) > 1.0) triggerExposureSnap();
        return getState();
    }

    function setTimeOfDay(hours0to24) {
        const h = Number(hours0to24);
        if (!Number.isFinite(h)) return getState();
        const prev = timeHours;
        timeHours = ((h % 24) + 24) % 24;
        const elevApprox = Math.sin(((timeHours - 6.0) / 24.0) * Math.PI * 2.0);
        const duskMix = clamp(1.0 - Math.abs(elevApprox) / 0.25, 0, 1);
        turbidity = 5.0 + 4.0 * duskMix;
        applySolarState();
        const dh = Math.abs(timeHours - prev);
        if (Math.min(dh, 24 - dh) > 1.5) triggerExposureSnap();
        return getState();
    }

    function setAutoCycle(enabled, hoursPerSec = 0.25) {
        autoCycle = !!enabled;
        if (Number.isFinite(hoursPerSec)) cycleRate = hoursPerSec;
    }

    function update(dt) {
        if (exposureSnapTimer > 0 && dt > 0) {
            exposureSnapTimer -= dt;
            if (exposureSnapTimer <= 0) {
                exposureSnapTimer = 0;
                scene.setExposure(BASE_EXPOSURE);
            }
        }
        if (!autoCycle || !(dt > 0)) return;
        setTimeOfDay(timeHours + dt * cycleRate);
    }

    function getState() {
        return {
            mode,
            timeHours,
            nightFactor,
            sunDir: sunDir.slice(),
            emissiveScale,
        };
    }

    function dispose() {
        try { scene.destroyNode(sun); } catch (_) {}
        try { scene.destroyNode(moonLight); } catch (_) {}
        try { scene.destroyNode(nightFill); } catch (_) {}
    }

    setPreset('day');

    return {
        setPreset,
        setTimeOfDay,
        setAutoCycle,
        update,
        getState,
        dispose,
    };
}
