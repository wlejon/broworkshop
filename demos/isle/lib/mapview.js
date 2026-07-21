// mapview.js — circular minimap and fullscreen biome map.

import { BIOMES } from './biome.js';

export function createMapView(scene, atlas, cam) {
    // 1. Pre-render the biome map once on an offscreen canvas
    const mapSize = 512;
    const offscreen = document.createElement('canvas');
    offscreen.width = mapSize;
    offscreen.height = mapSize;
    const ctxOff = offscreen.getContext('2d');
    
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

    // Load Inter Google Font
    if (!document.getElementById('font-inter')) {
        const link = document.createElement('link');
        link.id = 'font-inter';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap';
        document.head.appendChild(link);
    }

    // Add keyframe animations for pulsate
    if (!document.getElementById('map-styles')) {
        const style = document.createElement('style');
        style.id = 'map-styles';
        style.innerHTML = `
            @keyframes pulse-close {
                0% { opacity: 0.6; }
                50% { opacity: 1.0; text-shadow: 0 0 8px rgba(255,224,102,0.8); }
                100% { opacity: 0.6; }
            }
            .legend-item {
                transition: all 0.2s ease;
            }
            .legend-item:hover {
                background: rgba(255, 255, 255, 0.05);
                transform: translateX(4px);
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Create Circular Minimap HUD
    const minimapContainer = document.createElement('div');
    minimapContainer.id = 'minimap-container';
    Object.assign(minimapContainer.style, {
        position: 'absolute',
        top: '15px',
        right: '15px',
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        border: '2px solid rgba(255, 255, 255, 0.25)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
        overflow: 'hidden',
        background: '#040d1a',
        boxSizing: 'border-box',
        zIndex: '100'
    });
    
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
    Object.assign(minimapCanvas.style, {
        width: '180px',
        height: '180px',
        display: 'block',
        borderRadius: '50%'
    });
    minimapContainer.appendChild(minimapCanvas);
    document.body.appendChild(minimapContainer);

    // 3. Create Fullscreen Map DOM Overlay
    const fullMapOverlay = document.createElement('div');
    fullMapOverlay.id = 'fullmap-overlay';
    Object.assign(fullMapOverlay.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        background: 'rgba(3, 8, 18, 0.75)',
        backdropFilter: 'blur(10px)',
        display: 'none',
        justifyContent: 'center',
        alignItems: 'center',
        boxSizing: 'border-box',
        zIndex: '200'
    });

    const mapCard = document.createElement('div');
    Object.assign(mapCard.style, {
        position: 'relative',
        width: '820px',
        height: '560px',
        background: 'rgba(10, 18, 32, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
        display: 'flex',
        padding: '20px',
        boxSizing: 'border-box'
    });

    const fullMapCanvas = document.createElement('canvas');
    fullMapCanvas.width = 520;
    fullMapCanvas.height = 520;
    Object.assign(fullMapCanvas.style, {
        width: '520px',
        height: '520px',
        display: 'block',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxSizing: 'border-box'
    });
    mapCard.appendChild(fullMapCanvas);

    // Legend panel
    const legendPanel = document.createElement('div');
    Object.assign(legendPanel.style, {
        flex: '1',
        marginLeft: '24px',
        color: '#eef',
        fontFamily: '"Inter", system-ui, sans-serif',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
    });

    legendPanel.innerHTML = `
        <h3 style="margin-top:0; margin-bottom: 16px; font-weight:600; color:#ffe066; font-size:16px; letter-spacing: 0.5px;">ISLAND BIOMES</h3>
    `;

    // Populate legend
    const uniqueBiomes = new Set(atlas.biomes);
    BIOMES.forEach(b => {
        if (uniqueBiomes.has(b.id)) {
            const row = document.createElement('div');
            row.className = 'legend-item';
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 8px',
                marginBottom: '4px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '400',
                cursor: 'default'
            });
            row.innerHTML = `
                <span style="display:inline-block; width:14px; height:14px; background:rgb(${b.rgb.join(',')}); border-radius:50%; margin-right:12px; border:1px solid rgba(255,255,255,0.25)"></span>
                <span style="letter-spacing: 0.2px;">${b.name.toUpperCase()}</span>
            `;
            legendPanel.appendChild(row);
        }
    });

    // Close tip at the bottom of the legend panel
    const closeTip = document.createElement('div');
    Object.assign(closeTip.style, {
        marginTop: 'auto',
        paddingTop: '20px',
        textAlign: 'center',
        color: '#ffe066',
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.8px',
        animation: 'pulse-close 2s infinite ease-in-out'
    });
    closeTip.textContent = 'PRESS [M] TO CLOSE MAP';
    legendPanel.appendChild(closeTip);

    mapCard.appendChild(legendPanel);
    fullMapOverlay.appendChild(mapCard);
    document.body.appendChild(fullMapOverlay);

    let fullMapOpen = false;

    // Correct quaternion forward vector look calculation
    function getHeadingAngle(q) {
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const tx = -2 * (x * z - w * y);
        const tz = -(1 - 2 * (x * x + y * y));
        return Math.atan2(tx, -tz);
    }

    // Render loop helper
    function drawMapOnCanvas(canvas, showFullIsland) {
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);

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
            ctx.beginPath();
            ctx.arc(cw / 2, ch / 2, cw / 2, 0, Math.PI * 2);
            ctx.clip();

            const zoom = 0.25;
            const srcSize = mapSize * zoom;
            const srcX = Math.max(0, Math.min(mapSize - srcSize, npx * mapSize - srcSize / 2));
            const srcY = Math.max(0, Math.min(mapSize - srcSize, npz * mapSize - srcSize / 2));

            ctx.drawImage(offscreen, srcX, srcY, srcSize, srcSize, 0, 0, cw, ch);

            // Draw player marker
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
        ctx.shadowColor = 'rgba(255, 40, 40, 0.9)';
        ctx.shadowBlur = 10;

        // Draw directional triangle
        ctx.fillStyle = '#ff3333';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(0, -10);  // Tip
        ctx.lineTo(-6, 8);   // Bottom-left
        ctx.lineTo(0, 4);    // Indentation
        ctx.lineTo(6, 8);    // Bottom-right
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
