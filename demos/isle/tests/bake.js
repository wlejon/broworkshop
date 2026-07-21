// Headless bake test for CHUNK 1: grow the `decid` master, bake its octahedral
// impostor atlas, draw the atlas into a visible 2D canvas, and screenshot it.
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/bake.js
//
// The screenshot (impostor_atlas.png) lands in the app dir.

import { bakeDecidImpostor } from '/app/lib/impostor.js';

// Let the engine settle a couple of frames before the (synchronous) grow+bake.
for (let i = 0; i < 4; i++) { advanceTime(16); if (typeof flush === 'function') flush(); }

console.log('[bake] growing decid master + baking octahedral atlas...');
const t0 = Date.now();
const cell = 256;
const atlas = bakeDecidImpostor({ cell });
const bakeMs = Date.now() - t0;

const { atlasRGBA, width, height, cols, rows, cellSize, tintRGB, coverage, topCell } = atlas;
const m = atlas.master;
console.log('[bake] done in ' + bakeMs + 'ms');
console.log('[bake] master: branch tris=' + (m.branchMesh ? m.branchMesh.triangleCount : 0) +
            '  leaf tris=' + (m.leafMesh ? m.leafMesh.triangleCount : 0));
console.log('[bake] leafMesh hasColors=' + m.leafMesh.hasColors + ' hasUVs=' + m.leafMesh.hasUVs +
            ' hasNormals=' + m.leafMesh.hasNormals);
{
    const c = m.leafMesh.colors;
    const s = [];
    for (let i = 0; i < 24 && i < c.length; i += 4) s.push('[' + c[i].toFixed(2) + ',' + c[i+1].toFixed(2) + ',' + c[i+2].toFixed(2) + ',' + c[i+3].toFixed(2) + ']');
    console.log('[bake] leafMesh vertex colors[0..5]: ' + s.join(' '));
}
console.log('[bake] bounds center=[' + atlas.bounds.center.map(v => v.toFixed(2)).join(',') +
            ']  radius=' + atlas.bounds.radius.toFixed(2));
console.log('[bake] atlas ' + width + 'x' + height + '  (' + cols + 'x' + rows + ' cells @ ' + cellSize + 'px)');
console.log('[bake] tintRGB=[' + tintRGB.join(',') + ']  (from topCell ' + topCell + ')');

// Sanity: per-cell non-transparent coverage for a few sample cells.
const sample = (col, row) => {
    const idx = row * cols + col;
    return '(' + col + ',' + row + ')=' + (coverage[idx] * 100).toFixed(1) + '%';
};
console.log('[bake] coverage samples: ' +
    [sample(0, 0), sample(0, rows - 1), sample(Math.floor(cols / 2), Math.floor(rows / 2)),
     sample(cols - 1, 0), sample(cols - 1, rows - 1)].join('  '));

// Dump a few non-transparent raw pixels from the top-down cell (tint sanity).
{
    const tcCol = topCell % cols, tcRow = Math.floor(topCell / cols);
    const x0 = tcCol * cellSize, y0 = tcRow * cellSize;
    const samples = [];
    for (let y = 0; y < cellSize && samples.length < 6; y += 7) {
        for (let x = 0; x < cellSize && samples.length < 6; x += 7) {
            const d = ((y0 + y) * width + (x0 + x)) * 4;
            if (atlasRGBA[d + 3] > 0) samples.push('[' + atlasRGBA[d] + ',' + atlasRGBA[d + 1] + ',' + atlasRGBA[d + 2] + ',' + atlasRGBA[d + 3] + ']');
        }
    }
    console.log('[bake] topCell raw RGBA samples: ' + samples.join(' '));
}

let minCov = Infinity, maxCov = -Infinity, sumCov = 0;
for (const c of coverage) { minCov = Math.min(minCov, c); maxCov = Math.max(maxCov, c); sumCov += c; }
console.log('[bake] coverage min=' + (minCov * 100).toFixed(1) + '%  max=' + (maxCov * 100).toFixed(1) +
            '%  mean=' + (sumCov / coverage.length * 100).toFixed(1) + '%');

// --- Build an inspectable image of the atlas --------------------------------
// Composite a checkerboard UNDER the transparent cutout + red cell grid, into a
// plain RGBA buffer.
const disp = new Uint8ClampedArray(atlasRGBA);   // copy
const cb = 32;
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const d = (y * width + x) * 4;
        if (disp[d + 3] === 0) {
            const on = ((Math.floor(x / cb) + Math.floor(y / cb)) & 1);
            const v = on ? 64 : 96;
            disp[d] = v; disp[d + 1] = v; disp[d + 2] = v; disp[d + 3] = 255;
        }
        if (x % cellSize === 0 || y % cellSize === 0) { disp[d] = 220; disp[d + 1] = 40; disp[d + 2] = 40; disp[d + 3] = 255; }
    }
}

// Draw into a visible 2D canvas via putImageData (as requested). NOTE: in this
// headless app a dynamically-created + appended 2D canvas does NOT composite
// into screenshot() — verified with a minimal fillRect probe, it stays black.
// So the canvas is best-effort; the authoritative output is written directly
// with bro.image.encodePngFile below.
const view = document.createElement('canvas');
view.width = width; view.height = height;
view.style.position = 'fixed'; view.style.left = '0'; view.style.top = '0';
view.style.width = '1024px'; view.style.height = '1024px';
view.style.zIndex = '99999'; view.style.display = 'block';
document.body.appendChild(view);
view.getContext('2d').putImageData(new ImageData(disp, width, height), 0, 0);

for (let i = 0; i < 8; i++) { if (typeof wallSleep === 'function') wallSleep(20); advanceTime(16); if (typeof flush === 'function') flush(); }

// Reliable output: encode the composited buffer straight to a PNG file.
const okC = bro.image.encodePngFile('impostor_atlas.png', new Uint8Array(disp.buffer), width, height, 4);
// Also write the raw atlas (true alpha preserved) for downstream chunks.
const okR = bro.image.encodePngFile('impostor_atlas_raw.png', new Uint8Array(atlasRGBA.buffer), width, height, 4);
console.log('[bake] encodePngFile composited=' + okC + '  raw=' + okR);

// Best-effort DOM screenshot too (may be black — see note above).
screenshot('impostor_atlas_screenshot.png');
console.log('[bake] wrote impostor_atlas.png (composited) + impostor_atlas_raw.png (true alpha)');
