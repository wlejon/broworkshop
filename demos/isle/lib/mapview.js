// mapview.js — minimap and full-screen map views.

import { BIOMES } from './biome.js';

export function createMapView(scene, atlas, cam) {
    // 1. Create a persistent offscreen canvas to pre-render the biome map
    const mapSize = 512;
    const offscreen = document.createElement('canvas');
    offscreen.width = mapSize;
    offscreen.height = mapSize;
    const ctxOff = offscreen.getContext('2d');
    
    // Draw the biome map once
    const imgData = ctxOff.createImageData(mapSize, mapSize);
    const W = atlas.width;
    const H = atlas.height;
    
    for (let my = 0; my < mapSize; my++) {
        const z = Math.floor((my / mapSize) * H);
        for (let mx = 0; mx < mapSize; mx++) {
            const x = Math.floor((mx / mapSize) * W);
            const biomeId = atlas.biomes[z * W + x];
            const biome = BIOMES[biomeId] || BIOMES[0];
            const rgb = biome.rgb;
            
            const o = (my * mapSize + mx) * 4;
            imgData.data[o + 0] = rgb[0];
            imgData.data[o + 1] = rgb[1];
            imgData.data[o + 2] = rgb[2];
            imgData.data[o + 3] = 255;
        }
    }
    ctxOff.putImageData(imgData, 0, 0);

    // 2. Create Minimap DOM elements
    const minimapContainer = document.createElement('div');
    minimapContainer.id = 'minimap-container';
    Object.assign(minimapContainer.style, {
        position: 'absolute',
        top: '15px',
        right: '15px',
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        border: '3px solid rgba(255, 255, 255, 0.4)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)',
        overflow: 'hidden',
        background: '#0e224a',
        zIndex: '100'
    });
    
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
    Object.assign(minimapCanvas.style, {
        width: '100%',
        height: '100%'
    });
    minimapContainer.appendChild(minimapCanvas);
    document.body.appendChild(minimapContainer);

    // 3. Create Fullscreen Map DOM elements
    const fullMapOverlay = document.createElement('div');
    fullMapOverlay.id = 'fullmap-overlay';
    Object.assign(fullMapOverlay.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        background: 'rgba(5, 10, 20, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'none',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: '200'
    });

    const mapCard = document.createElement('div');
    Object.assign(mapCard.style, {
        position: 'relative',
        width: '780px',
        height: '560px',
        background: 'rgba(15, 25, 45, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        display: 'flex',
        padding: '20px'
    });

    const fullMapCanvas = document.createElement('canvas');
    fullMapCanvas.width = 520;
    fullMapCanvas.height = 520;
    Object.assign(fullMapCanvas.style, {
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)'
    });
    mapCard.appendChild(fullMapCanvas);

    // Legend panel
    const legendPanel = document.createElement('div');
    Object.assign(legendPanel.style, {
        flex: '1',
        marginLeft: '24px',
        color: '#eef',
        fontFamily: 'system-ui, sans-serif',
        overflowY: 'auto'
    });
    legendPanel.innerHTML = '<h3 style="margin-top:0;color:#ffe066;">ISLAND BIOMES</h3>';

    // Populate legend with unique biomes present on this island
    const uniqueBiomes = new Set(atlas.biomes);
    BIOMES.forEach(b => {
        if (uniqueBiomes.has(b.id)) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                marginBottom: '10px',
                fontSize: '13px'
            });
            row.innerHTML = `<span style="display:inline-block;width:16px;height:16px;background:rgb(${b.rgb.join(',')});border-radius:4px;margin-right:10px;border:1px solid rgba(255,255,255,0.2)"></span>${b.name}`;
            legendPanel.appendChild(row);
        }
    });
    mapCard.appendChild(legendPanel);
    fullMapOverlay.appendChild(mapCard);
    document.body.appendChild(fullMapOverlay);

    let fullMapOpen = false;

    // Helper to rotate a direction vector from camera rotation quaternion
    function getHeadingAngle(q) {
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        // Rotate camera forward vector [0, 0, -1]
        const tx = 2 * (qx * qz - qw * qy);
        const tz = 1 - 2 * (qx * qx + qy * qy);
        return Math.atan2(tx, -tz);
    }

    // Render loop helper
    function drawMapOnCanvas(canvas, showFullIsland) {
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        // Player coordinate to map coordinate mapping
        const mpc = atlas.metresPerCell;
        const totalSize = atlas.width * mpc;
        const px = cam.pos[0];
        const pz = cam.pos[2];

        // Normalize player pos: 0 at NW, 1 at SE
        const npx = (px - atlas.originX) / totalSize;
        const npz = (pz - atlas.originZ) / totalSize;

        if (showFullIsland) {
            // Draw whole island
            ctx.drawImage(offscreen, 0, 0, cw, ch);
            
            // Draw player marker
            const mx = npx * cw;
            const my = npz * ch;
            drawPlayerMarker(ctx, mx, my);
        } else {
            // Minimap: center on player, zoomed in
            ctx.save();
            // We want to translate and scale the offscreen canvas
            // Minimap is circular. We clip to circle
            ctx.beginPath();
            ctx.arc(cw / 2, ch / 2, cw / 2, 0, Math.PI * 2);
            ctx.clip();

            // Source rectangle on offscreen canvas (zoomed in around player)
            const zoom = 0.25; // show 25% of the island
            const srcSize = mapSize * zoom;
            const srcX = Math.max(0, Math.min(mapSize - srcSize, npx * mapSize - srcSize / 2));
            const srcY = Math.max(0, Math.min(mapSize - srcSize, npz * mapSize - srcSize / 2));

            ctx.drawImage(offscreen, srcX, srcY, srcSize, srcSize, 0, 0, cw, ch);

            // Draw player marker at center of minimap
            // If the player is near the edge, the source is clamped, so the marker is offset from center
            let mx = cw / 2;
            let my = ch / 2;
            if (npx * mapSize < srcSize / 2) {
                mx = (npx * mapSize / srcSize) * cw;
            } else if (npx * mapSize > mapSize - srcSize / 2) {
                mx = ((npx * mapSize - (mapSize - srcSize)) / srcSize) * cw;
            }
            if (npz * mapSize < srcSize / 2) {
                my = (npz * mapSize / srcSize) * ch;
            } else if (npz * mapSize > mapSize - srcSize / 2) {
                my = ((npz * mapSize - (mapSize - srcSize)) / srcSize) * ch;
            }

            drawPlayerMarker(ctx, mx, my);
            ctx.restore();
        }
    }

    function drawPlayerMarker(ctx, x, y) {
        const heading = getHeadingAngle(cam.rot);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading);

        // Draw outer glowing circle
        ctx.shadowColor = 'rgba(255, 60, 60, 0.8)';
        ctx.shadowBlur = 8;

        // Draw directional triangle
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -9);  // Tip
        ctx.lineTo(-6, 7);  // Bottom-left
        ctx.lineTo(0, 3);   // Back-center indentation
        ctx.lineTo(6, 7);   // Bottom-right
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    // Toggle on key M
    window.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') {
            fullMapOpen = !fullMapOpen;
            fullMapOverlay.style.display = fullMapOpen ? 'flex' : 'none';
        }
    });

    return {
        get open() { return fullMapOpen; },
        set open(v) {
            fullMapOpen = v;
            fullMapOverlay.style.display = fullMapOpen ? 'flex' : 'none';
        },
        update() {
            // Draw Minimap (always)
            drawMapOnCanvas(minimapCanvas, false);

            // Draw Fullmap (if open)
            if (fullMapOpen) {
                drawMapOnCanvas(fullMapCanvas, true);
            }
        },
        destroy() {
            minimapContainer.remove();
            fullMapOverlay.remove();
        }
    };
}
