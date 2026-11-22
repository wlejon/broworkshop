// Specimen sheet: each tree preset grown alone, its size printed (height,
// trunk diameter at the base, clear bole under the crown, crown width,
// segments, leaves, grow ms), and a still from a person's eye height beside
// the 1.8 m post. A headless script imports and runs it:
//
//   import { runSheet } from "/app/sheet.js";
//   runSheet({ names: ['oak'], seconds: [50, 120] });
import { person, growSpecies, measureTree, draw, clear, lookFrom, lab } from "/app/lab.js";

/** Mean GPU frame ms over 32 frames, time held still (the sway frozen). */
export function gpuMs() {
    bro.time.paused = true;
    for (let i = 0; i < 8; i++) advanceTime(16);
    perf.gpuFrameMs();
    let ms = 0;
    for (let i = 0; i < 32; i++) { advanceTime(16); ms += perf.gpuFrameMs() / 32; }
    bro.time.paused = false;
    return ms;
}

// `costAt`: distances (m) to time the tree's GPU cost from, against the
// frame without it.
export function runSheet({
    names = ['oak', 'beech', 'elm', 'birch', 'pine', 'spruce', 'fir', 'redwood'],
    seconds = [50], out = `${bro.app.cacheDir}/sheet`, species, drawOpts, costAt,
} = {}) {
    for (const name of names) {
        for (const s of seconds) {
            const t0 = Date.now();
            const { world, grow } = growSpecies(name, { seconds: s, species: species?.[name] });
            const m = measureTree(world);
            const k = drawOpts?.scale ?? 1;
            clear();
            const d = draw(world, drawOpts);
            person.x = 2.5; person.z = 1.5;
            lookFrom([0, k * m.height * 0.45, 0], Math.max(20, k * m.height * 1.4), 1.7);
            for (let i = 0; i < 40; i++) advanceTime(16);
            screenshot(`${out}_${name}_${s}.png`);
            if (costAt) {
                const parts = costAt.map((dist) => {
                    lookFrom([0, k * m.height * 0.45, 0], dist, 1.7);
                    const withTree = gpuMs();
                    for (const n of lab.nodes) n.visible = false;
                    const bare = gpuMs();
                    for (const n of lab.nodes) n.visible = true;
                    return `${dist} m ${(withTree - bare).toFixed(2)}`;
                });
                console.log(`sheet ${name} cost (ms over the bare frame): ${parts.join(', ')}`);
            }
            console.log(`sheet ${name} ${s}s x${k}: h ${(k * m.height).toFixed(1)} m, trunk ${(k * m.trunkD).toFixed(2)} m, bole ${(k * m.bole).toFixed(1)} m,`
                + ` crown ${(k * m.crownW).toFixed(1)} m, ${m.segments} segs, ${d.leafCount} leaves, grow ${grow.ms.toFixed(0)} ms${grow.cached ? ' (cached)' : ''},`
                + ` total ${Date.now() - t0} ms`);
        }
    }
    console.log(`sheet shots: ${out}_*.png`);
}
