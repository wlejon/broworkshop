// season.js — season and time of day simulation loop and UI controls.

import { PALETTES } from './materials.js';

export function createSeasonController(scene, terrain, flora, sky, atlas) {
    // Create Season UI overlay
    const seasonPanel = document.createElement('div');
    seasonPanel.id = 'season-panel';
    Object.assign(seasonPanel.style, {
        position: 'absolute',
        bottom: '15px',
        left: '15px',
        width: '320px',
        background: 'rgba(15, 25, 45, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '10px',
        padding: '12px 16px',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)',
        color: '#eef',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        zIndex: '100'
    });

    const title = document.createElement('div');
    title.innerHTML = '<b style="color:#ffe066;">SEASON & TIME CYCLE</b>';
    title.style.marginBottom = '8px';
    seasonPanel.appendChild(title);

    // Season Slider
    const seasonRow = document.createElement('div');
    seasonRow.style.marginBottom = '8px';
    const seasonLabel = document.createElement('label');
    seasonLabel.innerHTML = 'Season: <span id="season-val">Summer</span>';
    const seasonSlider = document.createElement('input');
    seasonSlider.type = 'range';
    seasonSlider.min = '0';
    seasonSlider.max = '1';
    seasonSlider.step = '0.01';
    seasonSlider.value = '0.5'; // Start in Summer
    Object.assign(seasonSlider.style, { width: '100%', marginTop: '4px' });
    seasonRow.appendChild(seasonLabel);
    seasonRow.appendChild(seasonSlider);
    seasonPanel.appendChild(seasonRow);

    // Time of Day Slider
    const timeRow = document.createElement('div');
    const timeLabel = document.createElement('label');
    timeLabel.innerHTML = 'Time of Day: <span id="time-val">12:00</span>';
    const timeSlider = document.createElement('input');
    timeSlider.type = 'range';
    timeSlider.min = '0';
    timeSlider.max = '24';
    timeSlider.step = '0.1';
    timeSlider.value = '12'; // Noon
    Object.assign(timeSlider.style, { width: '100%', marginTop: '4px' });
    timeRow.appendChild(timeLabel);
    timeRow.appendChild(timeSlider);
    seasonPanel.appendChild(timeRow);

    document.body.appendChild(seasonPanel);

    const baseSnowLine = terrain.snowLine;
    const basePalette = terrain.palette;

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    function lerpColor(c1, c2, t) {
        return [
            lerp(c1[0], c2[0], t),
            lerp(c1[1], c2[1], t),
            lerp(c1[2], c2[2], t)
        ];
    }

    // Update function
    function updateCycle() {
        const season = parseFloat(seasonSlider.value); // 0 = Winter, 0.25 = Spring, 0.5 = Summer, 0.75 = Autumn
        const time = parseFloat(timeSlider.value);

        // 1. Resolve Season names & parameters
        let seasonName = 'Summer';
        let snowLine = baseSnowLine;
        let grassColor = basePalette.grass.albedo;
        let decidColor = [0.18, 0.32, 0.14]; // Green

        if (season < 0.2) {
            // Winter: cold, low snowline, frosty grass
            seasonName = 'Winter';
            const t = season / 0.2;
            snowLine = lerp(baseSnowLine * 0.3, baseSnowLine * 0.6, t);
            grassColor = lerpColor([0.38, 0.40, 0.42], [0.26, 0.32, 0.20], t); // frost grey -> pale green
            decidColor = lerpColor([0.22, 0.18, 0.15], [0.24, 0.32, 0.16], t); // bare brown -> budding green
        } else if (season < 0.4) {
            // Spring: warming, melting snow, bright green grass
            seasonName = 'Spring';
            const t = (season - 0.2) / 0.2;
            snowLine = lerp(baseSnowLine * 0.6, baseSnowLine * 0.9, t);
            grassColor = lerpColor([0.26, 0.32, 0.20], [0.20, 0.35, 0.15], t);
            decidColor = lerpColor([0.24, 0.32, 0.16], [0.18, 0.32, 0.14], t);
        } else if (season < 0.7) {
            // Summer: hot, high snowline, lush grass
            seasonName = 'Summer';
            const t = (season - 0.4) / 0.3;
            snowLine = lerp(baseSnowLine * 0.9, baseSnowLine * 1.3, t);
            grassColor = lerpColor([0.20, 0.35, 0.15], [0.16, 0.30, 0.12], t);
            decidColor = [0.18, 0.32, 0.14];
        } else {
            // Autumn: cooling, golden grass, orange/red deciduous leaves
            seasonName = 'Autumn';
            const t = (season - 0.7) / 0.3;
            snowLine = lerp(baseSnowLine * 1.3, baseSnowLine * 0.3, t);
            grassColor = lerpColor([0.16, 0.30, 0.12], [0.38, 0.28, 0.12], t); // green -> gold/orange
            decidColor = lerpColor([0.18, 0.32, 0.14], [0.42, 0.22, 0.08], t); // green -> red/autumn
        }

        document.getElementById('season-val').textContent = seasonName;
        
        // Push seasonal properties to terrain
        terrain.clipmap.setSnowLine(snowLine);
        
        const tempPalette = {
            rock: basePalette.rock,
            snow: basePalette.snow,
            sand: basePalette.sand,
            grass: { albedo: grassColor, roughness: basePalette.grass.roughness }
        };
        terrain.clipmap.setMaterials(tempPalette);

        // Color the deciduous flora instances
        if (flora && flora.nodes) {
            flora.nodes.forEach(node => {
                // If it's a deciduous instanced node, set color dynamically
                if (node.setColor) {
                    // Decide based on deciduous / pine / shrub color matching
                    if (node.color[0] === 0.18 || node.color[0] === 0.42) {
                        // Deciduous
                        node.setColor(decidColor[0], decidColor[1], decidColor[2]);
                    }
                }
            });
        }

        // 2. Resolve Time of Day
        const hour = Math.floor(time);
        const min = Math.floor((time - hour) * 60);
        document.getElementById('time-val').textContent = 
            `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

        // Sun position rotation
        const angle = (time / 24) * Math.PI * 2 + Math.PI; // offset so 12 is peak
        const sunX = Math.sin(angle);
        const sunY = -Math.cos(angle); // Sun is highest at noon (y = -1.0 in direction)
        const sunZ = -0.38; // offset angle

        if (sky && sky.sun) {
            sky.sun.direction = [sunX, sunY, sunZ];
            
            // Sun intensity and color depending on altitude
            const sunAltitude = -sunY; // positive when sun is up (noon)
            if (sunAltitude > 0) {
                // Daytime
                sky.sun.intensity = lerp(0.2, 3.4, sunAltitude);
                // Golden hour at sunset/sunrise
                const sunsetFactor = clamp(1.0 - Math.abs(sunAltitude), 0.0, 1.0);
                sky.sun.color = lerpColor([1.0, 0.95, 0.85], [1.0, 0.45, 0.15], sunsetFactor);
                scene.setAmbient(lerpColor([0.10, 0.15, 0.22], [0.35, 0.45, 0.55], sunAltitude));
            } else {
                // Nighttime
                sky.sun.intensity = 0.05; // moonlight
                sky.sun.color = [0.4, 0.5, 0.7];
                scene.setAmbient([0.02, 0.03, 0.06]);
            }
        }
    }

    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

    // Listen to changes
    seasonSlider.addEventListener('input', updateCycle);
    timeSlider.addEventListener('input', updateCycle);

    // Initial update
    updateCycle();

    return {
        updateCycle,
        destroy() {
            seasonPanel.remove();
        }
    };
}
